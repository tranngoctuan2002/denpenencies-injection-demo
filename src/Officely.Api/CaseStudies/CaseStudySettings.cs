using Officely.Api.Cart;
using Officely.Api.CaseStudies.Broken;
using Officely.Api.Data;
using Officely.Api.Orders;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Officely.Api.CaseStudies;

public enum CaseStudy { None, Payments, Notifications, Lifetimes, Cart, UnitOfWork, ThreadSafety, BackgroundJob }

public sealed record CapturedError(string Type, string Message, string FullText)
{
    public static CapturedError From(Exception ex)
    {
        var root = (ex as AggregateException)?.InnerExceptions.FirstOrDefault() ?? ex;
        return new CapturedError(root.GetType().Name, root.Message, $"{ex.GetType().FullName}: {ex.Message}");
    }
}

/// <summary>
/// Dev-only state that survives an in-process restart: which case study is broken, whether the container
/// validates the service graph, and why the last start failed.
/// </summary>
public sealed class CaseStudySettings
{
    public CaseStudy Broken { get; set; }
    public bool Validation { get; set; } = true;
    public int Generation { get; private set; }
    public DateTime StartedAt { get; private set; }
    public CapturedError? StartupError { get; set; }
    public bool RestartRequested { get; private set; }

    public void BeginStart()
    {
        Generation++;
        StartedAt = DateTime.UtcNow;
        StartupError = null;
        RestartRequested = false;
    }

    public void RequestRestart(IHostApplicationLifetime lifetime)
    {
        RestartRequested = true;
        _ = Task.Run(async () =>
        {
            await Task.Delay(250);   // let the HTTP response reach the browser first
            lifetime.StopApplication();
        });
    }
}

public static class CaseStudyRegistration
{
    /// <summary>Dev-only: replaces ONE correct registration from <see cref="ShopRegistration.AddShop"/> with its broken version.</summary>
    public static IServiceCollection UseBrokenCaseStudy(this IServiceCollection services, CaseStudy broken)
    {
        switch (broken)
        {
            case CaseStudy.Payments:
                // #region snippet:payments-broken-registration
                services.Replace(ServiceDescriptor.Scoped<IOrderService, TightlyCoupledOrderService>());
                // #endregion
                break;

            case CaseStudy.Notifications:
                // #region snippet:notifications-broken-registration
                services.Replace(ServiceDescriptor.Scoped<IOrderService, NotifyingOrderService>());
                services.AddScoped<NotificationService>();
                // #endregion
                break;

            case CaseStudy.Lifetimes:
                // #region snippet:lifetimes-broken-registration
                // "OrderService is expensive to create, let's make it a Singleton."
                services.Replace(ServiceDescriptor.Singleton<IOrderService, OrderService>());   // captures the Scoped ShopDbContext
                // #endregion
                break;

            case CaseStudy.Cart:
                // #region snippet:cart-broken-registration
                services.Replace(ServiceDescriptor.Singleton<ICartService, UnsafeCartService>());   // one shared, mutable object
                // #endregion
                break;

            case CaseStudy.UnitOfWork:
                // #region snippet:unit-of-work-broken-registration
                // "A fresh DbContext every time is safest." Same as AddDbContext(..., ServiceLifetime.Transient).
                services.Replace(ServiceDescriptor.Transient<ShopDbContext, ShopDbContext>());   // every service gets its own
                // #endregion
                break;

            case CaseStudy.ThreadSafety:
                // #region snippet:thread-safety-broken-registration
                services.Replace(ServiceDescriptor.Scoped<ICartSummary, ParallelCartSummary>());
                // #endregion
                break;

            case CaseStudy.BackgroundJob:
                services.Remove(services.Single(d => d.ImplementationType == typeof(FulfilmentWorker)));
                // #region snippet:background-job-broken-registration
                services.AddHostedService<CaptiveFulfilmentWorker>();   // ShopDbContext straight into a Singleton
                // #endregion
                break;
        }
        return services;
    }
}
