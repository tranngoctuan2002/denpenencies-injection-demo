using DiDemo.Web.Data;
using DiDemo.Web.Infrastructure;

namespace DiDemo.Web.Shop;

public record PlaceOrderRequest(List<CartItem> Items);

/// <summary>One step of the checkout: what happened, and WHICH service did it.</summary>
public record OrderStep(string Text, string Service, bool Ok = true);

public record OrderResult(
    bool Success,
    string Message,
    int? OrderId,
    Guid CorrelationId,
    string User,
    Pricing? Pricing,
    IReadOnlyList<OrderStep> Steps,
    IReadOnlyList<TraceEntry> Trace);

public interface IOrderService
{
    Task<OrderResult> PlaceOrderAsync(PlaceOrderRequest request, CancellationToken ct = default, IProgress<OrderStep>? progress = null);
}

// #region snippet:order-service
// Every collaborator arrives through the constructor and is an interface:
// OrderService has no idea which payment gateway, notifier or clock it is talking to.
public class OrderService(
    IInventoryService inventory,
    IPricingService pricing,
    IPaymentGateway payments,
    IOrderRepository orders,
    INotifier notifier,
    IAuditLog audit,
    IOrderMetrics metrics,
    IClock clock,
    IRequestContext ctx) : Traceable, IOrderService
{
    public async Task<OrderResult> PlaceOrderAsync(PlaceOrderRequest request, CancellationToken ct = default, IProgress<OrderStep>? progress = null)
    {
        var steps = new List<OrderStep>();
        void Step(OrderStep s) { steps.Add(s); progress?.Report(s); }   // lets the UI watch each step as it completes
        ctx.Touch(this); ctx.Touch(ctx); ctx.Touch(clock); ctx.Touch(metrics); ctx.Touch(orders);

        OrderResult Fail(string message, string service, Pricing? p = null)
        {
            Step(new OrderStep(message, service, false));
            return new OrderResult(false, message, null, ctx.CorrelationId, ctx.User, p, steps, ctx.Trace);
        }

        await audit.WriteAsync("Order requested", ct);

        var reservation = await inventory.ReserveAsync(request.Items, ct);
        if (!reservation.Success)
        {
            await audit.WriteAsync($"Rejected: {reservation.Error}", ct);
            return Fail(reservation.Error!, nameof(InventoryService));
        }
        Step(new OrderStep($"Checked stock for {reservation.Lines.Count} product(s)", nameof(InventoryService)));

        var price = pricing.Price(reservation.Lines, ctx.User);
        Step(new OrderStep(
            $"Worked out the price: {price.Total:0.00}" + (price.Discount > 0 ? $" (after {price.Discount:0.00} discount)" : ""),
            nameof(PricingService)));

        var payment = await payments.ChargeAsync(price.Total, ctx.User, ct);
        if (!payment.Approved)
        {
            await audit.WriteAsync($"Payment declined ({payment.Error})", ct);
            return Fail($"Payment failed ({payment.Error}). Nothing was saved and stock is untouched.", payments.GetType().Name, price);
        }
        Step(new OrderStep($"Charged {price.Total:0.00} via {payment.Provider} (provider fee {payment.Fee:0.00})", payments.GetType().Name));

        await inventory.CommitAsync(reservation.Lines, ct);
        var order = new Order
        {
            CorrelationId = ctx.CorrelationId,
            Customer = ctx.User,
            Subtotal = price.Subtotal, Discount = price.Discount, Tax = price.Tax, Total = price.Total,
            PaymentReference = payment.Reference!,
            CreatedAt = clock.UtcNow,
            Lines = reservation.Lines.ToList()
        };
        await orders.SaveAsync(order, ct);
        Step(new OrderStep($"Saved order #{order.Id} and reduced stock", nameof(OrderRepository)));

        metrics.OrderPlaced(price.Total);
        await notifier.SendAsync(ctx.User, $"Order #{order.Id} confirmed - total {price.Total:0.00}");
        Step(new OrderStep($"Sent a confirmation by {notifier.Channel}", notifier.GetType().Name));
        await audit.WriteAsync($"Order #{order.Id} placed", ct);

        return new OrderResult(true, $"Order #{order.Id} placed.", order.Id, ctx.CorrelationId, ctx.User, price, steps, ctx.Trace);
    }
}
// #endregion
