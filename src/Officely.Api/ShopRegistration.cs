using Officely.Api.Cart;
using Officely.Api.Data;
using Officely.Api.Notifications;
using Officely.Api.Orders;
using Officely.Api.Payments;
using Microsoft.EntityFrameworkCore;

namespace Officely.Api;

public static class ShopRegistration
{
    public static IServiceCollection AddShop(this IServiceCollection services, string connectionString)
    {
        services.AddSingleton(TimeProvider.System);

        // #region snippet:registration-db
        // Scoped (the default): one ShopDbContext per request, shared by every service in that request.
        services.AddDbContext<ShopDbContext>(o => o
            .UseSqlite(connectionString)
            .AddInterceptors(new SimulatedLatencyInterceptor(TimeSpan.FromMilliseconds(15))));
        services.AddScoped<IStockService, StockService>();
        // #endregion

        // #region snippet:registration-payments
        // A new provider = one new class + one line here. OrderService does not change.
        services.AddSingleton<IPaymentProcessor, StripePaymentProcessor>();
        services.AddSingleton<IPaymentProcessor, PayPalPaymentProcessor>();
        services.AddSingleton<IPaymentProcessor, MoMoPaymentProcessor>();
        services.AddSingleton<IPaymentProcessorResolver, PaymentProcessorResolver>();
        // #endregion

        // #region snippet:registration-orders
        services.AddScoped<IOrderService, OrderService>();     // same lifetime as the ShopDbContext it uses
        // #endregion

        // #region snippet:registration-notifications
        services.AddScoped<OrderEventDispatcher>();
        services.AddScoped<IOrderCompletedHandler, OrderConfirmationEmailHandler>();
        services.AddScoped<IEmailSender, DatabaseEmailSender>();
        // #endregion

        // #region snippet:registration-fulfilment
        services.AddHostedService<FulfilmentWorker>();         // a Singleton that opens its own scopes
        // #endregion

        // #region snippet:registration-cart
        services.AddSingleton<IInventoryClient, FakeInventoryClient>();
        services.AddSingleton<ICartService, CartService>();    // one shared cart => must be thread-safe
        // #endregion

        // #region snippet:registration-cart-summary
        services.AddScoped<ICartSummary, CartSummary>();      // uses the request's ShopDbContext
        // #endregion

        return services;
    }
}
