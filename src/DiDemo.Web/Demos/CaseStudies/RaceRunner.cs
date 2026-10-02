using DiDemo.Web.Shop;

namespace DiDemo.Web.Demos.CaseStudies;

/// <summary>
/// Runs N "requests" against one shared IOrderMetrics. They work in batches and start each batch at the same
/// instant (Barrier), so the race is real and repeatable - and it takes about a second, so the UI can watch it.
/// </summary>
public static class RaceRunner
{
    public const int PerWorker = 50_000;
    private const int BatchSize = 2_500;                 // 20 batches per worker
    private static readonly TimeSpan Pause = TimeSpan.FromMilliseconds(60);

    // #region snippet:race-run
    public static async Task RunAsync(IOrderMetrics metrics, int workers, Func<object, Task>? emit = null)
    {
        long attempted = 0;                              // how many calls were MADE (counted separately, safely)
        var finished = 0;
        var done = new TaskCompletionSource();
        using var barrier = new Barrier(workers);        // everybody starts every batch together

        for (var w = 0; w < workers; w++)
        {
            new Thread(() =>
            {
                for (var batch = 0; batch < PerWorker / BatchSize; batch++)
                {
                    barrier.SignalAndWait();
                    for (var i = 0; i < BatchSize; i++)
                    {
                        metrics.OrderPlaced(10m);        // <- the shared singleton, hit by all workers at once
                        if ((i + 1) % 100 == 0) Interlocked.Add(ref attempted, 100);
                    }
                    Thread.Sleep(Pause);
                }
                if (Interlocked.Increment(ref finished) == workers) done.TrySetResult();
            }) { IsBackground = true }.Start();
        }

        // sample the numbers while the workers run (this is what the UI draws live)
        while (!done.Task.IsCompleted)
        {
            if (emit is not null) await emit(Sample(metrics, Interlocked.Read(ref attempted), workers));
            await Task.WhenAny(done.Task, Task.Delay(40));
        }
        if (emit is not null) await emit(Sample(metrics, Interlocked.Read(ref attempted), workers));
    }
    // #endregion

    private static object Sample(IOrderMetrics metrics, long attempted, int workers) => new
    {
        type = "tick",
        attempted,
        counted = metrics.Snapshot().OrdersPlaced,
        expected = workers * PerWorker
    };
}
