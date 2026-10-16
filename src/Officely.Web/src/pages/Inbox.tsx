import { api } from '../api'
import { Empty, ErrorAlert, PageHeader } from '../components/ui'
import { useLoad } from '../shopStatus'

export function Inbox() {
  const { data: emails, error } = useLoad(api.inbox, 3000)

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Development mail server: every e-mail the shop sends to customers lands here instead of a real mailbox."
      />
      {error && <ErrorAlert error={error} title="Could not load the inbox" />}
      {emails && emails.length === 0 && <Empty>No e-mails sent yet. Place an order to get a confirmation.</Empty>}
      {emails && emails.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
          {emails.map(m => (
            <li key={m.id} className="flex flex-wrap gap-x-4 gap-y-1 p-4">
              <span aria-hidden className="text-2xl">✉️</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.subject}</p>
                <p className="text-sm text-slate-600">To {m.to}</p>
                <p className="mt-1 text-sm">{m.body}</p>
              </div>
              <time className="text-sm tabular-nums text-slate-500" dateTime={m.sentAt}>
                {new Date(m.sentAt).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
