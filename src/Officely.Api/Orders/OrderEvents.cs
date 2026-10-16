using Officely.Api.Notifications;

namespace Officely.Api.Orders;

// #region snippet:order-events
public sealed record OrderCompleted(int OrderId, string CustomerEmail, decimal Total);

public interface IOrderCompletedHandler
{
    Task HandleAsync(OrderCompleted e, CancellationToken cancellationToken);
}

// In-process dispatch: handlers run inside the same request.
// NOT durable: if the process crashes after the payment but before a handler runs, the event is lost.
// Guaranteed delivery needs a transactional outbox or a message broker. DI does not provide that.
public sealed class OrderEventDispatcher(IEnumerable<IOrderCompletedHandler> handlers)
{
    public async Task PublishAsync(OrderCompleted e, CancellationToken cancellationToken)
    {
        foreach (var handler in handlers)
            await handler.HandleAsync(e, cancellationToken);
    }
}

// Everything it needs is in the event: no dependency back on the order service.
public sealed class OrderConfirmationEmailHandler(IEmailSender email) : IOrderCompletedHandler
{
    public Task HandleAsync(OrderCompleted e, CancellationToken cancellationToken) =>
        email.SendAsync(e.CustomerEmail, $"Order #{e.OrderId} confirmed",
            $"Thanks for your order! We received your payment of {e.Total:0.00} and will ship it soon.", cancellationToken);
}
// #endregion
