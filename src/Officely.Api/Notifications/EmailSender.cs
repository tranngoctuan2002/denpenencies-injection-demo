using Officely.Api.Data;

namespace Officely.Api.Notifications;

public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken);
}

/// <summary>Development mail server: messages are stored in the database and shown on the Inbox page.</summary>
public sealed class DatabaseEmailSender(ShopDbContext db, TimeProvider clock) : IEmailSender
{
    public async Task SendAsync(string to, string subject, string body, CancellationToken cancellationToken)
    {
        db.Emails.Add(new Email { To = to, Subject = subject, Body = body, SentAt = clock.GetUtcNow().UtcDateTime });
        await db.SaveChangesAsync(cancellationToken);
    }
}
