using DiDemo.Web.Data;
using DiDemo.Web.Demos.Basics;
using DiDemo.Web.Demos.CaseStudies;
using DiDemo.Web.Demos.Lifetimes;
using DiDemo.Web.Infrastructure;
using DiDemo.Web.Shop;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Shop")!;

// #region snippet:registrations
// ---- Database: factory is the source of truth; the scoped DbContext is created from it ----
builder.Services.AddDbContextFactory<ShopDbContext>(o => o.UseSqlServer(connectionString));
builder.Services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<ShopDbContext>>().CreateDbContext());

// ---- Singleton: one instance for the whole app ----
builder.Services.AddSingleton<DemoSettings>();
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<IOrderMetrics, OrderMetrics>();
builder.Services.AddSingleton<INotificationLog, NotificationLog>();

// ---- Scoped: one instance per HTTP request (per scope) ----
builder.Services.AddScoped<IRequestContext, RequestContext>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IInventoryService, InventoryService>();
builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddScoped<IAuditLog, AuditLog>();

// Swap the payment provider with one line - OrderService never changes:
//   builder.Services.AddScoped<IPaymentGateway, PayPalGateway>();
// Here the UI switch picks one at runtime, to make the swap visible:
builder.Services.AddScoped<IPaymentGateway>(sp =>
    sp.GetRequiredService<DemoSettings>().PaymentProvider switch
    {
        "paypal" => ActivatorUtilities.CreateInstance<PayPalGateway>(sp),
        "offline" => ActivatorUtilities.CreateInstance<OfflineGateway>(sp),
        _ => ActivatorUtilities.CreateInstance<StripeGateway>(sp)
    });

// ---- Transient: a new instance every time it is requested ----
builder.Services.AddTransient<IPricingService, PricingService>();
builder.Services.AddTransient<IDiscountRule, BulkDiscountRule>();      // several implementations of the same
builder.Services.AddTransient<IDiscountRule, LoyaltyDiscountRule>();   // interface -> IEnumerable<IDiscountRule>

// ---- Keyed services: pick one implementation by name ----
builder.Services.AddKeyedTransient<INotifier, EmailNotifier>("email");
builder.Services.AddKeyedTransient<INotifier, SmsNotifier>("sms");
builder.Services.AddKeyedTransient<INotifier, PushNotifier>("push");
builder.Services.AddScoped<INotifier>(sp =>
{
    var channel = sp.GetRequiredService<DemoSettings>().NotifyChannel;
    return channel == "all"
        ? new CompositeNotifier(new[] { "email", "sms", "push" }.Select(k => sp.GetRequiredKeyedService<INotifier>(k)).ToList())
        : sp.GetRequiredKeyedService<INotifier>(channel);
});

// ---- Background work ----
builder.Services.AddHostedService<OrderConfirmationWorker>();
// #endregion

// ---- Demo plumbing (technique + lifetime demos) ----
builder.Services.AddScoped<ICheckout, Checkout>();
builder.Services.AddTransient<IPriceCalculator, PriceCalculator>();   // Transient
builder.Services.AddScoped<IRequestLog, RequestLog>();                // Scoped
builder.Services.AddSingleton<IShopCounter, ShopCounter>();           // Singleton
builder.Services.AddTransient<CartService>();
builder.Services.AddTransient<PaymentService>();
builder.Services.AddTransient<ReceiptService>();
builder.Services.AddTransient<CheckoutFlow>();
builder.Services.AddSingleton<SnippetReader>();
builder.Services.AddSingleton<LabSessions>();
builder.Services.AddSingleton(new LifetimeCatalog(builder.Services));

var app = builder.Build();

await DbInitializer.InitializeAsync(app.Services, app.Logger);

// The "current user" comes from a header, written into the Scoped RequestContext once per request.
app.UseWhen(c => c.Request.Path.StartsWithSegments("/api"), branch => branch.Use(async (http, next) =>
{
    var ctx = http.RequestServices.GetRequiredService<IRequestContext>();
    if (http.Request.Headers.TryGetValue("X-Demo-User", out var user) && !string.IsNullOrWhiteSpace(user))
        ctx.User = user.ToString();
    await next();
}));

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapShop();
app.MapBasicsDemo();
app.MapLifetimesDemo();
app.MapCaseStudies();

app.Run();

public partial class Program;
