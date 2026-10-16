import { useState, type FormEvent } from 'react'
import { api, money, type Order } from '../api'
import { Button, Empty, ErrorAlert, PageHeader } from '../components/ui'
import { useLoad, useShop } from '../shopStatus'

const providers = [
  { id: 'stripe', name: 'Stripe', note: 'Card payments' },
  { id: 'paypal', name: 'PayPal', note: 'PayPal balance or card' },
  { id: 'momo', name: 'MoMo', note: 'Mobile wallet', isNew: true },
]

export function Cart() {
  const { data: cart, error, reload } = useLoad(api.cart)
  const { dataChanged } = useShop()
  const [email, setEmail] = useState('alice@example.com')
  const [provider, setProvider] = useState('stripe')
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState<Order | null>(null)
  const [checkoutError, setCheckoutError] = useState<Error | null>(null)
  const [updateError, setUpdateError] = useState<Error | null>(null)

  async function update(action: () => Promise<void>) {
    setUpdateError(null)
    try {
      await action()
      await reload()
      dataChanged()
    } catch (e) {
      setUpdateError(e as Error)
    }
  }

  async function checkout(e: FormEvent) {
    e.preventDefault()
    setPlacing(true)
    setCheckoutError(null)
    try {
      setPlaced(await api.checkout(email, provider))
      await reload()
      dataChanged()
    } catch (err) {
      setCheckoutError(err as Error)
    } finally {
      setPlacing(false)
    }
  }

  if (placed)
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <p aria-hidden className="text-5xl">✅</p>
        <h1 className="mt-3 text-2xl font-bold">Order #{placed.id} placed</h1>
        <p className="mt-2 text-slate-600">
          Paid {money(placed.total)} with {placed.paymentProvider} (reference <span className="font-mono">{placed.paymentReference}</span>). A
          confirmation e-mail is on its way to {placed.customerEmail}.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a href="#/orders" className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">
            Track your order
          </a>
          <Button onClick={() => setPlaced(null)}>Back to the cart</Button>
        </div>
      </div>
    )

  return (
    <>
      <PageHeader title="Team cart" subtitle="Shared by everyone in the office. Changes from colleagues show up here too." />
      {error && <ErrorAlert error={error} title="Could not load the cart" />}
      {updateError && <ErrorAlert error={updateError} title="Could not update the cart" />}
      {cart && cart.lines.length === 0 && (
        <Empty>
          The team cart is empty. <a href="#/" className="font-semibold text-indigo-700 underline">Browse products</a>
        </Empty>
      )}
      {cart && cart.lines.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-label="Cart items" className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-200">
              {cart.lines.map(l => (
                <li key={l.productId} className="flex flex-wrap items-center gap-4 p-4">
                  <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-3xl">
                    {l.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{l.name}</p>
                    <p className="text-sm text-slate-600">{money(l.unitPrice)} each</p>
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${l.name}`}>
                    <Button onClick={() => update(() => api.setQuantity(l.productId, l.quantity - 1))} aria-label="Decrease">−</Button>
                    <span className="w-12 text-center font-semibold tabular-nums" aria-live="polite">{l.quantity}</span>
                    <Button onClick={() => update(() => api.setQuantity(l.productId, l.quantity + 1))} aria-label="Increase">+</Button>
                  </div>
                  <span className="w-24 text-right font-semibold tabular-nums">{money(l.lineTotal)}</span>
                  <Button tone="danger" onClick={() => update(() => api.setQuantity(l.productId, 0))} aria-label={`Remove ${l.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-slate-200 p-4">
              <Button onClick={() => update(api.clearCart)}>Empty cart</Button>
              <p className="text-lg">
                {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} · <strong>{money(cart.total)}</strong>
              </p>
            </div>
          </section>

          <form onSubmit={checkout} className="space-y-4 self-start rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Checkout</h2>
            <label className="block">
              <span className="text-sm font-semibold">E-mail for the receipt</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <fieldset>
              <legend className="text-sm font-semibold">Payment method</legend>
              <div className="mt-2 space-y-2">
                {providers.map(p => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${provider === p.id ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-300'}`}
                  >
                    <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} />
                    <span className="flex-1">
                      <span className="font-semibold">{p.name}</span>
                      {p.isNew && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">New</span>}
                      <span className="block text-sm text-slate-600">{p.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {checkoutError && <ErrorAlert error={checkoutError} title="Payment failed" />}
            <Button tone="primary" type="submit" disabled={placing} className="w-full py-2.5 text-base">
              {placing ? 'Placing order…' : `Pay ${money(cart.total)}`}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}
