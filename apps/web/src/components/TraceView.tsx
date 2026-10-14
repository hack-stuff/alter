import type { A2ATrace } from '../api/types'
import { AlterBadge } from './AlterBadge'
import { Citations } from './Citations'

const names: Record<string, string> = { rahul: 'Rahul', priya: 'Priya', meera: 'Meera', arjun: 'Arjun' }

export function TraceView({ trace }: { trace: A2ATrace }) {
  return <details className="trace-view"><summary>How {names[trace.to] ?? 'your teammate'}’s Alter <AlterBadge /> handled this</summary>
    <ol>{trace.steps.map((step, i) => <li key={i} style={{ animationDelay: `${i * 90}ms` }}>{step}</li>)}</ol>
    {trace.policyChecks.map((check) => <p key={check.rule} className={`outcome outcome-${check.outcome}`}>{check.label} · {check.outcome === 'allow' ? 'Allowed' : check.outcome === 'ask' ? 'Owner asked' : 'Not shared'}</p>)}
    <Citations sources={trace.sources} />
  </details>
}
