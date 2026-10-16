using Officely.Api;
using Officely.Api.Cart;
using Officely.Api.CaseStudies;
using Officely.Api.CaseStudies.Broken;
using Officely.Api.Data;
using Officely.Api.Orders;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Officely.Tests;

public class StartupTests
{
    [Theory]
    [InlineData(CaseStudy.None)]
    [InlineData(CaseStudy.Payments)]
    [InlineData(CaseStudy.Cart)]
    [InlineData(CaseStudy.UnitOfWork)]     // validation cannot see these three: they are not lifetime or cycle errors
    [InlineData(CaseStudy.ThreadSafety)]
    public void Graphs_without_lifetime_or_cycle_problems_pass_validation(CaseStudy broken)
    {
        using var shop = new TestShop(broken);   // builds with ValidateScopes + ValidateOnBuild
    }

    [Fact]
    public void Circular_dependency_fails_at_startup()
    {
        var ex = Assert.Throws<AggregateException>(() => new TestShop(CaseStudy.Notifications));
        Assert.Contains(ex.InnerExceptions, e => e.Message.Contains("circular dependency was detected"));
    }

    [Fact]
    public void Captive_dependency_fails_at_startup()
    {
        var ex = Assert.Throws<AggregateException>(() => new TestShop(CaseStudy.Lifetimes));
        Assert.Contains(ex.InnerExceptions, e => e.Message.Contains($"Cannot consume scoped service '{typeof(ShopDbContext).FullName}'"));
    }

    [Fact]
    public async Task The_real_host_refuses_to_start_with_a_broken_graph()
    {
        var file = Path.Combine(Path.GetTempPath(), $"officely-test-{Guid.NewGuid():N}.db");
        var args = new[] { $"--ConnectionStrings:Shop=Data Source={file};Pooling=False" };
        try
        {
            await Assert.ThrowsAsync<AggregateException>(() => ShopHost.BuildAsync(args, new CaseStudySettings { Broken = CaseStudy.Notifications }));

            await using var app = await ShopHost.BuildAsync(args, new CaseStudySettings());   // the fixed shop builds and seeds its database
            await using var scope = app.Services.CreateAsyncScope();
            Assert.Equal(6, await scope.ServiceProvider.GetRequiredService<ShopDbContext>().Products.CountAsync());
        }
        finally
        {
            File.Delete(file);
        }
    }
}

public class CircularDependencyTests
{
    [Fact]
    public void Without_validation_the_shop_starts_but_every_order_request_fails()
    {
        using var shop = new TestShop(CaseStudy.Notifications, validate: false);
        using var scope = shop.Services.CreateScope();

        var ex = Assert.Throws<InvalidOperationException>(() => scope.ServiceProvider.GetRequiredService<IOrderService>());
        Assert.Contains($"{nameof(NotificationService)} -> {typeof(IOrderService).FullName}", ex.Message);
    }
}

public class CaptiveDependencyTests
{
    [Fact]
    public async Task Singleton_OrderService_keeps_showing_stale_order_status()
    {
        using var shop = new TestShop(CaseStudy.Lifetimes, validate: false);   // what Production does by default
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);
        var order = await shop.CheckoutAsync("stripe");
        shop.Clock.Advance(Fulfilment.CancellationWindow);
        await shop.Worker.ShipDueOrdersAsync(CancellationToken.None);

        var shown = await shop.InScopeAsync(sp => sp.GetRequiredService<IOrderService>().GetRecentOrdersAsync(CancellationToken.None));
        var stored = await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.AsNoTracking().SingleAsync(o => o.Id == order.Id));

        Assert.Equal(OrderStatus.Shipped, stored.Status);                            // the database is right...
        Assert.Equal(OrderStatus.Paid, shown.Single(o => o.Id == order.Id).Status);  // ...the captured DbContext is not
    }

    [Fact]
    public async Task Scoped_OrderService_shows_the_current_status()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);
        var order = await shop.CheckoutAsync("stripe");
        shop.Clock.Advance(Fulfilment.CancellationWindow);
        await shop.Worker.ShipDueOrdersAsync(CancellationToken.None);

        var shown = await shop.InScopeAsync(sp => sp.GetRequiredService<IOrderService>().GetRecentOrdersAsync(CancellationToken.None));
        Assert.Equal(OrderStatus.Shipped, shown.Single(o => o.Id == order.Id).Status);
    }

    [Fact]
    public async Task Worker_uses_a_new_scope_per_run_and_disposes_its_DbContext()
    {
        var created = new List<ShopDbContext>();
        using var shop = new TestShop(configure: s => s.AddScoped(sp =>
        {
            var db = new ShopDbContext(sp.GetRequiredService<DbContextOptions<ShopDbContext>>());
            lock (created) created.Add(db);
            return db;
        }));
        created.Clear();   // ignore the context used to create the database
        var worker = shop.Worker;

        await worker.ShipDueOrdersAsync(CancellationToken.None);
        await worker.ShipDueOrdersAsync(CancellationToken.None);

        Assert.Equal(2, created.Count);
        Assert.NotSame(created[0], created[1]);
        Assert.All(created, db => Assert.Throws<ObjectDisposedException>(() => db.Orders.Count()));
    }
}

public class CartRaceTests
{
    /// <summary>
    /// Holds every caller until all of them have arrived. Each caller has already READ the quantity by then,
    /// so all of them read the same value: a deterministic overlap, with no sleeps and no luck.
    /// </summary>
    private sealed class GatedInventory(int callers) : IInventoryClient
    {
        private readonly TaskCompletionSource _allArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _arrived;

        public async Task EnsureInStockAsync(int productId, int quantity, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _arrived) == callers) _allArrived.SetResult();
            await _allArrived.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
        }
    }

    private static Task AddConcurrently(ICartService cart, int buyers) =>
        Task.WhenAll(Enumerable.Range(0, buyers).Select(_ => Task.Run(() => cart.AddAsync(1, 1, CancellationToken.None))));

    [Fact]
    public async Task Unsafe_singleton_cart_loses_updates_when_requests_overlap()
    {
        var cart = new UnsafeCartService(new GatedInventory(100));
        await AddConcurrently(cart, 100);
        Assert.Equal(1, cart.Items().Single().Quantity);   // 99 of 100 updates lost
    }

    [Fact]
    public async Task Locked_cart_counts_every_update_under_the_same_overlap()
    {
        var cart = new CartService(new GatedInventory(100));
        await AddConcurrently(cart, 100);
        Assert.Equal(100, cart.Items().Single().Quantity);
    }

    [Fact]
    public async Task Locked_cart_counts_every_update_with_the_real_inventory_client()
    {
        var cart = new CartService(new FakeInventoryClient());
        await AddConcurrently(cart, 200);
        Assert.Equal(200, cart.Items().Single().Quantity);
    }
}

public class DependencyGraphTests
{
    [Fact]
    public void Graphs_flag_exactly_the_problem_of_each_broken_case()
    {
        Assert.Contains(DevToolsEndpoints.Graph(CaseStudy.Notifications, broken: true).Edges, e => e.Kind == "cycle");
        Assert.DoesNotContain(DevToolsEndpoints.Graph(CaseStudy.Notifications, broken: false).Edges, e => e.Kind == "cycle");

        Assert.Contains(DevToolsEndpoints.Graph(CaseStudy.Lifetimes, broken: true).Edges, e => e.Kind == "captive");
        var lifetimesFixed = DevToolsEndpoints.Graph(CaseStudy.Lifetimes, broken: false);
        Assert.DoesNotContain(lifetimesFixed.Edges, e => e.Kind == "captive");
        Assert.Contains(lifetimesFixed.Edges, e => e.Kind == "creates-scope");

        Assert.Equal(2, DevToolsEndpoints.Graph(CaseStudy.Payments, broken: true).Edges.Count(e => e.Kind == "new"));
        Assert.Contains(DevToolsEndpoints.Graph(CaseStudy.Payments, broken: false).Edges, e => e.Kind == "enumerable");
    }
}
