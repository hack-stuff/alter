import { useEffect, useRef, useState } from 'react'
import { planApi, type Plan } from '../api/plans'
import { httpCall, MOCK } from '../api/client'
import { AlterOrb } from '../components/AlterOrb'
import { OnScreenTips } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { ApprovalCard } from '../components/ApprovalCard'
import { externalUrl } from '../api/presentation'
import type { Member, Section } from '../api/types'

export function PlanCanvas({
  onBack,
  onApproveDoc,
}: {
  members: Member[]
  onBack: () => void
  onApproveDoc?: (summary: string) => void
}) {
  const [plan, setPlan] = useState<Plan>()
  const [selected, setSelected] = useState('onetap')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [changed, setChanged] = useState<string[]>([])
  const [voice, setVoice] = useState<
    'connecting' | 'listening' | 'speaking' | 'closed'
  >('closed')
  const [published, setPublished] = useState<{
    sections: Section[]
    refreshedAt: string
  }>()
  const canvas = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = plan?.nodes.find((item) => item.id === selected)
    const viewport = canvas.current
    if (node && viewport && viewport.clientWidth < 960)
      viewport.scrollTo({
        left: Math.max(0, node.x - viewport.clientWidth / 2 + 80),
        behavior: 'smooth',
      })
  }, [selected, plan])
  useEffect(() => {
    let stopped = false
    void planApi
      .get()
      .then((value) => {
        if (!stopped) setPlan(value)
      })
      .catch((e) => {
        if (!stopped) setError(e.message)
      })
    return () => {
      stopped = true
    }
  }, [])
  function receive(value: Plan) {
    const added = value.nodes.find(
      (item) => !plan?.nodes.some((old) => old.id === item.id),
    )
    if (added) setSelected(added.id)
    setChanged(
      value.nodes
        .filter(
          (n) =>
            JSON.stringify(n) !==
            JSON.stringify(plan?.nodes.find((old) => old.id === n.id)),
        )
        .map((n) => n.id),
    )
    setPlan(value)
    setPublished(undefined)
    setError('')
  }
  async function action(label: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The action could not finish. Your saved draft is available.',
      )
    } finally {
      setBusy('')
    }
  }
  const edit = (text: string) =>
    void action('Editing your saved design…', async () => {
      if (!plan || !text.trim()) return
      receive(await planApi.revise(plan.id, plan.revision, text.trim()))
      setInstruction('')
    })
  const node = plan?.nodes.find((n) => n.id === selected) ?? plan?.nodes[0]
  const height = Math.max(400, ...(plan?.nodes.map((n) => n.y + 150) ?? []))
  return (
    <section className="screen plan-canvas-screen fx stage-dark">
      <div className="fx-aurora" aria-hidden="true" />
      <header className="canvas-header">
        <button className="back-link-btn" onClick={onBack}>
          ← Back to your Alter
        </button>
        <div className="plan-title-block">
          <p className="eyebrow">
            Your saved design ·{' '}
            {plan ? `Revision ${plan.revision}` : 'Opening…'}
          </p>
          <h2>Login journey</h2>
          <p className="hint">
            Steer the visual draft by voice. Review before publishing its
            specification to Google Docs.
          </p>
        </div>
        <div className="canvas-header-actions">
          {plan && (
            <>
              <button
                disabled={!!busy || !plan.canUndo}
                onClick={() =>
                  void action('Restoring your previous design…', async () =>
                    receive(await planApi.undo(plan.id, plan.revision)),
                  )
                }
              >
                Undo last edit
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void action('Preparing your publication…', async () =>
                    setPlan(await planApi.prepare(plan.id, plan.revision)),
                  )
                }
              >
                Review publication
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button
            onClick={() =>
              void action('Reloading…', async () =>
                setPlan(await planApi.get()),
              )
            }
          >
            Reload saved design
          </button>
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {!plan && !error && <p role="status">Opening your saved design…</p>}
      {plan && (
        <>
          <OnScreenTips
            title="Steer this design"
            tips={[
              {
                type: 'say',
                text: 'Add a retry state if sign-in fails and connect it back to one-tap',
              },
              {
                type: 'say',
                text: "Include Meera's mock-up review checkpoint",
              },
              { type: 'say', text: 'Propose a session timeout of 30 minutes' },
            ]}
            onSelectPrompt={edit}
          />
          <div className="canvas-workspace-grid">
            <div className="diagram-viewport card">
              <div className="diagram-legend">
                <span>Private design draft · changes save automatically</span>
                <span className="legend-diff">Highlighted = last edit</span>
              </div>
              <div
                className="diagram-scroll"
                ref={canvas}
                role="region"
                aria-label="Login journey canvas"
              >
                <div
                  className="diagram-canvas"
                  style={{ height, minWidth: 960 }}
                >
                  <svg
                    className="diagram-svg"
                    viewBox={`0 0 960 ${height}`}
                    preserveAspectRatio="xMinYMin meet"
                    aria-label="Login journey connections"
                  >
                    <defs>
                      <marker
                        id="plan-arrow"
                        markerWidth="8"
                        markerHeight="6"
                        refX="7"
                        refY="3"
                        orient="auto"
                      >
                        <path d="M0 0 L8 3 L0 6" fill="#8fa2ff" />
                      </marker>
                    </defs>
                    {plan.nodes.flatMap((source) =>
                      source.connections.map((id) => {
                        const target = plan.nodes.find((n) => n.id === id)
                        if (!target) return null
                        const x = source.x + 160,
                          y = source.y + 40,
                          end = target.y + 40,
                          middle = (x + target.x) / 2
                        return (
                          <path
                            key={`${source.id}-${id}`}
                            d={`M${x} ${y} C${middle} ${y} ${middle} ${end} ${target.x} ${end}`}
                            fill="none"
                            stroke="#8fa2ff"
                            strokeWidth="2"
                            markerEnd="url(#plan-arrow)"
                          />
                        )
                      }),
                    )}
                  </svg>
                  <div className="diagram-nodes-layer">
                    {plan.nodes.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        style={{ left: item.x, top: item.y }}
                        className={`diagram-node-card node-cat-${item.category} ${selected === item.id ? 'node-selected' : ''} ${changed.includes(item.id) ? 'node-status-voice' : ''}`}
                        onClick={() => setSelected(item.id)}
                      >
                        <div className="node-card-top">
                          <span className="node-category-tag">
                            {item.category}
                          </span>
                          {changed.includes(item.id) && (
                            <span className="node-diff-badge">Changed</span>
                          )}
                        </div>
                        <strong className="node-title">{item.label}</strong>
                        <p className="node-desc">{item.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="canvas-voice-footer">
                <p className="voice-feedback" role="status">
                  {plan.explanation}
                </p>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    edit(instruction)
                  }}
                >
                  <label className="sr-only" htmlFor="design-edit">
                    Edit this design
                  </label>
                  <input
                    id="design-edit"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    disabled={!!busy}
                    placeholder="Describe the change…"
                  />
                  <button disabled={!!busy || !instruction.trim()}>
                    Apply edit
                  </button>
                </form>
                {!MOCK && (
                  <VoiceControl
                    mode="diagram"
                    targetId={plan.id}
                    autoStart
                    onState={setVoice}
                    onResult={(value) => receive(value as Plan)}
                  />
                )}
              </div>
            </div>
            <aside className="node-details-panel card">
              <p className="eyebrow">The selected design state</p>
              <h3>{node?.label}</h3>
              <p>{node?.description}</p>
              <p className="hint">
                This is a design proposal, not a change to running sign-in
                systems. Sources and rationale can be checked with your Alter.
              </p>
              <p className="hint">
                Saved {new Date(plan.updatedAt).toLocaleTimeString()} · version{' '}
                {plan.revision}
              </p>
            </aside>
          </div>
          {plan.approval && (
            <section aria-label="Review design publication">
              <ApprovalCard
                approval={plan.approval}
                allowRevision={false}
                voiceEnabled={false}
                onUpdate={(approval) => {
                  setPlan({ ...plan, approval })
                  if (approval.state === 'applied')
                    onApproveDoc?.('Design specification published')
                }}
              />
              {plan.approval.state === 'applied' && (
                <button
                  onClick={() =>
                    void action(
                      'Reading the published Google document…',
                      async () =>
                        setPublished(
                          await httpCall(
                            'GET',
                            `/artifacts/${plan.approval!.id}`,
                          ),
                        ),
                    )
                  }
                >
                  Read back published document
                </button>
              )}
              {published && (
                <article
                  className="card"
                  aria-label="Published document readback"
                >
                  <p className="eyebrow">
                    Provider readback ·{' '}
                    {new Date(published.refreshedAt).toLocaleTimeString()}
                  </p>
                  {published.sections.map((s, i) => (
                    <section key={i}>
                      <h3>{s.section}</h3>
                      {s.lines.map((line, j) => (
                        <p key={j}>{line}</p>
                      ))}
                    </section>
                  ))}
                  {externalUrl(plan.approval.externalUrl) && (
                    <a
                      href={externalUrl(plan.approval.externalUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Google document ↗
                    </a>
                  )}
                </article>
              )}
            </section>
          )}
        </>
      )}
      <AlterOrb
        state={
          busy
            ? 'working'
            : voice === 'speaking'
              ? 'speaking'
              : voice === 'listening'
                ? 'listening'
                : 'idle'
        }
        caption={
          busy || 'Your design stays saved. Publishing requires your review.'
        }
        onHome={onBack}
      />
    </section>
  )
}
