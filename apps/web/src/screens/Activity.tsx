import { useEffect, useRef, useState } from 'react'
import type { ActivityItem, Receipt, Member, Escalation, A2ATrace } from '../api/types'
import { externalUrl } from '../api/presentation'
import { AlterBadge } from '../components/AlterBadge'
import { TraceView } from '../components/TraceView'

function ReceiptDrawer({ receipt, close, members }: { receipt?: Receipt; close: () => void; members: Member[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close() } }, [])
  const name = members.find((m) => m.id === receipt?.actor.alter)?.name ?? 'Your'
  const url = externalUrl(receipt?.result.externalUrl)
  return <dialog ref={dialog} className="receipt-drawer" onCancel={close} aria-labelledby="receipt-title"><button className="drawer-close" onClick={close} autoFocus>Close receipt</button><h2 id="receipt-title">Action receipt</h2>
    {receipt ? <><p>{name} Alter <AlterBadge /></p><dl><dt>Action</dt><dd>{receipt.action.replaceAll('_', ' ')}</dd><dt>Sharing rule</dt><dd>{receipt.policy.rule} · {receipt.policy.outcome}</dd><dt>Approval</dt><dd>{receipt.approval ? `Approved by ${members.find((m) => m.id === receipt.approval?.by)?.name ?? 'the owner'}` : 'No approval recorded for this action'}</dd><dt>Result</dt><dd>{receipt.result.ok ? 'Completed' : 'Not applied'}</dd></dl><h3>Sources used</h3>{receipt.sourcesUsed.length ? <ul>{receipt.sourcesUsed.map((s) => <li key={`${s.id}-${s.locator}`}>{s.id} · {s.locator}</li>)}</ul> : <p>No sources recorded.</p>}{url && <a href={url} target="_blank" rel="noreferrer">Open result ↗</a>}</> : <p className="empty">The receipt is not available yet.</p>}
  </dialog>
}
export function Activity({ items, receipts, members, escalations, traces }: { items: ActivityItem[]; receipts: Receipt[]; members: Member[]; escalations: Escalation[]; traces: A2ATrace[] }) {
  const [selected, setSelected] = useState<string>()
  const answered = items.filter((i) => i.kind === 'answered').length
  const updated = items.filter((i) => ['doc_updated', 'doc_edit', 'doc_create'].includes(i.kind)).length
  const pending = escalations.filter((e) => e.state === 'pending').length
  const days: Record<string, ActivityItem[]> = {}
  for (const item of [...items].sort((a, b) => b.ts.localeCompare(a.ts))) (days[item.ts.slice(0, 10)] ??= []).push(item)
  return <section className="screen"><h2>While you were away</h2><p className="activity-summary">{answered} questions answered · {updated} docs updated · {pending} needs you</p>
    {Object.entries(days).map(([day, rows]) => <section className="activity-group" key={day}><h3>{day}</h3>{rows?.map((item) => <button className="activity-row" key={item.id} onClick={() => setSelected(item.receiptId)}><span>{item.summary} <AlterBadge /></span><span className="hint">{item.ts.slice(11, 16)} · View receipt →</span></button>)}</section>)}
    {!items.length && <p className="empty">Your team's activity will appear here.</p>}
    {traces.length > 0 && <section><h3>Alter collaboration</h3>{traces.map((trace) => <TraceView key={trace.id} trace={trace} />)}</section>}
    {selected && <ReceiptDrawer key={selected} receipt={receipts.find((r) => r.id === selected)} members={members} close={() => setSelected(undefined)} />}
  </section>
}
