using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;

namespace DiDemo.Web.Demos.Basics;

public interface ICheckout
{
    Task<List<string>> RunAsync(decimal amount);
}

// #region snippet:basics-v1
// V1 - tightly coupled. The class decides *which* gateway and mailer it uses, with `new`.
// You cannot swap the gateway, cannot fake the clock, cannot unit-test without charging a card.
public class CoupledCheckout : ICheckout
{
    private readonly StripeClient _gateway = new();
    private readonly SmtpMailer _mailer = new();

    public async Task<List<string>> RunAsync(decimal amount)
    {
        var steps = new List<string> { $"Charging {amount:0.00} via the hard-coded StripeClient" };
        var ok = await _gateway.ChargeAsync(amount);
        steps.Add(ok ? "Payment approved via Stripe" : "Payment declined");
        _mailer.Send("customer@example.com", "Thanks for your order");
        steps.Add("Email sent via hard-coded SmtpMailer");
        return steps;
    }

    private sealed class StripeClient
    {
        public async Task<bool> ChargeAsync(decimal amount) { await Task.Delay(150); return true; }
    }

    private sealed class SmtpMailer
    {
        public void Send(string to, string body) { }
    }
}
// #endregion

// #region snippet:basics-v3
// V2/V3 - the class only declares WHAT it needs (abstractions). Someone else decides the HOW.
//   V2: Main wires everything by hand (new Checkout(new StripeGateway(ctx), ...)).
//   V3: the container reads this constructor and builds the whole graph for us.
public class Checkout(IPaymentGateway gateway, INotifier notifier, IClock clock, IRequestContext ctx)
    : Traceable, ICheckout
{
    public async Task<List<string>> RunAsync(decimal amount)
    {
        ctx.Touch(this); ctx.Touch(clock);
        var steps = new List<string> { $"Charging {amount:0.00} via {gateway.GetType().Name}" };
        var result = await gateway.ChargeAsync(amount, ctx.User);
        steps.Add(result.Approved
            ? $"Payment approved via {result.Provider} (provider fee {result.Fee:0.00})"
            : $"Payment declined by {result.Provider} ({result.Error})");
        if (!result.Approved) return steps;

        await notifier.SendAsync(ctx.User, $"Thanks for your order ({amount:0.00})");
        steps.Add($"Notification sent via '{notifier.Channel}'");
        return steps;
    }
}
// #endregion

// #region snippet:basics-v4
// V4 - Service Locator (anti-pattern). It "works", but the constructor lies about the
// dependencies: they are hidden inside the method, only fail at runtime, and are hard to mock.
public class ServiceLocatorCheckout(IServiceProvider provider) : Traceable, ICheckout
{
    public async Task<List<string>> RunAsync(decimal amount)
    {
        var gateway = provider.GetRequiredService<IPaymentGateway>();   // hidden dependency
        var notifier = provider.GetRequiredService<INotifier>();        // hidden dependency
        var ctx = provider.GetRequiredService<IRequestContext>();
        ctx.Touch(this);

        var steps = new List<string> { $"Resolved {gateway.GetType().Name} and {notifier.Channel} notifier from IServiceProvider inside the method" };
        var result = await gateway.ChargeAsync(amount, ctx.User);
        steps.Add(result.Approved
            ? $"Payment approved via {result.Provider} (provider fee {result.Fee:0.00})"
            : $"Payment declined by {result.Provider} ({result.Error})");
        return steps;
    }
}
// #endregion

public static class BasicsDemo
{
    public static IEndpointRouteBuilder MapBasicsDemo(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/basics/run", async (
            string version,
            decimal amount,
            DemoSettings settings,
            IClock clock,
            INotificationLog log,
            LifetimeCatalog catalog,
            IRequestContext requestCtx,
            ICheckout containerCheckout,
            IServiceProvider provider) =>
        {
            switch (version)
            {
                case "v1":
                    return Results.Ok(new { version, note = "Settings are ignored - the gateway is hard-coded.", steps = await new CoupledCheckout().RunAsync(amount), trace = Array.Empty<TraceEntry>() });

                case "v2":
                {
                    // Manual wiring ("poor man's DI"): we build the graph, and we own every lifetime.
                    var ctx = new RequestContext(catalog) { User = requestCtx.User };
                    IPaymentGateway gateway = settings.PaymentProvider switch
                    {
                        "paypal" => new PayPalGateway(ctx),
                        "offline" => new OfflineGateway(ctx),
                        _ => new StripeGateway(ctx)
                    };
                    INotifier notifier = new EmailNotifier(log, ctx);
                    var checkout = new Checkout(gateway, notifier, clock, ctx);
                    return Results.Ok(new { version, note = "Wired by hand in the endpoint.", steps = await checkout.RunAsync(amount), trace = ctx.Trace });
                }

                case "v3":
                    return Results.Ok(new { version, note = "Resolved by the container.", steps = await containerCheckout.RunAsync(amount), trace = requestCtx.Trace });

                case "v4":
                {
                    var locator = ActivatorUtilities.CreateInstance<ServiceLocatorCheckout>(provider);
                    return Results.Ok(new { version, note = "Service locator - works, but hides dependencies.", steps = await locator.RunAsync(amount), trace = requestCtx.Trace });
                }

                default:
                    return Results.BadRequest("version must be v1..v4");
            }
        });

        return app;
    }
}
