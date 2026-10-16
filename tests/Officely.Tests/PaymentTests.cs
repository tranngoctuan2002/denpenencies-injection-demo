using Officely.Api.CaseStudies;
using Officely.Api.Data;
using Officely.Api.Payments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Officely.Tests;

public class PaymentTests
{
    [Theory]
    [InlineData("stripe", typeof(StripePaymentProcessor))]
    [InlineData("paypal", typeof(PayPalPaymentProcessor))]
    [InlineData("momo", typeof(MoMoPaymentProcessor))]
    public void Resolver_selects_the_processor_registered_for_the_provider(string provider, Type expected)
    {
        using var shop = new TestShop();
        Assert.IsType(expected, shop.Services.GetRequiredService<IPaymentProcessorResolver>().Resolve(provider));
    }

    [Theory]
    [InlineData("PayPal")]
    [InlineData("PAYPAL")]
    [InlineData(" paypal ")]
    public void Provider_matching_is_case_insensitive(string provider)
    {
        using var shop = new TestShop();
        Assert.Equal("PayPal", shop.Services.GetRequiredService<IPaymentProcessorResolver>().Resolve(provider).Provider);
    }

    [Fact]
    public async Task Unknown_provider_is_rejected_with_the_supported_list_and_nothing_is_saved()
    {
        using var shop = new TestShop();
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);

        var ex = await Assert.ThrowsAsync<UnsupportedPaymentProviderException>(() => shop.CheckoutAsync("applepay"));

        Assert.Contains("'applepay'", ex.Message);
        Assert.Contains("Stripe, PayPal, MoMo", ex.Message);
        Assert.Equal(0, await shop.InScopeAsync(sp => sp.GetRequiredService<ShopDbContext>().Orders.CountAsync()));
    }

    [Fact]
    public void Duplicate_provider_registrations_are_detected()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => new PaymentProcessorResolver([new StripePaymentProcessor(), new PayPalPaymentProcessor(), new StripePaymentProcessor()]));
        Assert.Contains("'Stripe' is registered twice", ex.Message);
    }

    private sealed class FakeCryptoProcessor : IPaymentProcessor
    {
        public string Provider => "Crypto";
        public Task<PaymentResult> ProcessAsync(PaymentRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new PaymentResult(Provider, "0xabc"));
    }

    [Fact]
    public async Task A_new_provider_is_one_registration_and_no_OrderService_change()
    {
        using var shop = new TestShop(configure: s => s.AddSingleton<IPaymentProcessor, FakeCryptoProcessor>());
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);

        var order = await shop.CheckoutAsync("crypto");

        Assert.Equal("Crypto", order.PaymentProvider);
        Assert.Equal("0xabc", order.PaymentReference);
        Assert.Equal(OrderStatus.Paid, order.Status);
    }

    [Fact]
    public async Task Broken_case_study_cannot_take_MoMo_without_editing_OrderService()
    {
        using var shop = new TestShop(CaseStudy.Payments);
        await shop.Cart.AddAsync(1, 1, CancellationToken.None);

        var ex = await Assert.ThrowsAsync<NotSupportedException>(() => shop.CheckoutAsync("momo"));
        Assert.Contains("'momo'", ex.Message);
        Assert.Equal("Stripe", (await shop.CheckoutAsync("stripe")).PaymentProvider);   // the hard-coded branches still work
    }
}
