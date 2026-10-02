using DiDemo.Web.Data;
using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DiDemo.Web.Demos.CaseStudies;

public static class CaseEndpoints
{
    private static readonly Dictionary<string, Type> Senders = new()
    {
        ["email"] = typeof(EmailSender),
        ["sms"] = typeof(SmsSender),
        ["push"] = typeof(PushSender)
    };

    public static IEndpointRouteBuilder MapCaseStudies(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/cases");
        app.MapLabs();   // B (captive) and E (background worker) need a running app: see Labs.cs

        // ---------- A. Circular: what does InventoryService ask for? ----------
        g.MapGet("/circular", (string inventory, bool? preview) =>
        {
            // #region snippet:circular-run
            Action<IServiceCollection> configure = s =>
            {
                s.AddTransient<ICircularOrders, CircularOrderService>();
                if (inventory == "orders")
                {
                    s.AddTransient<ICircularInventory, CircularInventoryService>();   // needs ICircularOrders
                }
                else
                {
                    s.AddSingleton<IPendingOrderQuery, PendingOrderQuery>();
                    s.AddTransient<ICircularInventory, LeanInventoryService>();       // needs IPendingOrderQuery
                }
            };
            // #endregion

            // the tree the container would build (a loop is marked as a cycle)
            var graph = MiniContainer.Describe(configure, typeof(ICircularOrders));
            if (preview == true) return new CaseResult("info", "preview", graph);

            try
            {
                using var provider = MiniContainer.Build(configure, validate: false);
                var result = provider.GetRequiredService<ICircularOrders>().Place();   // throws InvalidOperationException on a loop
                return new CaseResult("ok", result, graph);
            }
            catch (Exception ex) { return new CaseResult("error", $"{ex.GetType().Name}: {ex.Message}", graph); }
        });

        // ---------- C. DbContext: how do you load the prices? (real SQL Server) ----------
        // With stream=true every task start/end is sent the moment it happens (NDJSON), so the UI can draw it live.
        g.MapGet("/dbcontext", async (HttpContext http, string mode, ShopDbContext db, IDbContextFactory<ShopDbContext> factory, int? parallel, bool? stream) =>
        {
            var n = Math.Clamp(parallel ?? 10, 2, 30);
            var ids = await db.Products.AsNoTracking().Select(p => p.Id).ToArrayAsync();
            var nd = stream == true ? NdjsonStream.Begin(http) : null;
            Func<object, Task>? emit = nd is null ? null : nd.EmitAsync;

            var summary = mode switch
            {
                "sequential" => await DbContextConcurrency.RunSequentialAsync(db, ids, n, emit),
                "shared" => await DbContextConcurrency.RunSharedAsync(db, ids, n, emit),
                _ => await DbContextConcurrency.RunWithFactoryAsync(factory, ids, n, emit)
            };

            if (nd is null) return Results.Ok(summary);
            await nd.EmitAsync(new { type = "done", summary });
            return Results.Empty;
        });

        // ---------- D. Singleton race: how do you update it, and how many requests at once? ----------
        // With stream=true the counters are sampled every 40 ms while the workers run (NDJSON).
        g.MapGet("/race", async (HttpContext http, string mode, int? workers, bool? stream) =>
        {
            var w = Math.Clamp(workers ?? 8, 1, 16);

            using var provider = MiniContainer.Build(s =>
            {
                switch (mode)
                {
                    case "unsafe": s.AddSingleton<IOrderMetrics, UnsafeOrderMetrics>(); break;   // count++
                    case "lock": s.AddSingleton<IOrderMetrics, LockedOrderMetrics>(); break;     // lock
                    default: s.AddSingleton<IOrderMetrics, OrderMetrics>(); break;               // Interlocked
                }
            }, validate: true);
            var metrics = provider.GetRequiredService<IOrderMetrics>();

            var nd = stream == true ? NdjsonStream.Begin(http) : null;
            await RaceRunner.RunAsync(metrics, w, nd is null ? null : nd.EmitAsync);

            var snap = metrics.Snapshot();
            var expected = w * RaceRunner.PerWorker;
            var lost = expected - snap.OrdersPlaced;
            var result = new CaseResult(
                lost == 0 ? "ok" : "bug",
                lost == 0 ? "Every update was counted." : $"{lost:N0} updates were lost - no exception, just wrong numbers.",
                new { mode, workers = w, perWorker = RaceRunner.PerWorker, expectedOrders = expected, actualOrders = snap.OrdersPlaced, expectedRevenue = expected * 10m, actualRevenue = snap.Revenue, lost });

            if (nd is null) return Results.Ok(result);
            await nd.EmitAsync(new { type = "done", result });
            return Results.Empty;
        });

        // ---------- F. Mocks: run the REAL OrderService against fakes ----------
        g.MapGet("/mocks", async (string payment, string stock) => await MockDemo.RunAsync(payment, stock));

        // ---------- G. Multiple implementations: what do you register, in which order, and how do you ask? ----------
        g.MapGet("/multi", (string register, string how, string? key, bool? tryAdd) =>
        {
            var names = register.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(Senders.ContainsKey).Distinct().ToList();
            try
            {
                // #region snippet:multi-run
                using var provider = MiniContainer.Build(s =>
                {
                    foreach (var name in names)
                    {
                        var type = Senders[name];
                        if (tryAdd == true) s.TryAdd(ServiceDescriptor.Singleton(typeof(IMessageSender), type));   // skipped if one exists
                        else s.AddSingleton(typeof(IMessageSender), type);
                        s.AddKeyedSingleton(typeof(IMessageSender), name, type);                                   // also reachable by name
                    }
                }, validate: true);
                // #endregion

                var registered = provider.GetServices<IMessageSender>().Select(m => m.Name).ToArray();
                var skipped = names.Except(registered).ToArray();
                object Data(string[] picked, string howText) => new { registered, skipped, picked, how = howText };

                switch (how)
                {
                    // plain resolve -> the LAST registration wins (throws if there is none)
                    case "one":
                    {
                        var sender = provider.GetRequiredService<IMessageSender>();
                        return registered.Length > 1
                            ? new CaseResult("bug", $"{registered.Length} senders are registered, but you only get one: the last. The others are silently ignored.", Data([sender.Name], "GetRequiredService<IMessageSender>()"))
                            : new CaseResult("ok", "Only one sender is registered, so there is no ambiguity.", Data([sender.Name], "GetRequiredService<IMessageSender>()"));
                    }

                    // IEnumerable<T> -> all of them, in registration order
                    case "all":
                        return new CaseResult("ok", "IEnumerable<IMessageSender> gives every registered implementation.",
                            Data(provider.GetServices<IMessageSender>().Select(m => m.Name).ToArray(), "IEnumerable<IMessageSender>"));

                    // keyed -> pick by name (throws if that key was never registered)
                    default:
                    {
                        var k = key ?? "sms";
                        var sender = provider.GetRequiredKeyedService<IMessageSender>(k);
                        return new CaseResult("ok", $"The sender registered under the key \"{k}\".",
                            Data([sender.Name], $"GetRequiredKeyedService<IMessageSender>(\"{k}\")"));
                    }
                }
            }
            catch (Exception ex) { return MiniContainer.Fail(ex); }
        });

        return app;
    }
}
