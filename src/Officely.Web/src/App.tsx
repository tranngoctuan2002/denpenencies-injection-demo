import { useEffect, useState, type ComponentType } from 'react'
import { api } from './api'
import { DevPanel } from './devtools/DevPanel'
import { caseStudies } from './devtools/caseStudies'
import { Cart } from './pages/Cart'
import { Inbox } from './pages/Inbox'
import { Orders } from './pages/Orders'
import { Shop } from './pages/Shop'
import { StartupFailed } from './pages/StartupFailed'
import { useLoad, useShop } from './shopStatus'

const routes: Record<string, ComponentType> = { '': Shop, cart: Cart, orders: Orders, inbox: Inbox }

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, '')
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route in routes ? route : ''
}

function readPanelOpen() {
  const wide = matchMedia('(min-width: 1024px)').matches // on a phone the panel would cover the store
  try {
    const saved = localStorage.getItem('devPanel')
    return saved ? saved === 'open' : wide
  } catch {
    return wide
  }
}

export function App() {
  const route = useRoute()
  const { status, restarting, unreachable } = useShop()
  const { data: cart } = useLoad(api.cart, 4000) // colleagues share the cart, so keep the badge fresh
  const [panelOpen, setPanelOpen] = useState(readPanelOpen)
  const Page = routes[route]
  const brokenCase = caseStudies.find(c => c.id === status?.broken)

  function togglePanel(open: boolean) {
    setPanelOpen(open)
    try {
      localStorage.setItem('devPanel', open ? 'open' : 'closed')
    } catch {
      /* the panel just won't be remembered */
    }
  }

  const link = (to: string, label: string, badge?: number) => (
    <a
      href={`#/${to}`}
      aria-current={route === to ? 'page' : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        route === to ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
      {badge ? (
        <span className="ml-1.5 rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white" aria-label={`${badge} items`}>
          {badge}
        </span>
      ) : null}
    </a>
  )

  return (
    <div className={panelOpen ? 'sm:pr-[26rem]' : ''}>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href="#/" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              🛒
            </span>
            Officely
          </a>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {link('', 'Shop')}
            {link('cart', 'Team cart', cart?.itemCount)}
            {link('orders', 'Orders')}
            {link('inbox', 'Inbox')}
          </nav>
          {!panelOpen && (
            <button
              type="button"
              onClick={() => togglePanel(true)}
              aria-expanded={false}
              className="ml-auto rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              🛠 Case studies
            </button>
          )}
        </div>
        {(brokenCase || restarting || unreachable) && (
          <div role="status" className={`px-4 py-1.5 text-center text-sm font-semibold ${restarting ? 'bg-sky-100 text-sky-900' : unreachable ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>
            {restarting
              ? 'Redeploying Officely…'
              : unreachable
                ? 'The Officely server is not reachable.'
                : `Dev build: case study ${brokenCase!.number} (${brokenCase!.title}) is deployed in its broken form.`}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {status && !status.running && status.startupError ? <StartupFailed error={status.startupError} /> : <Page />}
      </main>

      {panelOpen && <DevPanel onClose={() => togglePanel(false)} />}
    </div>
  )
}
