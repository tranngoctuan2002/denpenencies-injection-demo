using DiDemo.Web.Data;
using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;

namespace DiDemo.Web.Demos.CaseStudies;

public record CallEntry(string Who, string What);

/// <summary>Every fake writes into one shared list, so we can show exactly who was called, in what order.</summary>
public class CallLog
{
    public List<CallEntry> Calls { get; } = [];
    public void Add(string who, string what) => Calls.Add(new CallEntry(who, what));
}

// #region snippet:mocks-fakes
// Hand-written fakes (the unit tests use NSubstitute to generate the same thing).
// They run the REAL OrderService - only its collaborators are replaced.
public class FakeInventory(CallLog log, bool inStock) : IInventoryService
{
    public Task<Reservation> ReserveAsync(IReadOnlyList<CartItem> items, CancellationToken ct = default)
    {
        log.Add("InventoryService", "ReserveAsync");
        return Task.FromResult(inStock
            ? new Reservation(true, null, [new OrderLine { ProductId = 1, ProductName = "Mouse", Quantity = 2, UnitPrice = 35m }])
            : new Reservation(false, "Only 1 x Mouse left in stock.", []));
    }

    public Task CommitAsync(IReadOnlyList<OrderLine> lines, CancellationToken ct = default)
    {
        log.Add("InventoryService", "CommitAsync (reduce stock)");
        return Task.CompletedTask;
    }
}

public class FakePayments(CallLog log, string mode) : IPaymentGateway
{
    public Task<PaymentResult> ChargeAsync(decimal amount, string customer, CancellationToken ct = default)
    {
        log.Add("PaymentGateway", "ChargeAsync");
        return mode switch
        {
            "decline" => Task.FromResult(new PaymentResult(false, null, "card_declined", 0, "FakePay")),
            "timeout" => throw new TimeoutException("the payment provider did not answer"),
            _ => Task.FromResult(new PaymentResult(true, "ch_test", null, 2.33m, "FakePay"))
        };
    }
}
// #endregion

public class FakePricing(CallLog log) : IPricingService
{
    public Pricing Price(IReadOnlyList<OrderLine> lines, string user)
    {
        log.Add("PricingService", "Price");
        return new Pricing(70m, 0m, 5.60m, 75.60m, []);
    }
}

public class FakeOrders(CallLog log) : IOrderRepository
{
    public Task SaveAsync(Order order, CancellationToken ct = default) { log.Add("OrderRepository", "SaveAsync"); return Task.CompletedTask; }
    public Task<List<Order>> RecentAsync(int count, CancellationToken ct = default) => Task.FromResult(new List<Order>());
}

public class FakeNotifier(CallLog log) : INotifier
{
    public string Channel => "email";
    public Task SendAsync(string to, string message) { log.Add("Notifier", "SendAsync (confirmation)"); return Task.CompletedTask; }
}

public class FakeAudit(CallLog log) : IAuditLog
{
    public Task WriteAsync(string message, CancellationToken ct = default) { log.Add("AuditLog", $"WriteAsync \"{message}\""); return Task.CompletedTask; }
    public Task<List<AuditEntry>> RecentAsync(int count, CancellationToken ct = default) => Task.FromResult(new List<AuditEntry>());
}

public class FakeMetrics(CallLog log) : IOrderMetrics
{
    public void OrderPlaced(decimal total) => log.Add("OrderMetrics", "OrderPlaced");
    public MetricsSnapshot Snapshot() => new(0, 0m);
}

public class FixedClock : IClock
{
    public DateTime UtcNow => new(2026, 1, 15, 9, 30, 0, DateTimeKind.Utc);
}

public class FakeContext : IRequestContext
{
    public Guid CorrelationId { get; } = Guid.Parse("00000000-0000-0000-0000-00000000c0de");
    public string User { get; set; } = "alice";
    public IReadOnlyList<TraceEntry> Trace => [];
    public void Touch(object? service) { }
}

public static class MockDemo
{
    public static readonly string[] Collaborators =
        ["InventoryService", "PricingService", "PaymentGateway", "OrderRepository", "Notifier", "OrderMetrics", "AuditLog"];

    public static async Task<object> RunAsync(string payment, string stock)
    {
        var log = new CallLog();

        // #region snippet:mocks-run
        // The real OrderService, with every collaborator replaced by a fake:
        var service = new OrderService(
            new FakeInventory(log, inStock: stock != "out"),
            new FakePricing(log),
            new FakePayments(log, payment),
            new FakeOrders(log),
            new FakeNotifier(log),
            new FakeAudit(log),
            new FakeMetrics(log),
            new FixedClock(),
            new FakeContext());
        // #endregion

        string outcome, message;
        try
        {
            var result = await service.PlaceOrderAsync(new PlaceOrderRequest([new CartItem(1, 2)]));
            outcome = result.Success ? "placed" : "rejected";
            message = result.Message;
        }
        catch (Exception ex)
        {
            outcome = "exception";
            message = $"{ex.GetType().Name}: {ex.Message}";
        }

        return new
        {
            outcome,
            message,
            collaborators = Collaborators,
            calls = log.Calls
        };
    }
}
