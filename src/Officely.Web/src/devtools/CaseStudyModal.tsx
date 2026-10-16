import { useEffect, useState } from 'react'
import { api, type CaseStudyDetails } from '../api'
import { CodeCompare } from '../components/CodeCompare'
import { DependencyGraph } from '../components/DependencyGraph'
import { ErrorAlert } from '../components/ui'
import type { CaseStudyInfo } from './caseStudies'
import { Modal } from './Modal'

const tabs = ['What is going on', 'Code', 'Dependency graph'] as const

export function CaseStudyModal({ info, onClose }: { info: CaseStudyInfo; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0])
  const [details, setDetails] = useState<CaseStudyDetails | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    api.caseStudy(info.id).then(setDetails, setError)
  }, [info.id])

  return (
    <Modal title={`Case study ${info.number}: ${info.title}`} onClose={onClose}>
      <div role="tablist" aria-label="Case study sections" className="mb-5 flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 ${
              tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tab}>
        {tab === 'What is going on' && (
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                ['What happened?', info.symptom],
                ['Why did it happen?', info.why],
                ['How do we fix it?', info.fix],
                ['What principle should we remember?', info.principle],
              ] as const
            ).map(([q, a]) => (
              <section key={q} className={`rounded-xl border p-4 ${q.startsWith('What principle') ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200'}`}>
                <h3 className="mb-1 font-bold">{q}</h3>
                <p className="text-slate-700">{a}</p>
              </section>
            ))}
            <section className="rounded-xl border border-slate-200 p-4 md:col-span-2">
              <h3 className="mb-1 font-bold">Keep in mind</h3>
              <ul className="list-disc space-y-1 pl-5 text-slate-700">
                {info.notes.map(n => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          </div>
        )}
        {tab !== 'What is going on' && error && <ErrorAlert error={error} title="Could not load the case study" />}
        {tab !== 'What is going on' && !details && !error && <p className="text-slate-600">Loading…</p>}
        {tab === 'Code' && details && <CodeCompare broken={details.code.broken} fixed={details.code.fixed} />}
        {tab === 'Dependency graph' && details && (
          <div className="space-y-6">
            <DependencyGraph graph={details.graphs.broken} title="Broken registration" />
            <DependencyGraph graph={details.graphs.fixed} title="Fixed registration" />
          </div>
        )}
      </div>
    </Modal>
  )
}
