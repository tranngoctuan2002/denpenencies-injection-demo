using Microsoft.EntityFrameworkCore;

namespace Officely.Api.Data;

public sealed class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Emoji { get; set; } = "";
    public decimal Price { get; set; }
    public int Stock { get; set; }
}

public enum OrderStatus { PendingPayment, Paid, Shipped, Cancelled }

public sealed class Order
{
    public int Id { get; set; }
    public string CustomerEmail { get; set; } = "";
    public string PaymentProvider { get; set; } = "";
    public string? PaymentReference { get; set; }
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
    public DateTime PlacedAt { get; set; }
    public DateTime? ShippedAt { get; set; }
    public List<OrderLine> Lines { get; set; } = [];
}

public sealed class OrderLine
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public decimal UnitPrice { get; set; }
    public int Quantity { get; set; }
}

public sealed class Email
{
    public int Id { get; set; }
    public string To { get; set; } = "";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTime SentAt { get; set; }
}

public sealed class ShopDbContext(DbContextOptions<ShopDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Email> Emails => Set<Email>();

    // SQLite has no time zones: mark every stored DateTime as UTC on the way back, or JSON sends it as local time.
    protected override void ConfigureConventions(ModelConfigurationBuilder b) =>
        b.Properties<DateTime>().HaveConversion<UtcConverter>();

    private sealed class UtcConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
        v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Order>().Property(o => o.Status).HasConversion<string>();
        b.Entity<Order>().HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.OrderId);
    }
}

public static class ShopDatabase
{
    private static readonly Product[] Catalog =
    [
        new() { Name = "Team Mug", Emoji = "☕", Price = 12.00m, Stock = 500, Description = "Ceramic, 350 ml, with the team logo." },
        new() { Name = "Hoodie", Emoji = "🧥", Price = 49.00m, Stock = 5, Description = "Heavyweight cotton, unisex fit." },
        new() { Name = "Mechanical Keyboard", Emoji = "⌨️", Price = 89.00m, Stock = 8, Description = "Hot-swappable, brown switches." },
        new() { Name = "Wireless Mouse", Emoji = "🖱️", Price = 35.00m, Stock = 20, Description = "Silent clicks, 70-day battery." },
        new() { Name = "Sticker Pack", Emoji = "🏷️", Price = 4.50m, Stock = 200, Description = "Ten vinyl stickers." },
        new() { Name = "USB-C Hub", Emoji = "🔌", Price = 39.90m, Stock = 12, Description = "HDMI, 3× USB-A, SD card, 100 W PD." },
    ];

    public static async Task EnsureCreatedAsync(ShopDbContext db, CancellationToken ct = default)
    {
        await db.Database.EnsureCreatedAsync(ct);
        if (!await db.Products.AnyAsync(ct))
        {
            db.Products.AddRange(Catalog.Select(p => new Product { Name = p.Name, Emoji = p.Emoji, Price = p.Price, Stock = p.Stock, Description = p.Description }));
            await db.SaveChangesAsync(ct);
        }
    }

    public static async Task ResetAsync(ShopDbContext db, CancellationToken ct = default)
    {
        await db.Database.EnsureDeletedAsync(ct);
        await EnsureCreatedAsync(db, ct);
    }
}
