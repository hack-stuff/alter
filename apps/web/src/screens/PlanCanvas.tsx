import { useEffect, useRef, useState } from 'react'
import { planApi, type DiagramNode, type Plan } from '../api/plans'
import { httpCall } from '../api/client'
import { planUpdates } from '../agent/navigator'
import { OnScreenTips } from '../components/OnScreenTips'
import { ApprovalCard } from '../components/ApprovalCard'
import { AppIcon } from '../components/AppIcon'
import { Icon } from '../components/Icon'
import { externalUrl } from '../api/presentation'
import type { Member, Section } from '../api/types'

/** A small sketch of what each kind of step looks like. */
function Wireframe({ category, large = false }: { category: DiagramNode['category']; large?: boolean }) {
  return <svg className={`wireframe wire-${category}${large ? ' is-large' : ''}`} viewBox="0 0 64 44" aria-hidden="true">
    {category === 'ui' && <><rect x="20" y="2" width="24" height="40" rx="4" /><path d="M25 10h14M25 15h10" /><rect x="24" y="28" width="16" height="6" rx="3" className="fill" /></>}
    {category === 'backend' && <><rect x="14" y="6" width="36" height="9" rx="2" /><rect x="14" y="18" width="36" height="9" rx="2" /><rect x="14" y="30" width="36" height="9" rx="2" /><path d="M19 10.5h2M19 22.5h2M19 34.5h2" /></>}
    {category === 'decision' && <><path d="M32 4 52 22 32 40 12 22Z" /><path d="M28 22h8" /></>}
    {category === 'fallback' && <><rect x="20" y="2" width="24" height="40" rx="4" /><path d="M32 12 39 25H25Z" /><path d="M32 17v4" /><rect x="24" y="30" width="16" height="5" rx="2.5" className="fill" /></>}
    {category === 'review' && <><rect x="16" y="4" width="32" height="36" rx="3" /><path d="m21 13 2 2 4-4M30 13h12M21 23l2 2 4-4M30 23h12M21 33h6M30 33h12" /></>}
  </svg>
}

export function PlanCanvas({
  onBack,
  onApproveDoc,
}: {
  members: Member[]
  /** The canvas stays mounted while hidden so opening it is instant. */
  active?: boolean
  onBack: () => void
  onApproveDoc?: (summary: string) => void
}) {
  const [plan, setPlan] = useState<Plan>()
  const [selected, setSelected] = useState('onetap')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [changed, setChanged] = useState<string[]>([])
  const [added, setAdded] = useState<string[]>([])
  const [source, setSource] = useState<'voice' | 'text' | 'undo'>()
  const [outline, setOutline] = useState(false)
  const [published, setPublished] = useState<{
    sections: Section[]
    refreshedAt: string
  }>()
  const canvas = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = plan?.nodes.find((item) => item.id === selected)
    const viewport = canvas.current
    if (node && viewport && viewport.clientWidth < 960)
      viewport.scrollTo({ left: Math.max(0, node.x - viewport.clientWidth / 2 + 80), behavior: 'smooth' })
  }, [selected, plan])
  useEffect(() => {
    let stopped = false
    void planApi.get().then((value) => { if (!stopped) setPlan(value) }).catch((e) => { if (!stopped) setError(e.message) })
    return () => { stopped = true }
  }, [])
  // Revisions made by the voice Alter from any screen arrive here.
  const receiveRef = useRef<(value: Plan, from: 'voice' | 'text' | 'undo') => void>(() => {})
  useEffect(() => planUpdates.subscribe((value) => receiveRef.current(value, 'voice')), [])
  function receive(value: Plan, from: 'voice' | 'text' | 'undo') {
    const fresh = value.nodes.filter((item) => !plan?.nodes.some((old) => old.id === item.id)).map((n) => n.id)
    if (fresh[0]) setSelected(fresh[0])
    setAdded(fresh)
    setChanged(value.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(plan?.nodes.find((old) => old.id === n.id))).map((n) => n.id))
    setSource(from)
    setPlan(value)
    setPublished(undefined)
    setError('')
  }
  async function action(label: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError('')
    try { await fn() }
    catch (e) { setError(e instanceof Error ? e.message : 'The action could not finish. Your saved draft is available.') }
    finally { setBusy('') }
  }
  const edit = (text: string) =>
    void action('Editing your saved design…', async () => {
      if (!plan || !text.trim()) return
      receive(await planApi.revise(plan.id, plan.revision, text.trim()), 'text')
      setInstruction('')
    })
  useEffect(() => { receiveRef.current = receive })
  const node = plan?.nodes.find((n) => n.id === selected) ?? plan?.nodes[0]
  const height = Math.max(400, ...(plan?.nodes.map((n) => n.y + 150) ?? []))
  const badge = (id: string) => added.includes(id) ? (source === 'voice' ? '✦ Added by voice' : '✦ Added') : source === 'voice' ? '✦ Changed by voice' : '✦ Changed'
  const labelOf = (id: string) => plan?.nodes.find((n) => n.id === id)?.label ?? id
  return (
    <section className="screen canvas-screen">
      <header className="canvas-toolbar">
        <div className="canvas-title">
          <button type="button" className="ghost icon-only" aria-label="Back to your Alter" onClick={onBack}><Icon name="back" size={18} /></button>
          <div>
            <h1>Login journey</h1>
            <p className="eyebrow">Your saved design · {plan ? `Revision ${plan.revision}` : 'Opening…'}</p>
          </div>
        </div>
        {plan && <div className="canvas-actions">
          <span className="rev-pill mono" title="Current saved revision">rev {plan.revision}</span>
          <span className="hint mono">saved {new Date(plan.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button disabled={!!busy || !plan.canUndo} onClick={() => void action('Restoring your previous design…', async () => receive(await planApi.undo(plan.id, plan.revision), 'undo'))}><Icon name="undo" size={16} />Undo last edit</button>
          <button aria-pressed={outline} onClick={() => setOutline(!outline)}><Icon name="list" size={16} />Outline</button>
          <button className="primary" disabled={!!busy} onClick={() => void action('Preparing your publication…', async () => setPlan(await planApi.prepare(plan.id, plan.revision)))}><AppIcon app="docs" />Review publication</button>
        </div>}
      </header>
      {error && <div role="alert" className="notice is-error"><p>{error}</p><button onClick={() => void action('Reloading…', async () => setPlan(await planApi.get()))}>Reload saved design</button></div>}
      {busy && <p role="status" className="thinking"><span className="alter-glyph" aria-hidden="true">✦</span>{busy}</p>}
      {!plan && !error && <p role="status" className="hint">Opening your saved design…</p>}
      {plan && <>
        {plan.explanation && <p className={`change-strip${changed.length ? ' is-fresh' : ''}`} role="status"><span className="alter-glyph" aria-hidden="true">✦</span>{plan.explanation}</p>}
        <div className="canvas-grid">
          <div className="sheet diagram-sheet">
            {outline ? <ol className="diagram-outline" aria-label="Login journey outline">
              {plan.nodes.map((item) => <li key={item.id} className={changed.includes(item.id) ? 'is-changed' : undefined}>
                <button type="button" className="ghost" aria-current={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.label}</strong> <span className="node-category-tag">{item.category}</span>{changed.includes(item.id) && <span className="node-diff-badge">{badge(item.id)}</span>}</button>
                <p>{item.description}</p>
                {item.connections.length > 0 && <p className="hint">Leads to: {item.connections.map(labelOf).join(', ')}</p>}
              </li>)}
            </ol> : <div className="diagram-scroll" ref={canvas} role="region" aria-label="Login journey canvas">
              <div className="diagram-canvas" style={{ height, minWidth: 960 }}>
                <svg className="diagram-svg" viewBox={`0 0 960 ${height}`} preserveAspectRatio="xMinYMin meet" aria-label="Login journey connections">
                  <defs><marker id="plan-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" className="arrow-head" /></marker></defs>
                  {plan.nodes.flatMap((from) => from.connections.map((id) => {
                    const target = plan.nodes.find((n) => n.id === id)
                    if (!target) return null
                    const x = from.x + 160, y = from.y + 40, end = target.y + 40, middle = (x + target.x) / 2
                    return <path key={`${from.id}-${id}`} className={changed.includes(id) || changed.includes(from.id) ? 'edge is-changed' : 'edge'} d={`M${x} ${y} C${middle} ${y} ${middle} ${end} ${target.x} ${end}`} markerEnd="url(#plan-arrow)" />
                  }))}
                </svg>
                <div className="diagram-nodes-layer">
                  {plan.nodes.map((item) => <button type="button" key={item.id} style={{ left: item.x, top: item.y }} data-nav-id={item.id} data-nav-label={`${item.label} ${item.category}`}
                    className={`diagram-node node-cat-${item.category}${selected === item.id ? ' is-selected' : ''}${changed.includes(item.id) ? ' is-changed' : ''}`}
                    aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} onFocus={() => setSelected(item.id)}>
                    <span className="node-top"><span className="node-category-tag">{item.category}</span>{changed.includes(item.id) && <span className="node-diff-badge">{badge(item.id)}</span>}</span>
                    <Wireframe category={item.category} />
                    <strong className="node-title">{item.label}</strong>
                  </button>)}
                </div>
              </div>
            </div>}
            <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); edit(instruction) }}>
              <label className="sr-only" htmlFor="design-edit">Edit this design</label>
              <input id="design-edit" value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={!!busy} placeholder="Describe the change, or say it…" />
              <button disabled={!!busy || !instruction.trim()}>Apply edit</button>
            </form>
            <OnScreenTips title="Steer this design" tips={[
              { type: 'say', text: 'Add a retry state if sign-in fails and connect it back to one-tap' },
              { type: 'say', text: "Include Kani's mock-up review checkpoint" },
              { type: 'say', text: 'Propose a session timeout of 30 minutes' },
            ]} onSelectPrompt={edit} />
          </div>
          <aside className="sheet node-preview" aria-label="Selected screen">
            <p className="eyebrow">Selected · {node?.category}</p>
            {node && <div className={`preview-frame${changed.includes(node.id) ? ' is-changed' : ''}`}><Wireframe category={node.category} large /></div>}
            <h3>{node?.label}</h3>
            <p>{node?.description}</p>
            {node && node.connections.length > 0 && <p className="hint">Leads to {node.connections.map(labelOf).join(', ')}</p>}
            <p className="hint">This is a design proposal, not a change to running sign-in systems.</p>
          </aside>
        </div>
        {plan.approval && <section className="publication" aria-label="Review design publication">
          <div className="publication-grid">
            <div className="sheet publication-source"><p className="eyebrow">Diagram · revision {plan.revision}</p><ol className="spec-outline">{plan.nodes.map((n) => <li key={n.id}><strong>{n.label}</strong> <span className="hint">{n.category}</span></li>)}</ol></div>
            <ApprovalCard approval={plan.approval} allowRevision={false} voiceEnabled={false} onUpdate={(approval) => { setPlan({ ...plan, approval }); if (approval.state === 'applied') onApproveDoc?.('Design specification published') }} />
          </div>
          {plan.approval.state === 'applied' && <button onClick={() => void action('Reading the published Google document…', async () => setPublished(await httpCall('GET', `/artifacts/${plan.approval!.id}`)))}><AppIcon app="docs" />Read back published document</button>}
          {published && <article className="sheet mini-page" aria-label="Published document readback">
            <p className="eyebrow"><span className="verified">✓ Provider readback</span> · <span className="mono">{new Date(published.refreshedAt).toLocaleTimeString()}</span></p>
            {published.sections.map((s, i) => <section key={i}><h3>{s.section}</h3>{s.lines.map((line, j) => <p key={j}>{line}</p>)}</section>)}
            {externalUrl(plan.approval.externalUrl) && <a className="source-pill" href={externalUrl(plan.approval.externalUrl)} target="_blank" rel="noreferrer"><AppIcon app="docs" />Open Google document ↗</a>}
          </article>}
        </section>}
      </>}
    </section>
  )
}
