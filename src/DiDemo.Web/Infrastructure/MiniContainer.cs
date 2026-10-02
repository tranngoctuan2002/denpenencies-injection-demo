namespace DiDemo.Web.Infrastructure;

/// <summary>Outcome of a case-study run. Status: ok (works), bug (silently wrong) or error (container/runtime threw).</summary>
public record CaseResult(string Status, string Message, object? Data = null);

/// <summary>
/// Case studies where the *container configuration* is the point build their own tiny provider,
/// so the failure is deterministic and never takes the host app down.
/// </summary>
public static class MiniContainer
{
    /// <summary>The dependency tree the container WOULD build for a service (loops are marked as cycles).</summary>
    public static GraphNode Describe(Action<IServiceCollection> configure, Type serviceType)
    {
        var services = new ServiceCollection();
        configure(services);
        return new LifetimeCatalog(services).Describe(serviceType);
    }

    public static ServiceProvider Build(Action<IServiceCollection> configure, bool validate)
    {
        var services = new ServiceCollection();
        configure(services);
        return services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateScopes = validate,
            ValidateOnBuild = validate
        });
    }

    public static CaseResult Fail(Exception ex) =>
        new("error", $"{ex.GetType().Name}: {ex.Message}");

    public static string Short(Guid id) => id.ToString()[..8];
}
