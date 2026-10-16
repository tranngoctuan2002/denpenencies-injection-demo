using Officely.Api.Cart;
using Officely.Api.CaseStudies;
using Officely.Api.CaseStudies.Broken;
using Officely.Api.Data;
using Officely.Api.Orders;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Officely.Tests;

public class UnitOfWorkTests
{
    private static Task<int> HoodieStock(TestShop shop) =>
        shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Products.Where(p => p.Id == 2).Select(p => p.Stock).SingleAsync());

    [Fact]
    public async Task Scoped_DbContext_saves_the_order_and_the_stock_together()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(2, 2, CancellationToken.None);

        await shop.CheckoutAsync("stripe");

        Assert.Equal(3, await HoodieStock(shop));
    }

    [Fact]
    public async Task Transient_DbContext_loses_the_stock_change_and_oversells()
    {
        using var shop = new TestShop(CaseStudy.UnitOfWork);   // passes validation: nothing warns you
        for (var i = 0; i < 3; i++)
        {
            await shop.Cart.AddAsync(2, 2, CancellationToken.None);
            await shop.CheckoutAsync("stripe");                  // 6 hoodies sold in total, only 5 in stock
        }

        Assert.Equal(5, await HoodieStock(shop));
        Assert.Equal(3, await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.CountAsync()));
    }
}

public class ThreadSafetyTests
{
    private static Task<CartView> CartPage(TestShop shop) =>
        shop.InScopeAsync(sp => sp.GetRequiredService<ICartSummary>().GetAsync(CancellationToken.None));

    [Fact]
    public async Task Parallel_queries_on_one_DbContext_fail_once_the_cart_has_two_products()
    {
        using var shop = new TestShop(CaseStudy.ThreadSafety);
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);
        Assert.Single((await CartPage(shop)).Lines);             // one product: works on my machine

        await shop.Cart.AddAsync(2, 1, CancellationToken.None);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => CartPage(shop));
        Assert.Contains("A second operation was started on this context instance", ex.Message);
    }

    [Fact]
    public async Task One_query_per_request_works_for_any_cart()
    {
        using var shop = new TestShop();
        foreach (var id in new[] { 1, 2, 3, 4 }) await shop.Cart.AddAsync(id, 1, CancellationToken.None);

        var cart = await CartPage(shop);

        Assert.Equal(4, cart.Lines.Count);
        Assert.Equal(12.00m + 49.00m + 89.00m + 35.00m, cart.Total);
    }
}

public class BackgroundJobTests
{
    [Fact]
    public void Worker_holding_a_DbContext_fails_validation_at_startup()
    {
        var ex = Assert.Throws<AggregateException>(() => new TestShop(CaseStudy.BackgroundJob));
        Assert.Contains(ex.InnerExceptions, e =>
            e.Message.Contains($"Cannot consume scoped service '{typeof(ShopDbContext).FullName}'") && e.Message.Contains("IHostedService"));
    }

    /// <summary>The worker sees the order while it can still be cancelled, the customer cancels, then the worker runs again.</summary>
    private static async Task<OrderStatus> CancelThenFulfil(TestShop shop)
    {
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);
        var order = await shop.CheckoutAsync("stripe");

        Assert.Equal(0, await shop.Worker.ShipDueOrdersAsync(CancellationToken.None));   // within the window: not shipped yet
        await shop.InScopeAsync(async sp =>                                               // the customer cancels (another request)
        {
            var db = sp.GetRequiredService<ShopDbContext>();
            (await db.Orders.SingleAsync(o => o.Id == order.Id)).Status = OrderStatus.Cancelled;
            return await db.SaveChangesAsync();
        });
        shop.Clock.Advance(Fulfilment.CancellationWindow);
        await shop.Worker.ShipDueOrdersAsync(CancellationToken.None);

        return await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.AsNoTracking()
            .Where(o => o.Id == order.Id).Select(o => o.Status).SingleAsync());
    }

    [Fact]
    public async Task Captured_DbContext_ships_a_cancelled_order()
    {
        using var shop = new TestShop(CaseStudy.BackgroundJob, validate: false);   // the Production default
        Assert.IsType<CaptiveFulfilmentWorker>(shop.Worker);
        Assert.Equal(OrderStatus.Shipped, await CancelThenFulfil(shop));
    }

    [Fact]
    public async Task Scope_per_run_respects_the_cancellation()
    {
        using var shop = new TestShop();
        Assert.Equal(OrderStatus.Cancelled, await CancelThenFulfil(shop));
    }

    [Fact]
    public void Graphs_show_the_captive_worker_and_the_scope_per_run_fix()
    {
        Assert.Contains(DevToolsEndpoints.Graph(CaseStudy.BackgroundJob, broken: true).Edges, e => e.Kind == "captive");
        var fixd = DevToolsEndpoints.Graph(CaseStudy.BackgroundJob, broken: false);
        Assert.DoesNotContain(fixd.Edges, e => e.Kind == "captive");
        Assert.Contains(fixd.Edges, e => e.Kind == "creates-scope");
    }
}
