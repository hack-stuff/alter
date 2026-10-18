import type { Approval } from '../api/types'
import { ApprovalCard } from '../components/ApprovalCard'

export function Approvals({ approvals, onUpdate }: { approvals: Approval[]; onUpdate: (a: Approval) => void }) {
  const open = approvals.filter((a) => a.state === 'proposed')
  return <section className="screen">
    <header className="page-head"><h1>Waiting on you</h1><p className="hint">Review draft emails and any changes that need your decision.</p></header>
    {open.length === 0 ? <p className="empty">Nothing needs your approval right now.</p> : <div className="stack">
      {open.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}
    </div>}
  </section>
}
