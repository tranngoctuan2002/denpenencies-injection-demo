namespace Officely.Api.Cart;

public sealed record CartItem(int ProductId, int Quantity);

/// <summary>The office's shared team cart: everybody adds to the same one.</summary>
public interface ICartService
{
    Task AddAsync(int productId, int quantity, CancellationToken cancellationToken);
    void SetQuantity(int productId, int quantity);
    IReadOnlyList<CartItem> Items();
    void Clear();
}

public interface IInventoryClient
{
    Task EnsureInStockAsync(int productId, int quantity, CancellationToken cancellationToken);
}

/// <summary>Fake warehouse API: a short network round trip, everything is in stock.</summary>
public sealed class FakeInventoryClient : IInventoryClient
{
    public Task EnsureInStockAsync(int productId, int quantity, CancellationToken cancellationToken) =>
        Task.Delay(15, cancellationToken);
}

// #region snippet:cart-fixed
// A Singleton shared by every request, so ONE lock protects the whole read-modify-write,
// and every read and write of the quantities goes through the same lock.
public sealed class CartService(IInventoryClient inventory) : ICartService
{
    private readonly Lock _gate = new();
    private readonly Dictionary<int, int> _quantities = [];

    public async Task AddAsync(int productId, int quantity, CancellationToken cancellationToken)
    {
        await inventory.EnsureInStockAsync(productId, quantity, cancellationToken);   // slow I/O stays outside the lock

        lock (_gate)
            _quantities[productId] = _quantities.GetValueOrDefault(productId) + quantity;   // read + write, atomically
    }

    public void SetQuantity(int productId, int quantity)
    {
        lock (_gate)
        {
            if (quantity <= 0) _quantities.Remove(productId);
            else _quantities[productId] = quantity;
        }
    }

    public IReadOnlyList<CartItem> Items()
    {
        lock (_gate) return _quantities.Select(q => new CartItem(q.Key, q.Value)).ToList();
    }

    public void Clear()
    {
        lock (_gate) _quantities.Clear();
    }
}
// #endregion
