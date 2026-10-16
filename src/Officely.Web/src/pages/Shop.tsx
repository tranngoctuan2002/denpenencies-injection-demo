import { useState } from 'react'
import { api, money, type Product } from '../api'
import { Button, ErrorAlert, PageHeader } from '../components/ui'
import { useLoad, useShop } from '../shopStatus'

export function Shop() {
  const { data: products, error } = useLoad(api.products)
  const { dataChanged } = useShop()
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [addError, setAddError] = useState<Error | null>(null)

  async function add(p: Product) {
    setBusy(p.id)
    setAddError(null)
    try {
      await api.addToCart(p.id)
      setMessage({ ok: true, text: `Added ${p.name} to the team cart.` })
      dataChanged()
    } catch (e) {
      setAddError(e as Error)
      setMessage(null)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 px-6 py-8 text-white shadow">
        <p className="text-sm font-semibold uppercase tracking-wider text-indigo-100">Team store</p>
        <h1 className="mt-1 text-3xl font-bold">Gear for the whole office, one shared cart.</h1>
        <p className="mt-2 max-w-2xl text-indigo-100">
          Everyone adds to the same team cart. One person checks out with Stripe, PayPal or MoMo, and we ship it.
        </p>
      </section>

      <PageHeader title="Products" />
      <div aria-live="polite" className="mb-4 space-y-2">
        {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-900">✓ {message.text}</p>}
        {addError && <ErrorAlert error={addError} title="Could not add to the cart" />}
      </div>
      {error && <ErrorAlert error={error} title="Could not load the products" />}
      {!products && !error && <p className="text-slate-600">Loading products…</p>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products?.map(p => (
          <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div aria-hidden className="mb-3 flex h-28 items-center justify-center rounded-lg bg-slate-100 text-5xl">
              {p.emoji}
            </div>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-1 flex-1 text-sm text-slate-600">{p.description}</p>
            <p className={`mt-2 text-sm font-semibold ${p.stock > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-lg font-bold">{money(p.price)}</span>
              <Button tone="primary" onClick={() => add(p)} disabled={busy === p.id} aria-label={`Add ${p.name} to cart`}>
                {busy === p.id ? 'Adding…' : 'Add to cart'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
