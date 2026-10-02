using System.Text.Json;

namespace DiDemo.Web.Infrastructure;

/// <summary>
/// Streams events to the browser AS THEY HAPPEN: one JSON object per line (application/x-ndjson),
/// flushed immediately, so the page can show real-time progress of a running operation.
/// </summary>
public sealed class NdjsonStream
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    private readonly HttpResponse _response;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private NdjsonStream(HttpResponse response) => _response = response;

    public static NdjsonStream Begin(HttpContext http)
    {
        http.Response.ContentType = "application/x-ndjson";
        http.Response.Headers.CacheControl = "no-cache";
        http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()?.DisableBuffering();
        return new NdjsonStream(http.Response);
    }

    /// <summary>Thread-safe: several parallel tasks may report at the same time.</summary>
    public async Task EmitAsync(object evt)
    {
        await _gate.WaitAsync();
        try
        {
            await _response.WriteAsync(JsonSerializer.Serialize(evt, Options) + "\n");
            await _response.Body.FlushAsync();
        }
        finally { _gate.Release(); }
    }
}

/// <summary>IProgress&lt;T&gt; that reports synchronously, in order (Progress&lt;T&gt; posts to the thread pool and can reorder).</summary>
public sealed class SyncProgress<T>(Action<T> onReport) : IProgress<T>
{
    public void Report(T value) => onReport(value);
}
