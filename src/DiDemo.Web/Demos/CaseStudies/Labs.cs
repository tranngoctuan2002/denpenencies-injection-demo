using System.Collections.Concurrent;
using DiDemo.Web.Infrastructure;
using Microsoft.Extensions.Hosting;

namespace DiDemo.Web.Demos.CaseStudies;

/// <summary>A running "mini app" a viewer started from the UI (kept between clicks so state can build up).</summary>
public record LabApp(ServiceProvider Provider, object? State = null, string Mode = "");

/// <summary>
/// Case studies B and E need a long-lived app: the bug only shows after several requests/ticks.
/// Each browser page gets its own lab id; starting a lab replaces (and disposes) its previous app.
/// </summary>
public sealed class LabSessions : IDisposable
{
    private readonly ConcurrentDictionary<string, LabApp> _labs = new();
    private readonly ConcurrentQueue<string> _order = new();

    public void Set(string id, LabApp app)
    {
        Remove(id);
        _labs[id] = app;
        _order.Enqueue(id);
        while (_labs.Count > 30 && _order.TryDequeue(out var oldest))
            if (oldest != id) Remove(oldest);
    }

    public LabApp? Get(string id) => _labs.TryGetValue(id, out var app) ? app : null;

    public void Remove(string id)
    {
        if (_labs.TryRemove(id, out var old)) old.Provider.Dispose();
    }

    public void Dispose()
    {
        foreach (var app in _labs.Values) app.Provider.Dispose();
    }
}

public static class Labs
{
    public static IEndpointRouteBuilder MapLabs(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/labs");

        // ---------- B. Captive dependency: start the app with the lifetime YOU chose ----------
        g.MapGet("/captive/start", (string lab, string lifetime, bool validate, LabSessions sessions) =>
        {
            sessions.Remove(lab);
            try
            {
                // #region snippet:captive-lab
                var provider = MiniContainer.Build(s =>
                {
                    s.AddScoped<IUserContext, UserContext>();      // one per request
                    switch (lifetime)                              // <-- the line the viewer edits
                    {
                        case "singleton": s.AddSingleton<CartCache>(); break;
                        case "transient": s.AddTransient<CartCache>(); break;
                        default: s.AddScoped<CartCache>(); break;
                    }
                }, validate);   // validate = ValidateScopes + ValidateOnBuild
                // #endregion
                sessions.Set(lab, new LabApp(provider, null, lifetime));
                return new CaseResult("ok", "The app started.");
            }
            catch (Exception ex) { return MiniContainer.Fail(ex); }
        });

        // ... then users log in, one request each, against the SAME running app
        g.MapGet("/captive/login", (string lab, string user, LabSessions sessions) =>
        {
            var running = sessions.Get(lab);
            if (running is null) return new CaseResult("error", "The app is not running. Start the app first.");
            try
            {
                using var scope = running.Provider.CreateScope();                 // one scope = one request
                var ctx = scope.ServiceProvider.GetRequiredService<IUserContext>();
                ctx.User = user;
                var cache = scope.ServiceProvider.GetRequiredService<CartCache>();
                var row = new
                {
                    scope = user,
                    scopedContext = MiniContainer.Short(ctx.Id),
                    cacheSees = cache.Owner,
                    cacheContext = MiniContainer.Short(cache.ContextId),
                    correct = cache.ContextId == ctx.Id
                };
                return new CaseResult(row.correct ? "ok" : "bug", $"{user} logged in.", row);
            }
            catch (Exception ex) { return MiniContainer.Fail(ex); }
        });

        // ---------- E. Scoped service in a background job: start the app, then let the job tick ----------
        g.MapGet("/worker/start", (string lab, string mode, bool validate, LabSessions sessions) =>
        {
            sessions.Remove(lab);
            try
            {
                var provider = MiniContainer.Build(s =>
                {
                    s.AddScoped<IReceiptStore, ReceiptStore>();
                    if (mode == "factory") s.AddHostedService<FixedWorker>();   // IServiceScopeFactory
                    else s.AddHostedService<BrokenWorker>();                    // IReceiptStore in the constructor
                }, validate);
                var worker = provider.GetServices<IHostedService>().Single();
                sessions.Set(lab, new LabApp(provider, worker, mode));
                return new CaseResult("ok", "The app started and the background job is running.");
            }
            catch (Exception ex) { return MiniContainer.Fail(ex); }
        });

        g.MapGet("/worker/tick", (string lab, LabSessions sessions) =>
        {
            var running = sessions.Get(lab);
            if (running is null) return new CaseResult("error", "The app is not running. Start the app first.");
            var text = running.State switch
            {
                FixedWorker f => f.Tick(),
                BrokenWorker b => b.Tick(),
                _ => "?"
            };
            return new CaseResult("ok", text, text);
        });

        return app;
    }
}
