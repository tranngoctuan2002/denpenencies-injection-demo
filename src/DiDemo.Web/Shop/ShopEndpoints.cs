using DiDemo.Web.Data;
using DiDemo.Web.Demos.Basics;
using DiDemo.Web.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Shop;

public record SettingsDto(string PaymentProvider, string NotifyChannel);

public static class ShopEndpoints
{
    public static IEndpointRouteBuilder MapShop(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/products", (ShopDbContext db) =>
            db.Products.AsNoTracking().OrderBy(p => p.Id).ToListAsync());

        // Returns the order result AND the dependency tree annotated with the very objects used in this request.
        api.MapPost("/orders", async (PlaceOrderRequest request, IOrderService orders, LifetimeCatalog catalog, CancellationToken ct) =>
        {
            var result = await orders.PlaceOrderAsync(request, ct);
            return Results.Ok(new { order = result, graph = catalog.Describe(typeof(IOrderService), result.Trace) });
        });

        // Same order, but every step is sent to the browser the moment OrderService completes it (real-time progress).
        api.MapPost("/orders/stream", async (HttpContext http, PlaceOrderRequest request, IOrderService orders, LifetimeCatalog catalog) =>
        {
            var nd = NdjsonStream.Begin(http);
            var steps = System.Threading.Channels.Channel.CreateUnbounded<OrderStep>();
            var progress = new SyncProgress<OrderStep>(s => steps.Writer.TryWrite(s));
            try
            {
                var task = orders.PlaceOrderAsync(request, http.RequestAborted, progress);
                _ = task.ContinueWith(_ => steps.Writer.TryComplete(), TaskScheduler.Default);

                await foreach (var step in steps.Reader.ReadAllAsync(http.RequestAborted))
                    await nd.EmitAsync(new { type = "step", step });

                var result = await task;
                await nd.EmitAsync(new { type = "result", order = result, graph = catalog.Describe(typeof(IOrderService), result.Trace) });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await nd.EmitAsync(new { type = "error", message = ex.Message });
            }
        });

        api.MapGet("/orders", (IOrderRepository orders) => orders.RecentAsync(8));

        api.MapGet("/audit", (IAuditLog audit) => audit.RecentAsync(12));

        api.MapGet("/metrics", (IOrderMetrics metrics) => metrics.Snapshot());

        api.MapGet("/notifications", (INotificationLog log) => log.Recent());

        api.MapPost("/reset", async (ShopDbContext db, INotificationLog log, DemoSettings settings) =>
        {
            await DbInitializer.ResetAsync(db);
            log.Clear();
            settings.PaymentProvider = "stripe";
            settings.NotifyChannel = "email";
            return Results.Ok(new { reset = true });
        });

        // The real dependency tree, read from the constructors (what the container will build).
        api.MapGet("/graph", (string service, LifetimeCatalog catalog) => service switch
        {
            "order" => Results.Ok(catalog.Describe(typeof(IOrderService))),
            "checkout" => Results.Ok(catalog.Describe(typeof(ICheckout))),
            _ => Results.BadRequest("service must be 'order' or 'checkout'")
        });

        api.MapGet("/settings", (DemoSettings s) => new SettingsDto(s.PaymentProvider, s.NotifyChannel));

        api.MapPost("/settings", (SettingsDto dto, DemoSettings s) =>
        {
            s.PaymentProvider = dto.PaymentProvider is "stripe" or "paypal" or "offline" ? dto.PaymentProvider : "stripe";
            s.NotifyChannel = dto.NotifyChannel is "email" or "sms" or "push" or "all" ? dto.NotifyChannel : "email";
            return new SettingsDto(s.PaymentProvider, s.NotifyChannel);
        });

        api.MapGet("/catalog", (LifetimeCatalog catalog) => catalog.Registrations());

        api.MapGet("/snippets", (string names, SnippetReader reader) =>
            reader.Get(names.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)));

        return app;
    }
}
