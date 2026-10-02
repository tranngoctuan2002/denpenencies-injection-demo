using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Data;

public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public int Stock { get; set; }
}

public class OrderLine
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

public class Order
{
    public int Id { get; set; }
    public Guid CorrelationId { get; set; }
    public string Customer { get; set; } = "";
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal Tax { get; set; }
    public decimal Total { get; set; }
    public string PaymentReference { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ConfirmationSentAt { get; set; }
    public List<OrderLine> Lines { get; set; } = [];
}

public class AuditEntry
{
    public int Id { get; set; }
    public Guid CorrelationId { get; set; }
    public string User { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTime At { get; set; }
}

public class ShopDbContext(DbContextOptions<ShopDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>().Property(p => p.Price).HasPrecision(18, 2);
        b.Entity<OrderLine>().Property(p => p.UnitPrice).HasPrecision(18, 2);
        b.Entity<Order>(e =>
        {
            e.Property(p => p.Subtotal).HasPrecision(18, 2);
            e.Property(p => p.Discount).HasPrecision(18, 2);
            e.Property(p => p.Tax).HasPrecision(18, 2);
            e.Property(p => p.Total).HasPrecision(18, 2);
            e.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.OrderId);
        });
    }
}

public static class DbInitializer
{
    private static readonly (string Name, decimal Price, int Stock)[] Catalog =
    [
        ("Mechanical Keyboard", 89.00m, 25),
        ("Wireless Mouse", 35.00m, 40),
        ("USB-C Hub", 49.90m, 20),
        ("27\" Monitor", 249.00m, 10),
        ("HD Webcam", 59.00m, 15),
        ("Noise-Cancelling Headset", 79.00m, 30)
    ];

    /// <summary>Waits for SQL Server (the container may still be booting), creates the schema and seeds products.</summary>
    public static async Task InitializeAsync(IServiceProvider sp, ILogger logger)
    {
        var factory = sp.GetRequiredService<IDbContextFactory<ShopDbContext>>();
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var db = await factory.CreateDbContextAsync();
                await db.Database.EnsureCreatedAsync();
                if (!await db.Products.AnyAsync()) await SeedAsync(db);
                logger.LogInformation("Database ready.");
                return;
            }
            catch (Exception ex) when (attempt < 40)
            {
                logger.LogWarning("SQL Server not ready (attempt {Attempt}): {Message}", attempt, ex.Message.Split('\n')[0]);
                await Task.Delay(2000);
            }
        }
    }

    public static async Task ResetAsync(ShopDbContext db)
    {
        await db.OrderLines.ExecuteDeleteAsync();
        await db.Orders.ExecuteDeleteAsync();
        await db.AuditEntries.ExecuteDeleteAsync();

        // Restore the catalog IN PLACE: product ids must not change, or open browser tabs
        // would still point at ids that no longer exist.
        foreach (var (name, price, stock) in Catalog)
        {
            await db.Products.Where(p => p.Name == name)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, stock).SetProperty(p => p.Price, price));
        }
        if (!await db.Products.AnyAsync()) await SeedAsync(db);
    }

    private static async Task SeedAsync(ShopDbContext db)
    {
        db.Products.AddRange(Catalog.Select(c => new Product { Name = c.Name, Price = c.Price, Stock = c.Stock }));
        await db.SaveChangesAsync();
    }
}
