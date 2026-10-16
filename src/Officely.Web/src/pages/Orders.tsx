import { useEffect, useState } from 'react'
import { api, money, type Order, type OrderStatus } from '../api'
import { Button, Empty, ErrorAlert, PageHeader } from '../components/ui'
import { useLoad, useShop } from '../shopStatus'

const statusStyle: Record<OrderStatus, string> = {
  PendingPayment: 'bg-slate-100 text-slate-800',
  Paid: 'bg-amber-100 text-amber-900',
  Shipped: 'bg-emerald-100 text-emerald-900',
  Cancelled: 'bg-red-100 text-red-900',
}

const statusText: Record<OrderStatus, string> = { PendingPayment: 'Awaiting payment', Paid: 'Paid', Shipped: 'Shipped', Cancelled: 'Cancelled' }

const CANCELLATION_WINDOW_MS = 15_000 // matches Fulfilment.CancellationWindow on the server

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : '—')

export function Orders() {
  const { data: orders, error, reload } = useLoad(api.orders, 2000)
  const { dataChanged } = useShop()
  const [now, setNow] = useState(() => Date.now())
  const [cancelError, setCancelError] = useState<Error | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function cancel(order: Order) {
    setCancelError(null)
    try {
      await api.cancelOrder(order.id)
      await reload()
      dataChanged()
    } catch (e) {
      setCancelError(e as Error)
    }
  }

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="A paid order can be cancelled for 15 seconds. After that, the fulfilment worker (a background job that runs every 5 seconds) ships it."
      />
      {error && <ErrorAlert error={error} title="Could not load orders" />}
      {cancelError && <ErrorAlert error={cancelError} title="Could not cancel the order" />}
      {orders && orders.length === 0 && <Empty>No orders yet.</Empty>}
      {orders && orders.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                {['Order', 'Customer', 'Items', 'Payment', 'Total', 'Status', 'Placed', 'Shipped', ''].map((h, i) => (
                  <th key={i} scope="col" className="px-4 py-3 font-semibold">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map(o => {
                const secondsLeft = Math.ceil((new Date(o.placedAt).getTime() + CANCELLATION_WINDOW_MS - now) / 1000)
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-semibold">#{o.id}</td>
                    <td className="px-4 py-3">{o.customerEmail}</td>
                    <td className="px-4 py-3">{o.lines.map(l => `${l.quantity}× ${l.productName}`).join(', ')}</td>
                    <td className="px-4 py-3">
                      {o.paymentProvider}
                      {o.paymentReference && <span className="block font-mono text-xs text-slate-500">{o.paymentReference}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{money(o.total)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[o.status]}`}>{statusText[o.status]}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{time(o.placedAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{time(o.shippedAt)}</td>
                    <td className="px-4 py-3">
                      {o.status === 'Paid' && (
                        <Button tone="danger" onClick={() => cancel(o)} aria-label={`Cancel order ${o.id}`}>
                          Cancel{secondsLeft > 0 ? ` (${secondsLeft} s)` : ''}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
