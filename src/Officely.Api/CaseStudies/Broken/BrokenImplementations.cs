using System.Collections.Concurrent;
using Officely.Api.Cart;
using Officely.Api.Data;
using Officely.Api.Notifications;
using Officely.Api.Orders;
using Officely.Api.Payments;
using Microsoft.EntityFrameworkCore;

// The intentionally broken versions of shop services. They are only registered when a case study
// is switched to "Broken" in the dev panel (see CaseStudyRegistration).
namespace Officely.Api.CaseStudies.Broken;

// #region snippet:payments-broken
// OrderService chooses AND creates the payment infrastructure itself.
public sealed class TightlyCoupledOrderService(
    ShopDbContext db,
    ICartService cart,
    IStockService stock,
    OrderEventDispatcher events,
    TimeProvider clock) : IOrderService
{
    public async Task<Order> PlaceOrderAsync(CheckoutRequest request, CancellationToken cancellationToken)
    {
        // Every new provider = edit, re-test and redeploy THIS class.
        // A unit test cannot swap in a fake: `new` is hard-wired.
        IPaymentProcessor processor;
        if (request.PaymentProvider.Equals("stripe", StringComparison.OrdinalIgnoreCase))
            processor = new StripePaymentProcessor();
        else if (request.PaymentProvider.Equals("paypal", StringComparison.OrdinalIgnoreCase))
            processor = new PayPalPaymentProcessor();
        else
            throw new NotSupportedException($"Payment provider '{request.PaymentProvider}' is not supported by OrderService.");

        var order = await OrderDrafts.CreateFromCartAsync(db, cart, stock, request, processor.Provider, clock, cancellationToken);
        var payment = await processor.ProcessAsync(new PaymentRequest(order.Id, order.Total, order.CustomerEmail), cancellationToken);
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

// #region snippet:notifications-broken
// OrderService sends the confirmation e-mail through NotificationService...
public sealed class NotifyingOrderService(
    ShopDbContext db,
    ICartService cart,
    IStockService stock,
    IPaymentProcessorResolver payments,
    NotificationService notifications,               // OrderService -> NotificationService
    TimeProvider clock) : IOrderService
{
    public async Task<Order> PlaceOrderAsync(CheckoutRequest request, CancellationToken cancellationToken)
    {
        var processor = payments.Resolve(request.PaymentProvider);
        var order = await OrderDrafts.CreateFromCartAsync(db, cart, stock, request, processor.Provider, clock, cancellationToken);
        var payment = await processor.ProcessAsync(new PaymentRequest(order.Id, order.Total, order.CustomerEmail), cancellationToken);
        order.PaymentReference = payment.Reference;
        order.Status = OrderStatus.Paid;
        await db.SaveChangesAsync(cancellationToken);
        cart.Clear();

        await notifications.SendOrderConfirmationAsync(order.Id, cancellationToken);
        return order;
    }

    public Task<IReadOnlyList<Order>> GetRecentOrdersAsync(CancellationToken cancellationToken) =>
        OrderDrafts.RecentAsync(db, cancellationToken);
}

// ...and NotificationService needs the customer's e-mail address, so "let's just inject the order service".
public sealed class NotificationService(
    IOrderService orders,                            // NotificationService -> OrderService
    IEmailSender email)
{
    public async Task SendOrderConfirmationAsync(int orderId, CancellationToken cancellationToken)
    {
        var order = (await orders.GetRecentOrdersAsync(cancellationToken)).Single(o => o.Id == orderId);
        await email.SendAsync(order.CustomerEmail, $"Order #{order.Id} confirmed",
            $"Thanks for your order! We received your payment of {order.Total:0.00}.", cancellationToken);
    }
}
// #endregion

// #region snippet:cart-broken
// Registered as a Singleton: every request shares this one object.
// ConcurrentDictionary makes each single call safe, but NOT the read-modify-write sequence.
public sealed class UnsafeCartService(IInventoryClient inventory) : ICartService
{
    private readonly ConcurrentDictionary<int, int> _quantities = new();

    public async Task AddAsync(int productId, int quantity, CancellationToken cancellationToken)
    {
        var current = _quantities.GetValueOrDefault(productId);                                   // 1. read
        await inventory.EnsureInStockAsync(productId, current + quantity, cancellationToken);    // 2. other requests read the same value meanwhile
        _quantities[productId] = current + quantity;                                              // 3. write a stale value: lost update
    }

    public void SetQuantity(int productId, int quantity)
    {
        if (quantity <= 0) _quantities.TryRemove(productId, out _);
        else _quantities[productId] = quantity;
    }

    public IReadOnlyList<CartItem> Items() => _quantities.Select(q => new CartItem(q.Key, q.Value)).ToList();

    public void Clear() => _quantities.Clear();
}
// #endregion

// #region snippet:thread-safety-broken
// "Look up every cart line in parallel, the cart page will load faster."
// All the tasks share the request's ONE ShopDbContext, and a DbContext runs one operation at a time.
public sealed class ParallelCartSummary(ICartService cart, ShopDbContext db) : ICartSummary
{
    public async Task<CartView> GetAsync(CancellationToken cancellationToken)
    {
        var lines = await Task.WhenAll(cart.Items().Select(async item =>
        {
            var product = await db.Products.AsNoTracking().SingleAsync(p => p.Id == item.ProductId, cancellationToken);
            return CartSummary.Line(product, item.Quantity);
        }));
        return CartSummary.Build(lines);
    }
}
// #endregion

// #region snippet:background-job-broken
// A hosted service is a Singleton, so the ShopDbContext (and the IEmailSender built on another one)
// received here are created once and kept for the life of the app.
public sealed class CaptiveFulfilmentWorker(
    ShopDbContext db,
    IEmailSender email,
    TimeProvider clock,
    ILogger<CaptiveFulfilmentWorker> logger) : FulfilmentLoop(clock, logger)
{
    public override Task<int> ShipDueOrdersAsync(CancellationToken cancellationToken) =>
        Fulfilment.ShipDueOrdersAsync(db, email, Now, cancellationToken);
}
// #endregion
