using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;
using Microsoft.Extensions.Hosting;

namespace DiDemo.Web.Demos.CaseStudies;

// =====================================================================
// 3d. Race condition in a singleton
// =====================================================================

// #region snippet:race-broken
// A singleton is shared by every request and every thread. Plain `++` and `+=` are not atomic:
// read -> add -> write can interleave, and updates are silently lost.
public class UnsafeOrderMetrics : Traceable, IOrderMetrics
{
    private int _count;
    private decimal _revenue;

    public void OrderPlaced(decimal total)
    {
        _count++;            // not atomic
        _revenue += total;   // not atomic (decimal is even torn across several words)
    }

    public MetricsSnapshot Snapshot() => new(_count, _revenue);
}
// #endregion

// #region snippet:race-lock
// The other classic fix: serialise the update with a lock.
public class LockedOrderMetrics : Traceable, IOrderMetrics
{
    private readonly object _gate = new();
    private int _count;
    private decimal _revenue;

    public void OrderPlaced(decimal total)
    {
        lock (_gate) { _count++; _revenue += total; }
    }

    public MetricsSnapshot Snapshot() { lock (_gate) return new(_count, _revenue); }
}
// #endregion

// =====================================================================
// 3e. Scoped service in a BackgroundService
// =====================================================================

public interface IReceiptStore { Guid Id { get; } int Count { get; set; } }

public class ReceiptStore : IReceiptStore
{
    public Guid Id { get; } = Guid.NewGuid();
    public int Count { get; set; }
}

// #region snippet:worker-broken
// BackgroundService is a Singleton (it lives as long as the app) but IReceiptStore is Scoped.
// With validation ON the app refuses to start; with validation OFF the "scoped" store silently
// becomes a singleton - for a real DbContext that means a stale, ever-growing, non-thread-safe context.
public class BrokenWorker(IReceiptStore store) : BackgroundService
{
    public string Tick()
    {
        store.Count++;
        return $"store {MiniContainer.Short(store.Id)} count={store.Count}";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Tick();
            await Task.Delay(2000, stoppingToken);
        }
    }
}
// #endregion

// #region snippet:worker-fixed
// FIX: inject IServiceScopeFactory (a singleton) and open a scope per unit of work.
public class FixedWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    public string Tick()
    {
        using var scope = scopeFactory.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IReceiptStore>();
        store.Count++;
        return $"store {MiniContainer.Short(store.Id)} count={store.Count}";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Tick();
            await Task.Delay(2000, stoppingToken);
        }
    }
}
// #endregion

// =====================================================================
// 3g. Multiple implementations of one interface
// =====================================================================

public interface IMessageSender { string Name { get; } string Send(string to); }
public class EmailSender : IMessageSender { public string Name => "email"; public string Send(string to) => $"📧 email to {to}"; }
public class SmsSender : IMessageSender { public string Name => "sms"; public string Send(string to) => $"📱 sms to {to}"; }
public class PushSender : IMessageSender { public string Name => "push"; public string Send(string to) => $"🔔 push to {to}"; }

// #region snippet:multi-keyed-consumer
// [FromKeyedServices] asks for one specific implementation right in the constructor.
public class SmsOnlyReminder([FromKeyedServices("sms")] IMessageSender sender)
{
    public string Used => sender.Name;
    public string Remind(string to) => sender.Send(to);
}
// #endregion
