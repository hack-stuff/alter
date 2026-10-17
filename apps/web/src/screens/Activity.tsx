import { useEffect, useRef, useState } from 'react'
import type { ActivityItem, Receipt, Member, Escalation, A2ATrace } from '../api/types'
import { byTime, externalUrl, localDayAndTime } from '../api/presentation'
import { AlterBadge } from '../components/AlterBadge'
import { TraceView } from '../components/TraceView'
import { AlterMark } from '../components/People'

function ReceiptDrawer({ receipt, close, members }: { receipt?: Receipt; close: () => void; members: Member[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close() } }, [])
  const name = members.find((m) => m.id === receipt?.actor.alter)?.name ?? 'Your'
  const url = externalUrl(receipt?.result.externalUrl)
  return <dialog ref={dialog} className="receipt-drawer" onCancel={close} aria-labelledby="receipt-title">
    <div className="drawer-head"><h2 id="receipt-title">Action receipt</h2><button className="drawer-close" onClick={close} autoFocus>Close receipt</button></div>
    {receipt ? <>
      <div className="receipt-actor"><AlterMark size="small" />{name} Alter <AlterBadge /> <span className="mono hint">{receipt.id}</span></div>
      <dl>
        <dt>Action</dt><dd>{receipt.action.replaceAll('_', ' ')}</dd>
        <dt>Sharing rule</dt><dd><span className={`policy-chip policy-${receipt.policy.outcome}`}>{receipt.policy.outcome}</span> {receipt.policy.rule}</dd>
        <dt>Approval</dt><dd>{receipt.approval ? `Approved by ${members.find((m) => m.id === receipt.approval?.by)?.name ?? 'the owner'}` : 'No approval recorded for this action'}</dd>
        <dt>Result</dt><dd>{receipt.result.ok ? <span className="verified">✓ Completed</span> : 'Not applied'}</dd>
        <dt>Time</dt><dd className="mono">{receipt.ts}</dd>
      </dl>
      <h3>Sources used</h3>{receipt.sourcesUsed.length ? <ul className="mono-list">{receipt.sourcesUsed.map((s) => <li key={`${s.id}-${s.locator}`}>{s.id} · {s.locator}</li>)}</ul> : <p>No sources recorded.</p>}
      {url && <a className="source-pill" href={url} target="_blank" rel="noreferrer">Open result ↗</a>}
    </> : <p className="empty">The receipt is not available yet.</p>}
  </dialog>
}

export function Activity({ items: allItems, receipts, members, escalations, traces, since }: { items: ActivityItem[]; receipts: Receipt[]; members: Member[]; escalations: Escalation[]; traces: A2ATrace[]; since?: string }) {
  const items = since ? allItems.filter((item) => item.ts >= since) : allItems
  const [selected, setSelected] = useState<string>()
  const answered = items.filter((i) => i.kind === 'answered').length
  const updated = items.filter((i) => ['doc_updated', 'doc_edit', 'doc_create'].includes(i.kind)).length
  const pending = escalations.filter((e) => e.state === 'pending').length
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const days: Record<string, ActivityItem[]> = {}
  for (const item of [...items].sort((a, b) => byTime(b, a))) (days[localDayAndTime(item.ts)[0]] ??= []).push(item)
  return <section className="screen">
    <header className="page-head"><h1>Work log</h1><p className="activity-summary">{answered} questions answered · {updated} docs updated · {pending} needs you</p></header>
    {Object.entries(days).map(([day, rows]) => <section className="timeline" key={day} aria-label={day}>
      <h2 className="timeline-day mono">{day}</h2>
      <ol>{rows?.map((item) => {
        const receipt = receipts.find((r) => r.id === item.receiptId)
        return <li key={item.id}>
          <button className="activity-row" onClick={() => setSelected(item.receiptId)}>
            <time className="mono">{localDayAndTime(item.ts)[1]}</time>
            <span className="timeline-node" aria-hidden="true"><AlterMark size="small" /></span>
            <span className="activity-text"><span>{item.summary} <AlterBadge /></span><small className="hint">{name(item.actor)}’s Alter · {item.kind.replaceAll('_', ' ')}</small></span>
            <span className={`receipt-badge${receipt?.result.ok ? ' is-verified' : ''}`}>{receipt?.result.ok ? '✓ Receipt' : 'Receipt'} · View receipt →</span>
          </button>
        </li>
      })}</ol>
    </section>)}
    {!items.length && <p className="empty">Your team's activity will appear here.</p>}
    {traces.length > 0 && <section className="trace-section"><h2>Alter-to-Alter requests</h2><div className="stack">{traces.map((trace) => <TraceView key={trace.id} trace={trace} />)}</div></section>}
    {selected && <ReceiptDrawer key={selected} receipt={receipts.find((r) => r.id === selected)} members={members} close={() => setSelected(undefined)} />}
  </section>
}
