import { useState } from 'react'
import { api, type CaseStudy, type SimulationResult } from '../api'
import { Button, ErrorAlert } from '../components/ui'
import { useShop } from '../shopStatus'
import { caseStudies, finalDistinction, takeaways, type CaseStudyInfo } from './caseStudies'
import { CaseStudyModal } from './CaseStudyModal'
import { Modal } from './Modal'

const MUG = 1

/** Dev tooling, docked next to the store: deploy a broken DI registration and watch the store misbehave. */
export function DevPanel({ onClose }: { onClose: () => void }) {
  const { status, restarting, unreachable, switchCaseStudy, dataChanged } = useShop()
  const [explain, setExplain] = useState<CaseStudyInfo | null>(null)
  const [showTakeaways, setShowTakeaways] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [simulation, setSimulation] = useState<SimulationResult | null>(null)

  const busy = restarting || !status
  const validation = status?.validation ?? true

  async function deploy(broken: CaseStudy, withValidation = validation) {
    setError(null)
    setSimulation(null)
    try {
      await switchCaseStudy(broken, withValidation)
    } catch (e) {
      setError(e as Error)
    }
  }

  async function simulate() {
    setSimulating(true)
    setError(null)
    try {
      setSimulation(await api.simulateBuyers(100, MUG))
      dataChanged()
    } catch (e) {
      setError(e as Error)
    } finally {
      setSimulating(false)
    }
  }

  async function resetData() {
    setError(null)
    try {
      await api.resetData()
      setSimulation(null)
      dataChanged()
    } catch (e) {
      setError(e as Error)
    }
  }

  return (
    <aside
      aria-label="Case studies dev panel"
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-slate-700 bg-slate-900 text-slate-100 shadow-2xl sm:w-[26rem]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 p-4">
        <div>
          <h2 className="text-lg font-bold">🛠 Case studies</h2>
          <p className="text-sm text-slate-400">Deploy a broken DI registration, then use the store.</p>
        </div>
        <Button tone="dark" onClick={onClose} aria-label="Close the dev panel">
          ✕
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p role="status" aria-live="polite" className="rounded-lg bg-slate-800 px-3 py-2 text-sm">
          {restarting ? (
            <span className="text-sky-300">◌ Redeploying the shop…</span>
          ) : unreachable ? (
            <span className="text-red-300">✕ Server unreachable</span>
          ) : !status ? (
            'Connecting…'
          ) : status.running ? (
            <span className="text-emerald-300">
              ● Running · deploy #{status.generation} · {status.broken === 'None' ? 'all fixed' : `${status.broken} is broken`}
            </span>
          ) : (
            <span className="text-red-300">✕ Failed to start · deploy #{status.generation}</span>
          )}
        </p>

        <label className="flex items-start gap-3 rounded-lg border border-slate-700 p-3">
          <input
            type="checkbox"
            role="switch"
            checked={validation}
            disabled={busy}
            onChange={e => deploy(status?.broken ?? 'None', e.target.checked)}
            className="mt-1 h-4 w-4 accent-sky-400"
          />
          <span>
            <span className="font-semibold">Validate the service graph at startup</span>
            <span className="block text-sm text-slate-400">
              ValidateScopes + ValidateOnBuild. On by default in Development, off in Production.
            </span>
          </span>
        </label>

        {error && <ErrorAlert error={error} />}

        <ol className="space-y-3">
          {caseStudies.map(cs => {
            const broken = status?.broken === cs.id
            return (
              <li key={cs.id} className={`rounded-xl border p-3 ${broken ? 'border-amber-500/70 bg-amber-500/10' : 'border-slate-700 bg-slate-800/60'}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {cs.number} · {cs.area}
                </p>
                <h3 className="mt-0.5 font-semibold">{cs.title}</h3>

                <div role="group" aria-label={`${cs.title}: deployed version`} className="mt-2 inline-flex rounded-lg border border-slate-600 p-0.5">
                  {(['Fixed', 'Broken'] as const).map(v => {
                    const active = (v === 'Broken') === broken
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={active}
                        disabled={busy || active}
                        onClick={() => deploy(v === 'Broken' ? cs.id : 'None')}
                        className={`rounded-md px-3 py-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-default ${
                          active ? (v === 'Broken' ? 'bg-amber-400 text-slate-950' : 'bg-emerald-400 text-slate-950') : 'text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {active ? '✓ ' : ''}
                        {v}
                      </button>
                    )
                  })}
                </div>

                {broken && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-200">
                    {cs.tryIt.map(step => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}

                {cs.id === 'Cart' && (
                  <div className="mt-3 space-y-2">
                    <Button tone="dark" onClick={simulate} disabled={simulating || busy || !status?.running}>
                      {simulating ? 'Sending 100 requests…' : '▶ Simulate 100 buyers'}
                    </Button>
                    {simulation && (
                      <p aria-live="polite" className={`rounded-lg px-3 py-2 text-sm ${simulation.lost ? 'bg-red-500/15 text-red-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
                        {simulation.succeeded} requests succeeded. Team Mug quantity: expected <strong>{simulation.expected}</strong>, actual{' '}
                        <strong>{simulation.actual}</strong>
                        {simulation.lost ? ` (${simulation.lost} updates lost)` : ' (nothing lost)'}.
                      </p>
                    )}
                  </div>
                )}

                <button type="button" onClick={() => setExplain(cs)} className="mt-3 block text-sm font-semibold text-sky-300 underline hover:text-sky-200">
                  Explain: cause, code and dependency graph
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-700 p-4">
        <Button tone="dark" onClick={() => setShowTakeaways(true)}>
          Takeaways
        </Button>
        <Button tone="dark" onClick={resetData} disabled={busy || !status?.running}>
          Reset shop data
        </Button>
      </div>

      {explain && <CaseStudyModal info={explain} onClose={() => setExplain(null)} />}
      {showTakeaways && (
        <Modal title="Takeaways" onClose={() => setShowTakeaways(false)}>
          <ol className="grid gap-2 text-slate-800 md:grid-cols-2">
            {takeaways.map((t, i) => (
              <li key={t} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-lg text-indigo-950">{finalDistinction}</p>
        </Modal>
      )}
    </aside>
  )
}
