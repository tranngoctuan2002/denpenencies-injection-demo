import type { EdgeKind, Graph, GraphNode } from '../api'

const NODE_W = 236
const NODE_H = 54
const COL_GAP = 70
const ROW_GAP = 20
const PAD = 14
const CYCLE_DIP = 56

const lifetimeStyle = (lifetime: string) =>
  ({
    Singleton: { stroke: '#047857', fill: '#ecfdf5', dash: undefined },
    Scoped: { stroke: '#1d4ed8', fill: '#eff6ff', dash: undefined },
    Transient: { stroke: '#b45309', fill: '#fffbeb', dash: undefined },
  })[lifetime] ?? { stroke: '#64748b', fill: '#f8fafc', dash: '4 3' }

const edgeStyle: Record<EdgeKind, { stroke: string; width: number; dash?: string; label?: string; legend: string }> = {
  injected: { stroke: '#475569', width: 1.5, legend: 'constructor injection' },
  enumerable: { stroke: '#475569', width: 1.5, legend: 'IEnumerable<T> gets every registration' },
  new: { stroke: '#c2410c', width: 2.5, dash: '7 4', label: 'new()', legend: 'new(): hard-wired, not from DI' },
  cycle: { stroke: '#b91c1c', width: 3, dash: '7 4', label: 'cycle!', legend: 'cycle: points back up the chain' },
  captive: { stroke: '#b91c1c', width: 3, label: 'captive!', legend: 'captive: Singleton holds a Scoped service' },
  'creates-scope': { stroke: '#047857', width: 2, dash: '7 4', label: 'creates a scope', legend: 'resolved inside its own scope' },
}

type P = [number, number]
/** Point at t on a cubic Bézier curve. */
function bezier(t: number, a: P, b: P, c: P, d: P) {
  const u = 1 - t
  const f = (i: 0 | 1) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]
  return { x: f(0), y: f(1) }
}

function layout(graph: Graph) {
  // Roots: nodes nothing points to (ignoring cycle edges). Breadth-first from all of them.
  const targets = new Set(graph.edges.filter(e => e.kind !== 'cycle').map(e => e.to))
  const roots = graph.nodes.filter(n => !targets.has(n.id)).map(n => n.id)
  const depth = new Map<string, number>()
  const queue = roots.length ? roots : graph.nodes.slice(0, 1).map(n => n.id)
  queue.forEach(id => depth.set(id, 0))
  while (queue.length) {
    const from = queue.shift()!
    for (const e of graph.edges)
      if (e.from === from && e.kind !== 'cycle' && !depth.has(e.to)) {
        depth.set(e.to, depth.get(from)! + 1)
        queue.push(e.to)
      }
  }
  const columns: GraphNode[][] = []
  for (const n of graph.nodes) (columns[depth.get(n.id) ?? 0] ??= []).push(n)

  const pos = new Map<string, { x: number; y: number }>()
  columns.forEach((col, c) => col.forEach((n, r) => pos.set(n.id, { x: PAD + c * (NODE_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) })))
  const rows = Math.max(1, ...columns.map(c => c?.length ?? 0))
  const hasCycle = graph.edges.some(e => e.kind === 'cycle')
  return {
    pos,
    width: PAD * 2 + columns.length * (NODE_W + COL_GAP) - COL_GAP,
    height: PAD * 2 + rows * (NODE_H + ROW_GAP) - ROW_GAP + (hasCycle ? CYCLE_DIP + 16 : 0),
  }
}

function subtitle(n: GraphNode) {
  if (n.lifetime === 'All registrations') return 'every registered implementation'
  return n.service ? `${n.lifetime} · as ${n.service}` : n.lifetime
}

/** The service graph the container builds; arrows point from a service to what it depends on. */
export function DependencyGraph({ graph, title }: { graph: Graph; title: string }) {
  const { pos, width, height } = layout(graph)
  const label = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id
  const kinds = [...new Set(graph.edges.map(e => e.kind))]
  const lifetimes = [...new Set(graph.nodes.map(n => n.lifetime))]

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-semibold text-slate-700">{title}</figcaption>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[40rem]"
          style={{ maxWidth: width }}
          role="img"
          aria-label={`${title}. Arrows point from a service to what it depends on.`}
        >
          <defs>
            {Object.entries(edgeStyle).map(([kind, s]) => (
              <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill={s.stroke} />
              </marker>
            ))}
          </defs>

          {graph.edges.map((e, i) => {
            const a = pos.get(e.from)
            const b = pos.get(e.to)
            if (!a || !b) return null
            const s = edgeStyle[e.kind]
            let d: string
            let at: { x: number; y: number }
            if (b.x > a.x) {
              const [x1, y1, x2, y2] = [a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2]
              const dx = (x2 - x1) / 2
              d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
              at = bezier(0.72, [x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2]) // near the target: labels leaving one box don't collide
            } else {
              // backwards edge (a cycle): loop underneath the boxes
              const [x1, y1, x2, y2] = [a.x + NODE_W / 2, a.y + NODE_H, b.x + NODE_W / 2, b.y + NODE_H]
              const low = Math.max(y1, y2) + CYCLE_DIP
              d = `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}`
              const p = bezier(0.5, [x1, y1], [x1, low], [x2, low], [x2, y2])
              at = { x: p.x, y: p.y + 20 }
            }
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} markerEnd={`url(#arrow-${e.kind})`} />
                {s.label && (
                  <text x={at.x} y={at.y - 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={s.stroke} stroke="white" strokeWidth="4" paintOrder="stroke">
                    {s.label}
                  </text>
                )}
              </g>
            )
          })}

          {graph.nodes.map(n => {
            const p = pos.get(n.id)!
            const st = lifetimeStyle(n.lifetime)
            return (
              <g key={n.id}>
                <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx="8" fill={st.fill} stroke={st.stroke} strokeWidth="2" strokeDasharray={st.dash} />
                <text x={p.x + 10} y={p.y + 22} fontSize={n.label.length > 27 ? 11.5 : 13.5} fontWeight="700" fill="#0f172a">
                  {n.label}
                </text>
                <text x={p.x + 10} y={p.y + 41} fontSize="11.5" fill="#334155">
                  {subtitle(n)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <ul className="sr-only">
        {graph.edges.map((e, i) => (
          <li key={i}>
            {label(e.from)} depends on {label(e.to)} ({edgeStyle[e.kind].legend})
          </li>
        ))}
      </ul>

      <ul aria-hidden className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        {kinds.map(k => (
          <li key={k} className="flex items-center gap-1.5">
            <svg width="28" height="10">
              <line x1="0" y1="5" x2="28" y2="5" stroke={edgeStyle[k].stroke} strokeWidth={edgeStyle[k].width} strokeDasharray={edgeStyle[k].dash} />
            </svg>
            {edgeStyle[k].legend}
          </li>
        ))}
        {lifetimes.map(l => (
          <li key={l} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-5 rounded-sm border-2"
              style={{ borderColor: lifetimeStyle(l).stroke, background: lifetimeStyle(l).fill, borderStyle: lifetimeStyle(l).dash ? 'dashed' : 'solid' }}
            />
            {l}
          </li>
        ))}
      </ul>
    </figure>
  )
}
