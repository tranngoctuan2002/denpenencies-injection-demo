type Mark = 'removed' | 'added' | undefined

const normalize = (line: string) => line.trim().replace(/\s+/g, ' ')

// Only real code lines are marked; comments, blank lines and lone braces would just add noise.
const isCode = (line: string) => {
  const t = normalize(line)
  return t.length > 2 && !t.startsWith('//')
}

function Line({ text, mark }: { text: string; mark: Mark }) {
  const comment = text.indexOf('//')
  const code = comment >= 0 ? text.slice(0, comment) : text
  return (
    <div className={mark === 'removed' ? 'bg-red-900/60' : mark === 'added' ? 'bg-emerald-900/60' : undefined}>
      <span aria-hidden className="inline-block w-5 select-none text-slate-400">
        {mark === 'removed' ? '−' : mark === 'added' ? '+' : ' '}
      </span>
      {mark && <span className="sr-only">{mark === 'removed' ? 'Only in broken: ' : 'Only in fixed: '}</span>}
      {code}
      {comment >= 0 && <span className="italic text-slate-400">{text.slice(comment)}</span>}
    </div>
  )
}

function CodeBlock({ title, text, mark }: { title: string; text: string; mark: (line: string) => Mark }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-semibold text-slate-700">{title}</figcaption>
      <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-950 p-3 text-[0.78rem] leading-relaxed text-slate-100">
        <code>
          {text.split('\n').map((line, i) => (
            <Line key={i} text={line} mark={mark(line)} />
          ))}
        </code>
      </pre>
    </figure>
  )
}

/** Broken and fixed code side by side; lines that exist on only one side are marked. */
export function CodeCompare({ broken, fixed }: { broken: string; fixed: string }) {
  const inBroken = new Set(broken.split('\n').map(normalize))
  const inFixed = new Set(fixed.split('\n').map(normalize))
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">
        <span className="font-mono font-bold">−</span> only in the broken version · <span className="font-mono font-bold">+</span> only in
        the fixed version. Read from the source files that are running.
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        <CodeBlock title="Broken" text={broken} mark={l => (isCode(l) && !inFixed.has(normalize(l)) ? 'removed' : undefined)} />
        <CodeBlock title="Fixed" text={fixed} mark={l => (isCode(l) && !inBroken.has(normalize(l)) ? 'added' : undefined)} />
      </div>
    </div>
  )
}
