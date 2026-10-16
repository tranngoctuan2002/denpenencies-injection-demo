namespace Officely.Api.CaseStudies;

/// <summary>Lifetime: Singleton | Scoped | Transient | Framework | "Not in container" | "All registrations".</summary>
public sealed record GraphNode(string Id, string Label, string? Service, string Lifetime);

/// <summary>Kind: injected | enumerable | cycle | captive | new | creates-scope.</summary>
public sealed record GraphEdge(string From, string To, string Kind);

public sealed record GraphDto(IReadOnlyList<GraphNode> Nodes, IReadOnlyList<GraphEdge> Edges);

/// <summary>
/// Reads constructors the way the container does and flags the edges that matter: a dependency back onto
/// the current path (cycle) and a Singleton holding a Scoped service (captive). Extra edges add what reflection
/// cannot see, such as <c>new StripePaymentProcessor()</c> inside a method.
/// </summary>
public static class DependencyGraph
{
    public static GraphDto Build(IServiceCollection services, Type[] roots, params (Type From, Type To, string Kind)[] extra)
    {
        var nodes = new Dictionary<string, GraphNode>();
        var edges = new List<GraphEdge>();
        var path = new HashSet<string>();

        string Visit(Type type)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IEnumerable<>))
            {
                var item = type.GetGenericArguments()[0];
                var id = $"IEnumerable<{item.Name}>";
                if (nodes.TryAdd(id, new GraphNode(id, id, null, "All registrations")))
                    foreach (var d in services.Where(d => !d.IsKeyedService && d.ServiceType == item))
                        edges.Add(new GraphEdge(id, VisitDescriptor(d), "enumerable"));
                return id;
            }

            var descriptor = services.LastOrDefault(d => !d.IsKeyedService && (d.ServiceType == type || d.ImplementationType == type));
            if (descriptor is not null) return VisitDescriptor(descriptor);

            var external = (type.Namespace ?? "").StartsWith("Microsoft") || (type.Namespace ?? "").StartsWith("System") ? "Framework" : "Not in container";
            nodes.TryAdd(type.FullName!, new GraphNode(type.FullName!, type.Name, null, external));
            return type.FullName!;
        }

        string VisitDescriptor(ServiceDescriptor d)
        {
            var impl = d.ImplementationType ?? d.ImplementationInstance?.GetType() ?? d.ServiceType;
            var id = impl.FullName!;
            var service = d.ServiceType == impl ? null : d.ServiceType.Name;
            if (!nodes.TryAdd(id, new GraphNode(id, impl.Name, service, d.Lifetime.ToString())) || d.ImplementationType is null)
                return id;

            path.Add(id);
            var ctor = impl.GetConstructors().OrderByDescending(c => c.GetParameters().Length).First();
            foreach (var p in ctor.GetParameters())
            {
                // Framework plumbing (options, logging, clock) is noise on a diagram; the scope factory is the point of one.
                var ns = p.ParameterType.Namespace ?? "";
                if ((ns.StartsWith("Microsoft.") || p.ParameterType == typeof(TimeProvider)) && p.ParameterType != typeof(IServiceScopeFactory))
                    continue;
                var target = Visit(p.ParameterType);
                edges.Add(new GraphEdge(id, target, KindOf(id, target)));
            }
            path.Remove(id);
            return id;
        }

        string KindOf(string from, string to) =>
            path.Contains(to) ? "cycle"
            : nodes[from].Lifetime == "Singleton" && nodes[to].Lifetime == "Scoped" ? "captive"
            : "injected";

        foreach (var root in roots) Visit(root);
        foreach (var (from, to, kind) in extra)
        {
            var target = kind == "new" ? $"new:{to.FullName}" : Visit(to);   // created by hand: not the container's instance
            if (kind == "new") nodes.TryAdd(target, new GraphNode(target, to.Name, null, "Not in container"));
            edges.Add(new GraphEdge(Visit(from), target, kind));
        }

        return new GraphDto(nodes.Values.ToList(), edges);
    }
}
