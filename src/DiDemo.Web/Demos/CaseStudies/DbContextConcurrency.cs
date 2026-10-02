using System.Diagnostics;
using DiDemo.Web.Data;
using Microsoft.EntityFrameworkCore;

namespace DiDemo.Web.Demos.CaseStudies;

/// <summary>One parallel task, with timing, for the timeline in the UI.</summary>
public record TaskRun(int Index, long StartMs, long EndMs, bool Ok, string? Error);

public static class DbContextConcurrency
{
    // The "slow" price lookup: WAITFOR keeps the query in flight so parallel calls truly overlap.
    private static async Task<decimal> LookupPriceAsync(ShopDbContext db, int productId)
    {
        var rows = await db.Products
            .FromSqlInterpolated($"WAITFOR DELAY '00:00:00.200'; SELECT * FROM Products WHERE Id = {productId}")
            .AsNoTracking()
            .ToListAsync();
        return rows.Single().Price;
    }

    // `emit` (optional) is called the moment a task starts and the moment it ends, so the UI can draw it live.

    // #region snippet:dbcontext-sequential
    // SAFE BUT SLOW: one query after another on the request's DbContext.
    public static async Task<object> RunSequentialAsync(ShopDbContext db, int[] productIds, int count, Func<object, Task>? emit = null)
    {
        var sw = Stopwatch.StartNew();
        var runs = new List<TaskRun>();
        for (var i = 0; i < count; i++)
            runs.Add(await Timed(i, sw, emit, () => LookupPriceAsync(db, productIds[i % productIds.Length])));
        return Summarize(runs.ToArray(), sw);
    }
    // #endregion

    // #region snippet:dbcontext-broken
    // BROKEN: one scoped DbContext shared by many parallel tasks. DbContext is NOT thread-safe.
    public static async Task<object> RunSharedAsync(ShopDbContext db, int[] productIds, int parallelism, Func<object, Task>? emit = null)
    {
        var sw = Stopwatch.StartNew();
        var runs = await Task.WhenAll(Enumerable.Range(0, parallelism).Select(i =>
            Timed(i, sw, emit, () => LookupPriceAsync(db, productIds[i % productIds.Length]))));
        return Summarize(runs, sw);
    }
    // #endregion

    // #region snippet:dbcontext-fixed
    // FIXED: IDbContextFactory gives every parallel task its own short-lived DbContext.
    public static async Task<object> RunWithFactoryAsync(IDbContextFactory<ShopDbContext> factory, int[] productIds, int parallelism, Func<object, Task>? emit = null)
    {
        var sw = Stopwatch.StartNew();
        var runs = await Task.WhenAll(Enumerable.Range(0, parallelism).Select(i =>
            Timed(i, sw, emit, async () =>
            {
                await using var db = await factory.CreateDbContextAsync();
                return await LookupPriceAsync(db, productIds[i % productIds.Length]);
            })));
        return Summarize(runs, sw);
    }
    // #endregion

    private static async Task<TaskRun> Timed(int index, Stopwatch sw, Func<object, Task>? emit, Func<Task<decimal>> work)
    {
        var start = sw.ElapsedMilliseconds;
        if (emit is not null) await emit(new { type = "start", index, startMs = start });
        TaskRun run;
        try
        {
            await work();
            run = new TaskRun(index, start, sw.ElapsedMilliseconds, true, null);
        }
        catch (Exception ex)
        {
            run = new TaskRun(index, start, sw.ElapsedMilliseconds, false, $"{ex.GetType().Name}: {ex.Message}");
        }
        if (emit is not null) await emit(new { type = "end", index, startMs = run.StartMs, endMs = run.EndMs, ok = run.Ok, error = run.Error });
        return run;
    }

    private static object Summarize(TaskRun[] runs, Stopwatch sw) => new
    {
        succeeded = runs.Count(r => r.Ok),
        failed = runs.Count(r => !r.Ok),
        elapsedMs = sw.ElapsedMilliseconds,
        distinctErrors = runs.Where(r => r.Error is not null).Select(r => r.Error!).Distinct().ToList(),
        tasks = runs
    };
}
