namespace Officely.Api.Payments;

public sealed record PaymentRequest(int OrderId, decimal Amount, string CustomerEmail);

public sealed record PaymentResult(string Provider, string Reference);

// #region snippet:payment-processor
public interface IPaymentProcessor
{
    string Provider { get; }

    Task<PaymentResult> ProcessAsync(
        PaymentRequest request,
        CancellationToken cancellationToken);
}
// #endregion

// Fake providers: no network calls, no credentials.
public sealed class StripePaymentProcessor : IPaymentProcessor
{
    public string Provider => "Stripe";

    public async Task<PaymentResult> ProcessAsync(PaymentRequest request, CancellationToken cancellationToken)
    {
        await Task.Delay(120, cancellationToken);
        return new PaymentResult(Provider, $"ch_{request.OrderId:D6}");
    }
}

public sealed class PayPalPaymentProcessor : IPaymentProcessor
{
    public string Provider => "PayPal";

    public async Task<PaymentResult> ProcessAsync(PaymentRequest request, CancellationToken cancellationToken)
    {
        await Task.Delay(120, cancellationToken);
        return new PaymentResult(Provider, $"PAYID-{request.OrderId:D6}");
    }
}

public sealed class MoMoPaymentProcessor : IPaymentProcessor
{
    public string Provider => "MoMo";

    public async Task<PaymentResult> ProcessAsync(PaymentRequest request, CancellationToken cancellationToken)
    {
        await Task.Delay(120, cancellationToken);
        return new PaymentResult(Provider, $"MOMO{request.OrderId:D8}");
    }
}

public interface IPaymentProcessorResolver
{
    IReadOnlyCollection<string> SupportedProviders { get; }
    IPaymentProcessor Resolve(string provider);
}

// #region snippet:payment-resolver
// DI supplies EVERY registered IPaymentProcessor. This class only decides WHICH one to use.
public sealed class PaymentProcessorResolver : IPaymentProcessorResolver
{
    private readonly Dictionary<string, IPaymentProcessor> _byProvider = new(StringComparer.OrdinalIgnoreCase);

    public PaymentProcessorResolver(IEnumerable<IPaymentProcessor> processors)
    {
        foreach (var processor in processors)
        {
            if (!_byProvider.TryAdd(processor.Provider, processor))
                throw new InvalidOperationException(
                    $"Payment provider '{processor.Provider}' is registered twice " +
                    $"({_byProvider[processor.Provider].GetType().Name} and {processor.GetType().Name}).");
        }
    }

    public IReadOnlyCollection<string> SupportedProviders => _byProvider.Keys;

    public IPaymentProcessor Resolve(string provider) =>
        _byProvider.TryGetValue(provider?.Trim() ?? "", out var processor)
            ? processor
            : throw new UnsupportedPaymentProviderException(provider, SupportedProviders);
}
// #endregion

public sealed class UnsupportedPaymentProviderException(string? provider, IEnumerable<string> supported)
    : Exception($"Payment provider '{provider}' is not supported. Supported providers: {string.Join(", ", supported)}.");
