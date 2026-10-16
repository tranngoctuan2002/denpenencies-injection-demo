using Officely.Api.Cart;
using Officely.Api.CaseStudies.Broken;
using Officely.Api.Data;
using Officely.Api.Orders;
using Officely.Api.Payments;

namespace Officely.Api.CaseStudies;

public sealed record CaseStudyChange(CaseStudy Broken, bool Validation);
public sealed record SimulateBuyersRequest(int Buyers, int ProductId);
public sealed record CodePair(string Broken, string Fixed);
public sealed record GraphPair(GraphDto Broken, GraphDto Fixed);
public sealed record CaseStudyDetails(CaseStudy Id, CodePair Code, GraphPair Graphs);

/// <summary>The dev panel's API. Development tooling for the case studies, not part of the shop itself.</summary>
public static class DevToolsEndpoints
{
    private static readonly HttpClient Http = new();

    public static IEndpointRouteBuilder MapDevTools(this IEndpointRouteBuilder app, bool shopRunning)
    {
        var dev = app.MapGroup("/api/dev");

        dev.MapGet("/status", (CaseStudySettings s) => new
        {
            s.Generation,
            Running = s.StartupError is null,
            s.Broken,
            s.Validation,
            s.StartedAt,
            s.StartupError
        });

        // Swap a registration and restart the shop in-process, exactly like redeploying with that code.
        dev.MapPut("/case-studies", (CaseStudyChange change, CaseStudySettings s, IHostApplicationLifetime lifetime) =>
        {
            if (!Enum.IsDefined(change.Broken)) return Results.Problem(statusCode: 400, title: "Unknown case study.");
            s.Broken = change.Broken;
            s.Validation = change.Validation;
            s.RequestRestart(lifetime);
            return Results.Accepted(value: new { restartingFrom = s.Generation });
        });

        dev.MapGet("/case-studies/{id}", (string id, SnippetReader snippets) =>
            Enum.TryParse<CaseStudy>(id, ignoreCase: true, out var cs) && cs != CaseStudy.None
                ? Results.Ok(Describe(cs, snippets))
                : Results.Problem(statusCode: 404, title: $"Unknown case study '{id}'."));

        if (!shopRunning) return app;

        // A tiny load test: N real HTTP requests to the shop's own cart endpoint, released at the same instant.
        dev.MapPost("/simulate-buyers", async (SimulateBuyersRequest request, HttpContext http, ICartService cart, CancellationToken ct) =>
        {
            var buyers = Math.Clamp(request.Buyers, 2, 500);
            int Quantity() => cart.Items().FirstOrDefault(i => i.ProductId == request.ProductId)?.Quantity ?? 0;
            var before = Quantity();
            var url = $"{http.Request.Scheme}://{http.Request.Host}/api/cart/items";

            var startGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var calls = Enumerable.Range(0, buyers).Select(async _ =>
            {
                await startGate.Task;
                using var response = await Http.PostAsJsonAsync(url, new AddToCartRequest(request.ProductId, 1), ct);
                return response.IsSuccessStatusCode;
            }).ToArray();
            startGate.SetResult();
            var succeeded = (await Task.WhenAll(calls)).Count(ok => ok);

            var after = Quantity();
            return new { buyers, succeeded, before, expected = before + succeeded, actual = after, lost = before + succeeded - after };
        });

        dev.MapPost("/reset-data", async (ShopDbContext db, ICartService cart, CancellationToken ct) =>
        {
            await ShopDatabase.ResetAsync(db, ct);
            cart.Clear();
            return Results.NoContent();
        });

        return app;
    }

    private static readonly Dictionary<CaseStudy, (string[] Broken, string[] Fixed)> Code = new()
    {
        [CaseStudy.Payments] = (["payments-broken", "payments-broken-registration"],
                                ["payment-processor", "payment-resolver", "order-service", "registration-payments"]),
        [CaseStudy.Notifications] = (["notifications-broken", "notifications-broken-registration"],
                                     ["order-events", "order-service", "registration-notifications"]),
        [CaseStudy.Lifetimes] = (["lifetimes-broken-registration", "order-service"],
                                 ["registration-orders", "order-service", "fulfilment-worker", "registration-fulfilment"]),
        [CaseStudy.Cart] = (["cart-broken-registration", "cart-broken"], ["registration-cart", "cart-fixed"]),
        [CaseStudy.UnitOfWork] = (["unit-of-work-broken-registration", "order-unit-of-work", "stock-service"],
                                  ["registration-db", "order-unit-of-work", "stock-service"]),
        [CaseStudy.ThreadSafety] = (["thread-safety-broken-registration", "thread-safety-broken"],
                                    ["registration-cart-summary", "cart-summary"]),
        [CaseStudy.BackgroundJob] = (["background-job-broken-registration", "background-job-broken", "fulfilment-run"],
                                     ["registration-fulfilment", "fulfilment-worker", "fulfilment-run"]),
    };

    public static CaseStudyDetails Describe(CaseStudy id, SnippetReader snippets) =>
        new(id, new CodePair(snippets.Get(Code[id].Broken), snippets.Get(Code[id].Fixed)),
            new GraphPair(Graph(id, broken: true), Graph(id, broken: false)));

    /// <summary>The graph the container would build, read from the same registrations the shop uses.</summary>
    public static GraphDto Graph(CaseStudy id, bool broken)
    {
        var services = new ServiceCollection().AddShop("Data Source=:memory:").UseBrokenCaseStudy(broken ? id : CaseStudy.None);
        return id switch
        {
            CaseStudy.Cart => DependencyGraph.Build(services, [typeof(ICartService)]),
            CaseStudy.ThreadSafety => DependencyGraph.Build(services, [typeof(ICartSummary)]),
            CaseStudy.BackgroundJob when broken => DependencyGraph.Build(services, [typeof(CaptiveFulfilmentWorker)]),
            CaseStudy.BackgroundJob => DependencyGraph.Build(services, [typeof(FulfilmentWorker)],
                (typeof(FulfilmentWorker), typeof(ShopDbContext), "creates-scope")),
            CaseStudy.Lifetimes => DependencyGraph.Build(services, [typeof(IOrderService), typeof(FulfilmentWorker)],
                (typeof(FulfilmentWorker), typeof(ShopDbContext), "creates-scope")),
            CaseStudy.Payments when broken => DependencyGraph.Build(services, [typeof(IOrderService)],
                (typeof(TightlyCoupledOrderService), typeof(StripePaymentProcessor), "new"),
                (typeof(TightlyCoupledOrderService), typeof(PayPalPaymentProcessor), "new")),
            _ => DependencyGraph.Build(services, [typeof(IOrderService)])
        };
    }
}
