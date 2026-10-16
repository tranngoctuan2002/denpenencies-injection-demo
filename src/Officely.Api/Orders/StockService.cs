using Officely.Api.Data;

namespace Officely.Api.Orders;

public interface IStockService
{
    Task ReserveAsync(IEnumerable<OrderLine> lines, CancellationToken cancellationToken);
}

// #region snippet:stock-service
// Changes are only TRACKED here. The order service's single SaveChangesAsync commits the new order and the
// lower stock together, which works only because both services received the same Scoped ShopDbContext.
public sealed class StockService(ShopDbContext db) : IStockService
{
    public async Task ReserveAsync(IEnumerable<OrderLine> lines, CancellationToken cancellationToken)
    {
        foreach (var line in lines)
        {
            var product = await db.Products.FindAsync([line.ProductId], cancellationToken)
                ?? throw new CheckoutException($"Product {line.ProductId} no longer exists.");
            if (product.Stock < line.Quantity)
                throw new CheckoutException($"Only {product.Stock} × {product.Name} left in stock.");
            product.Stock -= line.Quantity;
        }
    }
}
// #endregion
