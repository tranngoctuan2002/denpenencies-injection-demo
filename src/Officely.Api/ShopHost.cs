using System.Text.Json.Serialization;
using Officely.Api.CaseStudies;
using Officely.Api.Data;
using Officely.Api.Orders;
using Officely.Api.Payments;

namespace Officely.Api;

public static class ShopHost
{
    public static async Task<WebApplication> BuildAsync(string[] args, CaseStudySettings settings)
    {
        var builder = WebApplication.CreateBuilder(args);

        // #region snippet:validation
        // ON: the container checks the whole service graph at startup and refuses to start if a Singleton
        // captures a Scoped service or a service cannot be built. ASP.NET Core turns this on only in Development.
        builder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateScopes = settings.Validation;
            options.ValidateOnBuild = settings.Validation;
        });
        // #endregion

        builder.Services.AddShop(builder.Configuration.GetConnectionString("Shop") ?? "Data Source=officely.db");
        builder.Services.UseBrokenCaseStudy(settings.Broken);   // dev-only switch from the case-study panel
        AddCommon(builder, settings);

        var app = builder.Build();   // a broken service graph throws HERE when validation is on

        await using (var scope = app.Services.CreateAsyncScope())
            await ShopDatabase.EnsureCreatedAsync(scope.ServiceProvider.GetRequiredService<ShopDbContext>());

        UseCommon(app);
        app.MapShop();
        app.MapDevTools(shopRunning: true);
        return app;
    }

    /// <summary>What a real deployment shows when startup fails: no shop, just the error (and the dev panel to fix it).</summary>
    public static WebApplication BuildStartupFailure(string[] args, CaseStudySettings settings, Exception error)
    {
        settings.StartupError = CapturedError.From(error);
        var builder = WebApplication.CreateBuilder(args);
        AddCommon(builder, settings);

        var app = builder.Build();
        app.Logger.LogCritical(error, "Officely failed to start.");
        UseCommon(app);
        app.MapDevTools(shopRunning: false);
        app.MapFallback("/api/{**path}", () => Results.Problem(statusCode: 503,
            title: "Officely failed to start", detail: settings.StartupError.Message));
        return app;
    }

    private static void AddCommon(WebApplicationBuilder builder, CaseStudySettings settings)
    {
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton<SnippetReader>();
        builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
    }

    private static void UseCommon(WebApplication app)
    {
        // Every API error becomes ProblemDetails: 400 for bad input, 500 (logged) for bugs.
        app.Use(async (context, next) =>
        {
            try
            {
                await next(context);
            }
            catch (Exception ex) when (!context.Response.HasStarted && !context.RequestAborted.IsCancellationRequested)
            {
                var badInput = ex is CheckoutException or UnsupportedPaymentProviderException;
                if (!badInput) app.Logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
                await Results.Problem(
                    statusCode: badInput ? 400 : 500,
                    title: badInput ? ex.Message : "Internal Server Error",
                    detail: badInput ? null : ex.Message,
                    extensions: new Dictionary<string, object?> { ["exception"] = ex.GetType().Name }).ExecuteAsync(context);
            }
        });
        app.UseDefaultFiles();
        app.UseStaticFiles();
    }
}
