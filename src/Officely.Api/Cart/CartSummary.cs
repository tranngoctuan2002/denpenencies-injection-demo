using Officely.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Officely.Api.Cart;

public sealed record CartLineView(int ProductId, string Name, string Emoji, decimal UnitPrice, int Quantity, decimal LineTotal);

public sealed record CartView(IReadOnlyList<CartLineView> Lines, int ItemCount, decimal Total);

/// <summary>The team cart with product names and prices, for the cart page and the header badge.</summary>
public interface ICartSummary
{
    Task<CartView> GetAsync(CancellationToken cancellationToken);
}

// #region snippet:cart-summary
// ONE query for every product in the cart: one round trip, and one operation at a time on the request's DbContext.
public sealed class CartSummary(ICartService cart, ShopDbContext db) : ICartSummary
{
    public async Task<CartView> GetAsync(CancellationToken cancellationToken)
    {
        var items = cart.Items();
        var ids = items.Select(i => i.ProductId).ToList();
        var products = await db.Products.AsNoTracking()
            .Where(p => ids.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, cancellationToken);

        return Build(items.Where(i => products.ContainsKey(i.ProductId)).Select(i => Line(products[i.ProductId], i.Quantity)));
    }
    // #endregion

    public static CartLineView Line(Product p, int quantity) => new(p.Id, p.Name, p.Emoji, p.Price, quantity, p.Price * quantity);

    public static CartView Build(IEnumerable<CartLineView> lines)
    {
        var list = lines.OrderBy(l => l.ProductId).ToList();
        return new CartView(list, list.Sum(l => l.Quantity), list.Sum(l => l.LineTotal));
    }
}
