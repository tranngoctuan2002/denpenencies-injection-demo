using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Officely.Api.Data;

/// <summary>
/// A real database server is a network round trip away; local SQLite answers instantly and completes "async"
/// queries synchronously. This adds the round trip, so an async query really is still running while other code runs.
/// </summary>
public sealed class SimulatedLatencyInterceptor(TimeSpan latency) : DbCommandInterceptor
{
    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await Task.Delay(latency, cancellationToken);
        return result;
    }
}
