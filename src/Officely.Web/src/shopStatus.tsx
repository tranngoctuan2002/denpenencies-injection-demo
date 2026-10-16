import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type CaseStudy, type ShopStatus } from './api'

interface ShopStatusContext {
  status: ShopStatus | null
  /** True from a case-study switch until the restarted shop answers. */
  restarting: boolean
  unreachable: boolean
  switchCaseStudy: (broken: CaseStudy, validation: boolean) => Promise<void>
  /** Changes whenever pages should reload their data (shop restarted, cart changed, data reset). */
  version: number
  dataChanged: () => void
}

const Context = createContext<ShopStatusContext | null>(null)

export function ShopStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShopStatus | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [version, setVersion] = useState(0)
  const waitingFor = useRef(0) // the generation we expect after a restart
  const lastGeneration = useRef<number | null>(null)

  const poll = useCallback(async () => {
    try {
      const s = await api.status()
      setUnreachable(false)
      if (lastGeneration.current !== null && lastGeneration.current !== s.generation) setVersion(v => v + 1)
      lastGeneration.current = s.generation
      setStatus(s)
      if (s.generation >= waitingFor.current) setRestarting(false)
    } catch {
      setUnreachable(true) // expected for a moment while the shop restarts
    }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, restarting ? 400 : 3000)
    return () => clearInterval(t)
  }, [poll, restarting])

  const switchCaseStudy = useCallback(
    async (broken: CaseStudy, validation: boolean) => {
      waitingFor.current = (status?.generation ?? 0) + 1
      setRestarting(true)
      try {
        await api.switchCaseStudy(broken, validation)
      } catch (e) {
        setRestarting(false)
        throw e
      }
    },
    [status],
  )

  const dataChanged = useCallback(() => setVersion(v => v + 1), [])

  return (
    <Context.Provider value={{ status, restarting, unreachable: unreachable && !restarting, switchCaseStudy, version, dataChanged }}>
      {children}
    </Context.Provider>
  )
}

export function useShop() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useShop must be used inside ShopStatusProvider')
  return ctx
}

/** Loads data, reloads it when the shop restarts or data changes, and optionally polls. */
export function useLoad<T>(load: () => Promise<T>, pollMs?: number) {
  const { version } = useShop()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (e) {
      setError(e as Error)
    }
  }, [])

  useEffect(() => {
    reload()
    if (!pollMs) return
    const t = setInterval(reload, pollMs)
    return () => clearInterval(t)
  }, [reload, version, pollMs])

  return { data, error, reload }
}
