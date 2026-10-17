import type { Approval } from '../api/types'
import { ApprovalCard } from '../components/ApprovalCard'

export function Approvals({ approvals, onUpdate }: { approvals: Approval[]; onUpdate: (a: Approval) => void }) {
  const open = approvals.filter((a) => a.state === 'proposed')
  const done = approvals.filter((a) => a.state !== 'proposed')
  return <section className="screen">
    <header className="page-head"><h1>Waiting on you</h1><p className="hint">Emails wait here for your approval. Doc, sheet and calendar changes are listed as a record.</p></header>
    {approvals.length === 0 ? <p className="empty">No proposals to review yet.</p> : <div className="stack">
      {open.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}
      {done.length > 0 && <h2 className="stack-heading">Done</h2>}
      {done.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}
    </div>}
  </section>
}
