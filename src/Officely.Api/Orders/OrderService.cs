using Officely.Api.Cart;
using Officely.Api.Data;
using Officely.Api.Payments;
using Microsoft.EntityFrameworkCore;

namespace Officely.Api.Orders;

public sealed record CheckoutRequest(string CustomerEmail, string PaymentProvider);

/// <summary>A problem with the customer's input (HTTP 400), as opposed to a bug (HTTP 500).</summary>
public sealed class CheckoutException(string message) : Exception(message);

public interface IOrderService
{
    Task<Order> PlaceOrderAsync(CheckoutRequest request, CancellationToken cancellationToken);
    Task<IReadOnlyList<Order>> GetRecentOrdersAsync(CancellationToken cancellationToken);
}

// #region snippet:order-service
// Every collaborator arrives through the constructor. OrderService does not know which payment
// providers exist, and it does not know who reacts when an order is completed.
public sealed class OrderService(
    ShopDbContext db,
    ICartService cart,
    IStockService stock,
    IPaymentProcessorResolver payments,
    OrderEventDispatcher events,
    TimeProvider clock) : IOrderService
{
    public async Task<Order> PlaceOrderAsync(CheckoutRequest request, CancellationToken cancellationToken)
    {
        var processor = payments.Resolve(request.PaymentProvider);       // strategy chosen by name
        var order = await OrderDrafts.CreateFromCartAsync(db, cart, stock, request, processor.Provider, clock, cancellationToken);

        var payment = await processor.ProcessAsync(
            new PaymentRequest(order.Id, order.Total, order.CustomerEmail), cancellationToken);
        order.PaymentReference = payment.Reference;
        order.Status = OrderStatus.Paid;
        await db.SaveChangesAsync(cancellationToken);
        cart.Clear();

        await events.PublishAsync(new OrderCompleted(order.Id, order.CustomerEmail, order.Total), cancellationToken);
        return order;
    }

    public Task<IReadOnlyList<Order>> GetRecentOrdersAsync(CancellationToken cancellationToken) =>
        OrderDrafts.RecentAsync(db, cancellationToken);
}
// #endregion

/// <summary>The order bookkeeping every checkout variant shares, so the case studies differ only where the bug is.</summary>
public static class OrderDrafts
{
    public static async Task<Order> CreateFromCartAsync(
        ShopDbContext db, ICartService cart, IStockService stock, CheckoutRequest request, string provider, TimeProvider clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.CustomerEmail) || !request.CustomerEmail.Contains('@'))
            throw new CheckoutException("Enter a valid e-mail address.");

        var items = cart.Items();
        if (items.Count == 0) throw new CheckoutException("The team cart is empty.");

        var ids = items.Select(i => i.ProductId).ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var lines = items.Where(i => products.ContainsKey(i.ProductId)).Select(i => new OrderLine
        {
            ProductId = i.ProductId,
            ProductName = products[i.ProductId].Name,
            UnitPrice = products[i.ProductId].Price,
            Quantity = i.Quantity
        }).ToList();

        var order = new Order
        {
            CustomerEmail = request.CustomerEmail.Trim(),
            PaymentProvider = provider,
            Status = OrderStatus.PendingPayment,
            PlacedAt = clock.GetUtcNow().UtcDateTime,
            Lines = lines,
            Total = lines.Sum(l => l.UnitPrice * l.Quantity)
        };
        // #region snippet:order-unit-of-work
        db.Orders.Add(order);                     // tracked by this request's ShopDbContext
        await stock.ReserveAsync(lines, ct);      // tracked by StockService's ShopDbContext: the same instance when Scoped
        await db.SaveChangesAsync(ct);            // ONE unit of work: the new order and the lower stock, in one transaction
        // #endregion
        return order;
    }

    // Tracking query on purpose: that is the EF Core default, and it is what makes a captured DbContext show stale data.
    public static async Task<IReadOnlyList<Order>> RecentAsync(ShopDbContext db, CancellationToken ct) =>
        await db.Orders.Include(o => o.Lines).OrderByDescending(o => o.Id).Take(20).ToListAsync(ct);
}
