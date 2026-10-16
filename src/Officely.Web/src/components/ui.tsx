import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ApiError, shortNames } from '../api'

const tones = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600',
  secondary: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
  danger: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
  dark: 'bg-slate-800 text-slate-100 hover:bg-slate-700 border-slate-600',
}

export function Button({
  tone = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
      {...props}
    />
  )
}

/** An API failure shown the way a real app would, with the HTTP status and the server's ProblemDetails. */
export function ErrorAlert({ error, title }: { error: Error; title?: string }) {
  const api = error instanceof ApiError ? error : null
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
      <p className="font-semibold">
        {title ?? 'Something went wrong'}
        {api && api.status > 0 && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs">HTTP {api.status}</span>}
      </p>
      <p className="mt-1 text-sm">{shortNames(api?.title ?? error.message)}</p>
      {api?.detail && <p className="mt-1 break-words font-mono text-xs">{shortNames(api.detail)}</p>}
      {api?.exception && <p className="mt-1 font-mono text-xs text-red-700">{api.exception}</p>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">{children}</div>
}
