using System.Collections.Concurrent;
using DiDemo.Web.Data;
using DiDemo.Web.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Shop;

// ---------- Settings the presenter flips from the UI ----------
public class DemoSettings
{
    public string PaymentProvider { get; set; } = "stripe"; // stripe | paypal | offline
    public string NotifyChannel { get; set; } = "email";    // email | sms | push | all
}

// ---------- Clock (Singleton) ----------
public interface IClock { DateTime UtcNow { get; } }
public class SystemClock : Traceable, IClock { public DateTime UtcNow => DateTime.UtcNow; }

// ---------- Pricing (Transient) with multiple IDiscountRule implementations ----------
public record Pricing(decimal Subtotal, decimal Discount, decimal Tax, decimal Total, IReadOnlyList<string> AppliedRules);

public interface IDiscountRule
{
    string Name { get; }
    decimal Calculate(IReadOnlyList<OrderLine> lines, string user);
}

public class BulkDiscountRule : Traceable, IDiscountRule
{
    public string Name => "Bulk 10% (5+ of one item)";
    public decimal Calculate(IReadOnlyList<OrderLine> lines, string user) =>
        Math.Round(lines.Where(l => l.Quantity >= 5).Sum(l => l.Quantity * l.UnitPrice) * 0.10m, 2);
}

public class LoyaltyDiscountRule : Traceable, IDiscountRule
{
    public string Name => "VIP 5%";
    public decimal Calculate(IReadOnlyList<OrderLine> lines, string user) =>
        user == "vip" ? Math.Round(lines.Sum(l => l.Quantity * l.UnitPrice) * 0.05m, 2) : 0;
}

public interface IPricingService { Pricing Price(IReadOnlyList<OrderLine> lines, string user); }

// #region snippet:pricing
// DI gives us *every* registered IDiscountRule - add a rule, register it, nothing else changes.
public class PricingService(IEnumerable<IDiscountRule> rules, IRequestContext ctx) : Traceable, IPricingService
{
    private const decimal TaxRate = 0.08m;

    public Pricing Price(IReadOnlyList<OrderLine> lines, string user)
    {
        ctx.Touch(this);
        var subtotal = lines.Sum(l => l.Quantity * l.UnitPrice);
        decimal discount = 0;
        var applied = new List<string>();
        foreach (var rule in rules)
        {
            ctx.Touch(rule);
            var d = rule.Calculate(lines, user);
            if (d <= 0) continue;
            discount += d;
            applied.Add($"{rule.Name}: -{d:0.00}");
        }
        var taxable = subtotal - discount;
        var tax = Math.Round(taxable * TaxRate, 2);
        return new Pricing(subtotal, discount, tax, taxable + tax, applied);
    }
}
// #endregion

// ---------- Payment (Scoped, implementation chosen at runtime) ----------
public record PaymentResult(bool Approved, string? Reference, string? Error, decimal Fee = 0, string Provider = "");

public interface IPaymentGateway
{
    Task<PaymentResult> ChargeAsync(decimal amount, string customer, CancellationToken ct = default);
}

// #region snippet:gateways
// Three interchangeable implementations of the same interface. OrderService only knows IPaymentGateway.
public class StripeGateway(IRequestContext ctx) : Traceable, IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(decimal amount, string customer, CancellationToken ct = default)
    {
        ctx.Touch(this);
        await Task.Delay(150, ct); // pretend to call the network
        var fee = Math.Round(amount * 0.029m + 0.30m, 2); // Stripe: 2.9% + 0.30
        return new PaymentResult(true, $"ch_{ctx.CorrelationId.ToString()[..8]}", null, fee, "Stripe");
    }
}

public class PayPalGateway(IRequestContext ctx) : Traceable, IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(decimal amount, string customer, CancellationToken ct = default)
    {
        ctx.Touch(this);
        await Task.Delay(150, ct);
        var fee = Math.Round(amount * 0.0349m + 0.49m, 2); // PayPal: 3.49% + 0.49
        return new PaymentResult(true, $"PAYID-{ctx.CorrelationId.ToString()[..8].ToUpperInvariant()}", null, fee, "PayPal");
    }
}

public class OfflineGateway(IRequestContext ctx) : Traceable, IPaymentGateway
{
    public async Task<PaymentResult> ChargeAsync(decimal amount, string customer, CancellationToken ct = default)
    {
        ctx.Touch(this);
        await Task.Delay(150, ct);
        return new PaymentResult(false, null, "provider_unavailable", 0, "Offline");
    }
}
// #endregion

// ---------- Inventory (Scoped, uses the scoped DbContext) ----------
public record CartItem(int ProductId, int Quantity);
public record Reservation(bool Success, string? Error, IReadOnlyList<OrderLine> Lines);

public interface IInventoryService
{
    Task<Reservation> ReserveAsync(IReadOnlyList<CartItem> items, CancellationToken ct = default);
    Task CommitAsync(IReadOnlyList<OrderLine> lines, CancellationToken ct = default);
}

public class InventoryService(ShopDbContext db, IRequestContext ctx) : Traceable, IInventoryService
{
    public async Task<Reservation> ReserveAsync(IReadOnlyList<CartItem> items, CancellationToken ct = default)
    {
        ctx.Touch(this);
        ctx.Touch(db);
        if (items.Count == 0 || items.Any(i => i.Quantity <= 0))
            return new Reservation(false, "The cart is empty.", []);

        var ids = items.Select(i => i.ProductId).ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);

        var lines = new List<OrderLine>();
        foreach (var item in items)
        {
            if (!products.TryGetValue(item.ProductId, out var p))
                return new Reservation(false, $"Product {item.ProductId} does not exist.", []);
            if (p.Stock < item.Quantity)
                return new Reservation(false, $"Only {p.Stock} x {p.Name} left in stock.", []);
            lines.Add(new OrderLine { ProductId = p.Id, ProductName = p.Name, Quantity = item.Quantity, UnitPrice = p.Price });
        }
        return new Reservation(true, null, lines);
    }

    // Tracked only - the repository's SaveChanges commits stock + order in one unit of work.
    public async Task CommitAsync(IReadOnlyList<OrderLine> lines, CancellationToken ct = default)
    {
        foreach (var line in lines)
        {
            var product = await db.Products.FindAsync([line.ProductId], ct);
            product!.Stock -= line.Quantity;
        }
    }
}

// ---------- Order repository (Scoped) ----------
public interface IOrderRepository
{
    Task SaveAsync(Order order, CancellationToken ct = default);
    Task<List<Order>> RecentAsync(int count, CancellationToken ct = default);
}

public class OrderRepository(ShopDbContext db, IRequestContext ctx) : Traceable, IOrderRepository
{
    // The scoped DbContext is the unit of work: this one SaveChanges persists the order AND the stock changes.
    public async Task SaveAsync(Order order, CancellationToken ct = default)
    {
        ctx.Touch(this);
        db.Orders.Add(order);
        await db.SaveChangesAsync(ct);
    }

    public Task<List<Order>> RecentAsync(int count, CancellationToken ct = default) =>
        db.Orders.Include(o => o.Lines).AsNoTracking().OrderByDescending(o => o.Id).Take(count).ToListAsync(ct);
}

// ---------- Audit log (Scoped, but writes through a FACTORY so it survives a failed order) ----------
public interface IAuditLog
{
    Task WriteAsync(string message, CancellationToken ct = default);
    Task<List<AuditEntry>> RecentAsync(int count, CancellationToken ct = default);
}

public class AuditLog(IDbContextFactory<ShopDbContext> factory, IRequestContext ctx) : Traceable, IAuditLog
{
    public async Task WriteAsync(string message, CancellationToken ct = default)
    {
        ctx.Touch(this);
        await using var db = await factory.CreateDbContextAsync(ct); // its own short-lived context
        db.AuditEntries.Add(new AuditEntry { CorrelationId = ctx.CorrelationId, User = ctx.User, Message = message, At = DateTime.UtcNow });
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<AuditEntry>> RecentAsync(int count, CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.AuditEntries.AsNoTracking().OrderByDescending(a => a.Id).Take(count).ToListAsync(ct);
    }
}

// ---------- Notifications ----------
public record NotificationEntry(DateTime At, string Channel, string To, string Message);

public interface INotificationLog
{
    void Add(string channel, string to, string message);
    IReadOnlyList<NotificationEntry> Recent();
    void Clear();
}

/// <summary>Singleton, shared by every request and the background worker -> must be thread-safe.</summary>
public class NotificationLog : Traceable, INotificationLog
{
    private readonly ConcurrentQueue<NotificationEntry> _entries = new();

    public void Add(string channel, string to, string message)
    {
        _entries.Enqueue(new NotificationEntry(DateTime.UtcNow, channel, to, message));
        while (_entries.Count > 40) _entries.TryDequeue(out _);
    }

    public IReadOnlyList<NotificationEntry> Recent() => _entries.Reverse().ToList();

    public void Clear() => _entries.Clear();
}

public interface INotifier
{
    string Channel { get; }
    Task SendAsync(string to, string message);
}

public class EmailNotifier(INotificationLog log, IRequestContext ctx) : Traceable, INotifier
{
    public string Channel => "email";
    public Task SendAsync(string to, string message) { ctx.Touch(this); log.Add(Channel, to, message); return Task.CompletedTask; }
}

public class SmsNotifier(INotificationLog log, IRequestContext ctx) : Traceable, INotifier
{
    public string Channel => "sms";
    public Task SendAsync(string to, string message) { ctx.Touch(this); log.Add(Channel, to, message); return Task.CompletedTask; }
}

public class PushNotifier(INotificationLog log, IRequestContext ctx) : Traceable, INotifier
{
    public string Channel => "push";
    public Task SendAsync(string to, string message) { ctx.Touch(this); log.Add(Channel, to, message); return Task.CompletedTask; }
}

public class CompositeNotifier(IReadOnlyList<INotifier> inner) : INotifier
{
    public string Channel => "all";
    public async Task SendAsync(string to, string message)
    {
        foreach (var n in inner) await n.SendAsync(to, message);
    }
}

// ---------- Metrics (Singleton) ----------
public record MetricsSnapshot(int OrdersPlaced, decimal Revenue);

public interface IOrderMetrics
{
    void OrderPlaced(decimal total);
    MetricsSnapshot Snapshot();
}

// #region snippet:metrics-safe
/// <summary>Singleton => shared by ALL requests/threads. Interlocked keeps it correct.</summary>
public class OrderMetrics : Traceable, IOrderMetrics
{
    private int _count;
    private long _revenueCents;

    public void OrderPlaced(decimal total)
    {
        Interlocked.Increment(ref _count);
        Interlocked.Add(ref _revenueCents, (long)(total * 100));
    }

    public MetricsSnapshot Snapshot() =>
        new(Volatile.Read(ref _count), Interlocked.Read(ref _revenueCents) / 100m);
}
// #endregion
