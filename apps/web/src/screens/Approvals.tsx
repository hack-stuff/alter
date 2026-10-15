import type { Approval } from '../api/types'
import { ApprovalCard } from '../components/ApprovalCard'

export function Approvals({ approvals, onUpdate }: { approvals: Approval[]; onUpdate: (a: Approval) => void }) {
  return <section className="screen"><h2>Waiting on you</h2><p className="hint">Your Alter prepared these. Check the preview and sources, then let it act.</p>
    {approvals.length === 0 ? <p className="empty">No proposals to review yet.</p> : <div className="card-list">{approvals.map((a) => <ApprovalCard key={a.id} approval={a} onUpdate={onUpdate} />)}</div>}
  </section>
}
