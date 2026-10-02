namespace DiDemo.Web.Demos.Lifetimes;

// The feature: "checkout". Three services run in order: CartService -> PaymentService -> ReceiptService.
// EVERY one of them receives the same three helpers - registered with three different lifetimes.

// #region snippet:lifetimes-helpers
// Transient: a small calculator. Everyone who asks gets their OWN.
public interface IPriceCalculator { Guid Id { get; } int Calls { get; } decimal AddTax(decimal amount); }
public class PriceCalculator : IPriceCalculator
{
    public Guid Id { get; } = Guid.NewGuid();
    public int Calls { get; private set; }
    public decimal AddTax(decimal amount) { Calls++; return Math.Round(amount * 1.08m, 2); }
}

// Scoped: the log of ONE customer visit. Everyone in the same request writes into the SAME log.
public record LogLine(string Service, string What);
public interface IRequestLog { Guid Id { get; } void Add(string service, string what); IReadOnlyList<LogLine> Lines { get; } }
public class RequestLog : IRequestLog
{
    private readonly List<LogLine> _lines = [];
    public Guid Id { get; } = Guid.NewGuid();
    public void Add(string service, string what) { lock (_lines) _lines.Add(new LogLine(service, what)); }
    public IReadOnlyList<LogLine> Lines { get { lock (_lines) return _lines.ToList(); } }
}

// Singleton: the shop-wide counter. Every request, every user, shares this one.
public interface IShopCounter { Guid Id { get; } int Increment(); int Value { get; } int Touch(); }
public class ShopCounter : IShopCounter
{
    private int _orders;
    public Guid Id { get; } = Guid.NewGuid();
    public int Increment() => Interlocked.Increment(ref _orders);
    public int Value => Volatile.Read(ref _orders);

    private int _touches;
    public int Touch() => Interlocked.Increment(ref _touches);   // how many times has anyone used it (in any request)?
}
// #endregion

public record StepView(string Service, string What, Guid Calculator, int CalculatorCalls, Guid RequestLog, bool LogReused, Guid Counter, bool CounterReused);

// #region snippet:lifetimes-flow
// All three services ask for the SAME three helpers in their constructor.
public abstract class FlowStep(IPriceCalculator calculator, IRequestLog log, IShopCounter counter)
{
    public abstract string Name { get; }
    protected abstract string What { get; }
    protected virtual void Work(IShopCounter counter) { }

    public StepView Run(decimal amount)
    {
        var total = calculator.AddTax(amount);                 // Transient: this service's own calculator
        var logReused = log.Lines.Count > 0;                   // Scoped: did someone in THIS request already use the log?
        log.Add(Name, $"{What} ({total:0.00})");               //         (the request's shared log)
        var counterReused = counter.Touch() > 1;               // Singleton: has anyone (in any request) used it before?
        Work(counter);
        return new StepView(Name, What, calculator.Id, calculator.Calls, log.Id, logReused, counter.Id, counterReused);
    }
}

public class CartService(IPriceCalculator c, IRequestLog l, IShopCounter g) : FlowStep(c, l, g)
{
    public override string Name => "CartService";
    protected override string What => "totalled the cart";
}

public class PaymentService(IPriceCalculator c, IRequestLog l, IShopCounter g) : FlowStep(c, l, g)
{
    public override string Name => "PaymentService";
    protected override string What => "charged the card";
}

public class ReceiptService(IPriceCalculator c, IRequestLog l, IShopCounter g) : FlowStep(c, l, g)
{
    public override string Name => "ReceiptService";
    protected override string What => "sent the receipt";
    protected override void Work(IShopCounter counter) => counter.Increment();   // one more order for the shop
}
// #endregion

public record FlowView(List<StepView> Steps, Guid RequestLogId, List<LogLine> Log, Guid CounterId, int OrdersSoFar);

public class CheckoutFlow(CartService cart, PaymentService payment, ReceiptService receipt, IRequestLog log, IShopCounter counter)
{
    public FlowView Run(decimal amount = 100m)
    {
        var steps = new List<StepView> { cart.Run(amount), payment.Run(amount), receipt.Run(amount) };
        return new FlowView(steps, log.Id, log.Lines.ToList(), counter.Id, counter.Value);
    }
}

public static class LifetimesDemo
{
    public static IEndpointRouteBuilder MapLifetimesDemo(this IEndpointRouteBuilder app)
    {
        // One HTTP request = one scope = one run of the three-service flow.
        app.MapGet("/api/lifetimes/flow", (CheckoutFlow flow) => flow.Run());

        // #region snippet:lifetimes-scopes
        // "Scoped" means per SCOPE, not per HTTP request. ASP.NET Core just happens to open one scope per request.
        app.MapGet("/api/lifetimes/scopes", (IServiceScopeFactory factory, CheckoutFlow requestFlow) =>
        {
            var inRequest = requestFlow.Run();

            using var scope1 = factory.CreateScope();
            var inScope1 = scope1.ServiceProvider.GetRequiredService<CheckoutFlow>().Run();

            using var scope2 = factory.CreateScope();
            var inScope2 = scope2.ServiceProvider.GetRequiredService<CheckoutFlow>().Run();

            return new { request = inRequest, scope1 = inScope1, scope2 = inScope2 };
        });
        // #endregion

        return app;
    }
}
