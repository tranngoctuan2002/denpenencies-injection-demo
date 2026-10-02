using DiDemo.Web.Data;
using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;
using NSubstitute;

namespace DiDemo.Tests;

// #region snippet:tests-arrange
// Because OrderService only depends on interfaces, a test can hand it fakes:
// no SQL Server, no real payment provider, no real clock, no real e-mail.
public class OrderServiceTests
{
    private readonly IInventoryService _inventory = Substitute.For<IInventoryService>();
    private readonly IPricingService _pricing = Substitute.For<IPricingService>();
    private readonly IPaymentGateway _payments = Substitute.For<IPaymentGateway>();
    private readonly IOrderRepository _orders = Substitute.For<IOrderRepository>();
    private readonly INotifier _notifier = Substitute.For<INotifier>();
    private readonly IAuditLog _audit = Substitute.For<IAuditLog>();
    private readonly IOrderMetrics _metrics = Substitute.For<IOrderMetrics>();
    private readonly IClock _clock = Substitute.For<IClock>();
    private readonly IRequestContext _ctx = Substitute.For<IRequestContext>();

    private static readonly DateTime FixedNow = new(2026, 1, 15, 9, 30, 0, DateTimeKind.Utc);

    private readonly List<OrderLine> _lines = [new() { ProductId = 1, ProductName = "Mouse", Quantity = 2, UnitPrice = 35m }];
    private static readonly PlaceOrderRequest Request = new([new CartItem(1, 2)]);

    public OrderServiceTests()
    {
        _clock.UtcNow.Returns(FixedNow);
        _ctx.User.Returns("alice");
        _ctx.Trace.Returns([]);
        _notifier.Channel.Returns("email");
        _inventory.ReserveAsync(Arg.Any<IReadOnlyList<CartItem>>(), Arg.Any<CancellationToken>())
            .Returns(new Reservation(true, null, _lines));
        _pricing.Price(Arg.Any<IReadOnlyList<OrderLine>>(), "alice")
            .Returns(new Pricing(70m, 0m, 5.60m, 75.60m, []));
    }

    private OrderService CreateSut() =>
        new(_inventory, _pricing, _payments, _orders, _notifier, _audit, _metrics, _clock, _ctx);
    // #endregion

    // #region snippet:tests-success
    [Fact]
    public async Task Approved_payment_saves_order_notifies_customer_and_records_metrics()
    {
        _payments.ChargeAsync(75.60m, "alice", Arg.Any<CancellationToken>())
            .Returns(new PaymentResult(true, "ch_123", null));

        var result = await CreateSut().PlaceOrderAsync(Request);

        Assert.True(result.Success);
        await _orders.Received(1).SaveAsync(
            Arg.Is<Order>(o => o.Total == 75.60m && o.CreatedAt == FixedNow && o.PaymentReference == "ch_123"),
            Arg.Any<CancellationToken>());
        await _notifier.Received(1).SendAsync("alice", Arg.Is<string>(m => m.Contains("75.60")));
        _metrics.Received(1).OrderPlaced(75.60m);
    }
    // #endregion

    // #region snippet:tests-declined
    [Fact]
    public async Task Declined_payment_saves_nothing_and_sends_no_email()
    {
        _payments.ChargeAsync(Arg.Any<decimal>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new PaymentResult(false, null, "card_declined"));

        var result = await CreateSut().PlaceOrderAsync(Request);

        Assert.False(result.Success);
        Assert.Contains("declined", result.Message);
        Assert.Contains(result.Steps, s => !s.Ok);
        await _inventory.DidNotReceive().CommitAsync(Arg.Any<IReadOnlyList<OrderLine>>(), Arg.Any<CancellationToken>());
        await _orders.DidNotReceive().SaveAsync(Arg.Any<Order>(), Arg.Any<CancellationToken>());
        await _notifier.DidNotReceive().SendAsync(Arg.Any<string>(), Arg.Any<string>());
        _metrics.DidNotReceive().OrderPlaced(Arg.Any<decimal>());
        await _audit.Received().WriteAsync(Arg.Is<string>(m => m.Contains("declined")), Arg.Any<CancellationToken>());
    }
    // #endregion

    [Fact]
    public async Task Out_of_stock_never_charges_the_card()
    {
        _inventory.ReserveAsync(Arg.Any<IReadOnlyList<CartItem>>(), Arg.Any<CancellationToken>())
            .Returns(new Reservation(false, "Only 1 x Mouse left in stock.", []));

        var result = await CreateSut().PlaceOrderAsync(Request);

        Assert.False(result.Success);
        await _payments.DidNotReceive().ChargeAsync(Arg.Any<decimal>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Gateway_exception_bubbles_up_before_anything_is_saved()
    {
        _payments.ChargeAsync(Arg.Any<decimal>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<PaymentResult>(_ => throw new TimeoutException("gateway timed out"));

        await Assert.ThrowsAsync<TimeoutException>(() => CreateSut().PlaceOrderAsync(Request));

        await _orders.DidNotReceive().SaveAsync(Arg.Any<Order>(), Arg.Any<CancellationToken>());
    }
}

// #region snippet:tests-pricing
// Pure logic + several implementations of IDiscountRule: pass exactly the rules you want to test.
public class PricingServiceTests
{
    private static PricingService Create(params IDiscountRule[] rules) =>
        new(rules, Substitute.For<IRequestContext>());

    private static readonly List<OrderLine> Lines =
        [new() { ProductName = "Mouse", Quantity = 5, UnitPrice = 10m }];

    [Fact]
    public void Bulk_rule_gives_ten_percent_and_tax_is_added_after_discount()
    {
        var price = Create(new BulkDiscountRule()).Price(Lines, "alice");

        Assert.Equal(50m, price.Subtotal);
        Assert.Equal(5m, price.Discount);
        Assert.Equal(3.60m, price.Tax);   // 8% of 45
        Assert.Equal(48.60m, price.Total);
    }

    [Fact]
    public void Vip_rule_only_applies_to_vip_users()
    {
        var sut = Create(new LoyaltyDiscountRule());
        Assert.Equal(0m, sut.Price(Lines, "alice").Discount);
        Assert.Equal(2.50m, sut.Price(Lines, "vip").Discount);
    }

    [Fact]
    public void Rules_stack()
    {
        var price = Create(new BulkDiscountRule(), new LoyaltyDiscountRule()).Price(Lines, "vip");
        Assert.Equal(7.50m, price.Discount);
        Assert.Equal(2, price.AppliedRules.Count);
    }
}
// #endregion

// Guards the lessons: the singleton fix is thread-safe, the broken one is not.
public class MetricsTests
{
    [Fact]
    public async Task Safe_metrics_never_lose_updates()
    {
        var metrics = new OrderMetrics();
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() =>
        {
            for (var i = 0; i < 20_000; i++) metrics.OrderPlaced(10m);
        })));

        Assert.Equal(160_000, metrics.Snapshot().OrdersPlaced);
        Assert.Equal(1_600_000m, metrics.Snapshot().Revenue);
    }
}
