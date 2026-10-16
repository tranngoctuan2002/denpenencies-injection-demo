using Officely.Api;
using Officely.Api.Cart;
using Officely.Api.CaseStudies;
using Officely.Api.Data;
using Officely.Api.Orders;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Officely.Tests;

/// <summary>
/// The shop's real registrations (AddShop + an optional broken case study) on a private in-memory SQLite database.
/// The keep-alive connection holds the shared in-memory database open for the test's lifetime.
/// </summary>
public sealed class TestShop : IDisposable
{
    private readonly SqliteConnection _keepAlive;

    public ServiceProvider Services { get; }

    public TestShop(CaseStudy broken = CaseStudy.None, bool validate = true, Action<IServiceCollection>? configure = null)
    {
        var connectionString = $"Data Source=shop-{Guid.NewGuid():N};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(connectionString);
        _keepAlive.Open();

        var services = new ServiceCollection().AddLogging().AddShop(connectionString).UseBrokenCaseStudy(broken);
        services.AddSingleton<TimeProvider>(Clock);
        configure?.Invoke(services);
        Services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = validate, ValidateOnBuild = validate });

        using var scope = Services.CreateScope();
        ShopDatabase.EnsureCreatedAsync(scope.ServiceProvider.GetRequiredService<ShopDbContext>()).GetAwaiter().GetResult();
    }

    public ManualClock Clock { get; } = new();

    public ICartService Cart => Services.GetRequiredService<ICartService>();

    /// <summary>The fulfilment worker as the host would start it (fixed or broken, depending on the case study).</summary>
    public FulfilmentLoop Worker => Services.GetServices<IHostedService>().OfType<FulfilmentLoop>().Single();

    /// <summary>One "HTTP request": a scope, the order service from it, and a checkout.</summary>
    public async Task<Order> CheckoutAsync(string provider, string email = "alice@example.com")
    {
        await using var scope = Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IOrderService>()
            .PlaceOrderAsync(new CheckoutRequest(email, provider), CancellationToken.None);
    }

    public async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    public void Dispose()
    {
        Services.Dispose();
        _keepAlive.Dispose();
    }
}

/// <summary>Time that only moves when a test says so.</summary>
public sealed class ManualClock : TimeProvider
{
    private DateTimeOffset _now = new(2026, 1, 15, 9, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}
