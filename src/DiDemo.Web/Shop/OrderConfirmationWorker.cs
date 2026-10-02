using DiDemo.Web.Data;
using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Shop;

// #region snippet:worker-fixed-real
/// <summary>
/// A hosted service lives as long as the app (Singleton), but ShopDbContext is Scoped.
/// So it injects IServiceScopeFactory and opens a fresh scope for every unit of work.
/// </summary>
public class OrderConfirmationWorker(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    INotificationLog log,
    ILogger<OrderConfirmationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ShopDbContext>();

                var pending = await db.Orders.Where(o => o.ConfirmationSentAt == null).ToListAsync(stoppingToken);
                foreach (var order in pending)
                {
                    order.ConfirmationSentAt = clock.UtcNow;
                    log.Add("worker", order.Customer, $"Receipt generated for order #{order.Id} (scope {scope.GetHashCode():x})");
                }
                if (pending.Count > 0) await db.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("Worker tick failed: {Message}", ex.Message);
            }
            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
    }
}
// #endregion
