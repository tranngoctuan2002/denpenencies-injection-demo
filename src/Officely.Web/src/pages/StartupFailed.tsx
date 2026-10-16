import { shortNames, type ShopStatus } from '../api'

/** What the browser gets from a real deployment whose host threw during startup. */
export function StartupFailed({ error }: { error: NonNullable<ShopStatus['startupError']> }) {
  return (
    <div role="alert" className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-red-700">HTTP Error 500.30</p>
      <h1 className="mt-1 text-2xl font-bold">Officely failed to start</h1>
      <p className="mt-2 text-slate-600">
        The application threw while building its services, before it could serve a single request. Nothing in the store works until it
        is fixed and redeployed.
      </p>
      <div className="mt-4 rounded-lg bg-slate-950 p-4 font-mono text-sm text-red-200">
        <p className="font-bold text-red-300">{error.type}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-100">{shortNames(error.message)}</p>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold">Full exception (with namespaces)</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-xs">{error.fullText}</pre>
      </details>
      <p className="mt-4 text-slate-700">
        Use the <strong>Case studies</strong> panel to deploy the fixed version again.
      </p>
    </div>
  )
}
