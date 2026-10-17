import type { Approval } from '../api/types'
import { ApprovalCard } from '../components/ApprovalCard'

export function Approvals({ approvals, onUpdate }: { approvals: Approval[]; onUpdate: (a: Approval) => void }) {
  const open = approvals.filter((a) => a.state === 'proposed')
  const done = approvals.filter((a) => a.state !== 'proposed')
  return <section className="screen">
    <header className="page-head"><h1>Waiting on you</h1><p className="hint">Your Alter applies doc, sheet and calendar changes directly; they’re listed here as a record. Emails wait here until you approve them, or say “send it”.</p></header>
    {approvals.length === 0 ? <p className="empty">No proposals to review yet.</p> : <div className="stack">
      {open.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}
      {done.length > 0 && <h2 className="stack-heading">Done</h2>}
      {done.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}
    </div>}
  </section>
}
