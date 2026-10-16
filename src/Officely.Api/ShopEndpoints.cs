using Officely.Api.Cart;
using Officely.Api.Data;
using Officely.Api.Notifications;
using Officely.Api.Orders;
using Microsoft.EntityFrameworkCore;

namespace Officely.Api;

public sealed record AddToCartRequest(int ProductId, int Quantity);
public sealed record SetQuantityRequest(int Quantity);

public static class ShopEndpoints
{
    public static IEndpointRouteBuilder MapShop(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/products", (ShopDbContext db, CancellationToken ct) =>
            db.Products.AsNoTracking().OrderBy(p => p.Id).ToListAsync(ct));

        // ---- Team cart ----
        api.MapGet("/cart", (ICartSummary summary, CancellationToken ct) => summary.GetAsync(ct));

        api.MapPost("/cart/items", async (AddToCartRequest request, ICartService cart, ShopDbContext db, CancellationToken ct) =>
        {
            if (request.Quantity is < 1 or > 99) return Results.Problem(statusCode: 400, title: "Quantity must be between 1 and 99.");
            if (!await db.Products.AnyAsync(p => p.Id == request.ProductId, ct))
                return Results.Problem(statusCode: 404, title: $"Product {request.ProductId} does not exist.");
            await cart.AddAsync(request.ProductId, request.Quantity, ct);
            return Results.NoContent();
        });

        api.MapPut("/cart/items/{productId:int}", (int productId, SetQuantityRequest request, ICartService cart) =>
        {
            if (request.Quantity is < 0 or > 999) return Results.Problem(statusCode: 400, title: "Quantity must be between 0 and 999.");
            cart.SetQuantity(productId, request.Quantity);
            return Results.NoContent();
        });

        api.MapDelete("/cart", (ICartService cart) =>
        {
            cart.Clear();
            return Results.NoContent();
        });

        // ---- Checkout & orders ----
        api.MapPost("/checkout", async (CheckoutRequest request, IOrderService orders, CancellationToken ct) =>
        {
            var order = await orders.PlaceOrderAsync(request, ct);
            return Results.Created($"/api/orders/{order.Id}", order);
        });

        api.MapGet("/orders", (IOrderService orders, CancellationToken ct) => orders.GetRecentOrdersAsync(ct));

        // Customers may cancel a paid order until it ships; the stock goes back on the shelf.
        api.MapPost("/orders/{id:int}/cancel", async (int id, ShopDbContext db, IEmailSender email, CancellationToken ct) =>
        {
            var order = await db.Orders.Include(o => o.Lines).SingleOrDefaultAsync(o => o.Id == id, ct);
            if (order is null) return Results.Problem(statusCode: 404, title: $"Order #{id} does not exist.");
            if (order.Status != OrderStatus.Paid)
                return Results.Problem(statusCode: 409, title: $"Order #{id} is {order.Status} and can no longer be cancelled.");

            order.Status = OrderStatus.Cancelled;
            foreach (var line in order.Lines)
                if (await db.Products.FindAsync([line.ProductId], ct) is { } product) product.Stock += line.Quantity;
            await db.SaveChangesAsync(ct);
            await email.SendAsync(order.CustomerEmail, $"Order #{id} cancelled", "Your order was cancelled and your payment will be refunded.", ct);
            return Results.NoContent();
        });

        // ---- Development mail server ----
        api.MapGet("/inbox", (ShopDbContext db, CancellationToken ct) =>
            db.Emails.AsNoTracking().OrderByDescending(e => e.Id).Take(50).ToListAsync(ct));

        return app;
    }
}
