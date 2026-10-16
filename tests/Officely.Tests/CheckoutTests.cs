using Officely.Api.Data;
using Officely.Api.Orders;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Officely.Tests;

public class CheckoutTests
{
    [Fact]
    public async Task Checkout_charges_saves_the_order_empties_the_cart_and_emails_the_customer()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(1, 2, CancellationToken.None);   // 2 × Team Mug at 12.00

        var order = await shop.CheckoutAsync("paypal", "bob@example.com");

        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Equal(24.00m, order.Total);
        Assert.StartsWith("PAYID-", order.PaymentReference);
        Assert.Empty(shop.Cart.Items());
        var mail = Assert.Single(await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Emails.ToListAsync()));
        Assert.Equal("bob@example.com", mail.To);
        Assert.Equal($"Order #{order.Id} confirmed", mail.Subject);
        Assert.Equal(498, await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Products.Where(p => p.Id == 1).Select(p => p.Stock).SingleAsync()));
    }

    [Fact]
    public async Task Checkout_refuses_to_sell_more_than_is_in_stock()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(2, 6, CancellationToken.None);   // 6 hoodies, 5 in stock

        var ex = await Assert.ThrowsAsync<CheckoutException>(() => shop.CheckoutAsync("stripe"));
        Assert.Contains("Only 5 × Hoodie", ex.Message);
        Assert.Equal(0, await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.CountAsync()));
    }

    [Fact]
    public async Task Empty_cart_is_a_checkout_error_not_a_crash()
    {
        using var shop = new TestShop();
        var ex = await Assert.ThrowsAsync<CheckoutException>(() => shop.CheckoutAsync("stripe"));
        Assert.Contains("empty", ex.Message);
    }

    [Fact]
    public async Task Fulfilment_worker_ships_paid_orders_and_emails_the_customer()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(2, 1, CancellationToken.None);
        var order = await shop.CheckoutAsync("stripe");

        Assert.Equal(0, await shop.Worker.ShipDueOrdersAsync(CancellationToken.None));   // still inside the cancellation window
        shop.Clock.Advance(Fulfilment.CancellationWindow);
        Assert.Equal(1, await shop.Worker.ShipDueOrdersAsync(CancellationToken.None));

        var orders = await shop.InScopeAsync(sp => sp.GetRequiredService<IOrderService>().GetRecentOrdersAsync(CancellationToken.None));
        Assert.Equal(OrderStatus.Shipped, orders.Single(o => o.Id == order.Id).Status);
        Assert.Contains(await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Emails.ToListAsync()),
            m => m.Subject == $"Order #{order.Id} has shipped");
    }
}

public class DatabaseTests
{
    [Fact]
    public async Task Timestamps_read_back_from_SQLite_are_UTC()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);
        var placed = await shop.CheckoutAsync("stripe");

        var loaded = await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.AsNoTracking().SingleAsync(o => o.Id == placed.Id));
        Assert.Equal(DateTimeKind.Utc, loaded.PlacedAt.Kind);
        Assert.Equal(placed.PlacedAt, loaded.PlacedAt);
    }
}
