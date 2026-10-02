using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Infrastructure;

/// <summary>Anything that carries a unique instance id so the UI can show "which instance did I get?".</summary>
public interface ITraceable
{
    Guid InstanceId { get; }
}

public abstract class Traceable : ITraceable
{
    public Guid InstanceId { get; } = Guid.NewGuid();
}

public record TraceEntry(string Service, string Lifetime, Guid InstanceId, [property: JsonIgnore] Type? ImplType = null);

/// <summary>One box of the dependency tree. InstanceId is filled in when the tree is annotated with a request's trace.</summary>
public record GraphNode(
    string Service,
    string Implementation,
    string Lifetime,
    string? Note,
    List<GraphNode> Needs,
    Guid? InstanceId = null,
    bool Cycle = false);

public record RegistrationInfo(string Service, string Implementation, string Lifetime, string? Key);

/// <summary>
/// Reads the lifetime straight out of the IServiceCollection, so the UI shows what the container
/// really does and can never drift from the registrations in Program.cs.
/// </summary>
public class LifetimeCatalog(IServiceCollection services)
{
    private static Type? ImplOf(ServiceDescriptor d) =>
        d.IsKeyedService
            ? d.KeyedImplementationType ?? d.KeyedImplementationInstance?.GetType()
            : d.ImplementationType ?? d.ImplementationInstance?.GetType();

    public string LifetimeOf(Type type)
    {
        foreach (var d in services)
            if (ImplOf(d) == type)
                return d.Lifetime.ToString();

        // factory registrations (e.g. IPaymentGateway chosen at runtime) have no implementation type
        foreach (var d in services)
            if (ImplOf(d) is null && d.ServiceType != typeof(object) && d.ServiceType.IsAssignableFrom(type))
                return d.Lifetime.ToString();

        return "Unknown";
    }

    /// <summary>
    /// "What would the container build for this service?" - reads the constructors recursively, exactly the
    /// way the container does. Pass a request's trace to annotate every box with the instance it really got.
    /// A service that (indirectly) needs itself is marked as a cycle instead of recursing for ever.
    /// </summary>
    public GraphNode Describe(Type serviceType, IReadOnlyList<TraceEntry>? trace = null) =>
        Build(serviceType, trace, []);

    private GraphNode Build(Type serviceType, IReadOnlyList<TraceEntry>? trace, List<Type> path)
    {
        if (serviceType.IsGenericType && serviceType.GetGenericTypeDefinition() == typeof(IEnumerable<>))
        {
            var item = serviceType.GetGenericArguments()[0];
            var all = services.Where(d => !d.IsKeyedService && d.ServiceType == item).ToList();
            return new GraphNode($"every {item.Name}", $"{all.Count} registered", "-",
                "IEnumerable<T>: the container passes in ALL registrations",
                all.Select(d => BuildDescriptor(d, trace, path)).ToList());
        }

        if ((serviceType.Namespace ?? "").StartsWith("Microsoft") || (serviceType.Namespace ?? "").StartsWith("System"))
            return new GraphNode(Friendly(serviceType), "framework service", "-", null, []);

        if (path.Contains(serviceType))
            return new GraphNode(serviceType.Name, "needs itself again", "-",
                "Circular: this is already being built further up", [], null, true);

        var descriptor = services.LastOrDefault(d => !d.IsKeyedService && d.ServiceType == serviceType);
        return descriptor is null
            ? new GraphNode(serviceType.Name, "(not registered)", "-", null, [])
            : BuildDescriptor(descriptor, trace, path);
    }

    private GraphNode BuildDescriptor(ServiceDescriptor d, IReadOnlyList<TraceEntry>? trace, List<Type> path)
    {
        var lifetime = d.Lifetime.ToString();
        var impl = ImplOf(d);

        if (impl is null)
            return new GraphNode(d.ServiceType.Name, "picked at runtime", lifetime,
                "A factory in Program.cs decides which implementation to create", [],
                trace?.FirstOrDefault(t => t.ImplType is not null && d.ServiceType.IsAssignableFrom(t.ImplType))?.InstanceId);

        var instance = trace?.FirstOrDefault(t => t.ImplType == impl)?.InstanceId;

        if (d.ImplementationInstance is not null)
            return new GraphNode(d.ServiceType.Name, impl.Name, lifetime, null, [], instance);

        var ctor = impl.GetConstructors().OrderByDescending(c => c.GetParameters().Length).FirstOrDefault();
        List<Type> next = [.. path, d.ServiceType];
        var needs = ctor?.GetParameters()
            .Where(p => p.ParameterType != typeof(LifetimeCatalog))   // demo plumbing, not part of the story
            .Select(p => Build(p.ParameterType, trace, next)).ToList() ?? [];
        return new GraphNode(d.ServiceType.Name, impl.Name, lifetime, null, needs, instance);
    }

    private static string Friendly(Type t) =>
        t.IsGenericType ? $"{t.Name[..t.Name.IndexOf('`')]}<{string.Join(", ", t.GetGenericArguments().Select(a => a.Name))}>" : t.Name;

    public IEnumerable<RegistrationInfo> Registrations() =>
        services
            .Where(d => (d.ServiceType.Namespace ?? "").StartsWith("DiDemo.Web")
                        || (ImplOf(d)?.Namespace ?? "").StartsWith("DiDemo.Web"))
            .Where(d => d.ServiceType != typeof(LifetimeCatalog))
            .Select(d => new RegistrationInfo(
                d.ServiceType.Name,
                ImplOf(d)?.Name ?? "(factory)",
                d.Lifetime.ToString(),
                d.IsKeyedService ? d.ServiceKey?.ToString() : null));
}

public interface IRequestContext
{
    Guid CorrelationId { get; }
    string User { get; set; }
    IReadOnlyList<TraceEntry> Trace { get; }
    void Touch(object? service);
}

// #region snippet:request-context
/// <summary>One per scope (= one per HTTP request). Everyone in the request sees the SAME instance.</summary>
public class RequestContext(LifetimeCatalog catalog) : Traceable, IRequestContext
{
    private readonly List<TraceEntry> _trace = [];
    private readonly object _gate = new();

    public Guid CorrelationId => InstanceId;
    public string User { get; set; } = "alice";

    public IReadOnlyList<TraceEntry> Trace
    {
        get { lock (_gate) return _trace.ToList(); }
    }

    public void Touch(object? service)
    {
        Guid? id = service switch
        {
            ITraceable t => t.InstanceId,
            DbContext db => db.ContextId.InstanceId,
            _ => null
        };
        if (id is null) return;

        lock (_gate)
        {
            if (_trace.Any(e => e.InstanceId == id)) return;
            var type = service!.GetType();
            _trace.Add(new TraceEntry(type.Name, catalog.LifetimeOf(type), id.Value, type));
        }
    }
}
// #endregion
