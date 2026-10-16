using Officely.Api.Data;
using Officely.Api.Notifications;
using Microsoft.EntityFrameworkCore;

namespace Officely.Api.Orders;

public static class Fulfilment
{
    /// <summary>A paid order can be cancelled for this long; after that the warehouse ships it.</summary>
    public static readonly TimeSpan CancellationWindow = TimeSpan.FromSeconds(15);

    // #region snippet:fulfilment-run
    public static async Task<int> ShipDueOrdersAsync(ShopDbContext db, IEmailSender email, DateTime now, CancellationToken ct)
    {
        var shipped = 0;
        var unshipped = await db.Orders.Where(o => o.ShippedAt == null).ToListAsync(ct);
        foreach (var order in unshipped)
        {
            if (order.Status != OrderStatus.Paid) continue;                 // awaiting payment, or cancelled
            if (now - order.PlacedAt < CancellationWindow) continue;        // the customer can still cancel

            order.Status = OrderStatus.Shipped;
            order.ShippedAt = now;
            await db.SaveChangesAsync(ct);
            await email.SendAsync(order.CustomerEmail, $"Order #{order.Id} has shipped", "Your parcel is on its way.", ct);
            shipped++;
        }
        return shipped;
    }
    // #endregion
}

// #region snippet:fulfilment-worker
// A hosted service lives as long as the app: it is a Singleton.
public abstract class FulfilmentLoop(TimeProvider clock, ILogger logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    protected DateTime Now => clock.GetUtcNow().UtcDateTime;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var shipped = await ShipDueOrdersAsync(stoppingToken);
                if (shipped > 0) logger.LogInformation("Shipped {Count} order(s).", shipped);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Fulfilment run failed; retrying on the next tick.");
            }
            await Task.Delay(Interval, clock, stoppingToken);
        }
    }

    public abstract Task<int> ShipDueOrdersAsync(CancellationToken cancellationToken);
}

// It must NOT keep a ShopDbContext (Scoped) in a field. Every run opens its own scope,
// so every run reads current data, and disposing the scope disposes the DbContext.
public sealed class FulfilmentWorker(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<FulfilmentWorker> logger) : FulfilmentLoop(clock, logger)
{
    public override async Task<int> ShipDueOrdersAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        return await Fulfilment.ShipDueOrdersAsync(
            scope.ServiceProvider.GetRequiredService<ShopDbContext>(),
            scope.ServiceProvider.GetRequiredService<IEmailSender>(),
            Now,
            cancellationToken);
    }
}
// #endregion
