import type { A2ATrace } from '../api/types'
import { AlterBadge } from './AlterBadge'
import { Citations } from './Citations'
import { AlterMark } from './People'

const names: Record<string, string> = { rahul: 'Rahul', priya: 'Priya', meera: 'Meera', arjun: 'Arjun' }

export function TraceView({ trace }: { trace: A2ATrace }) {
  const from = names[trace.from] ?? 'Your'
  const to = names[trace.to] ?? 'your teammate'
  return <details className="trace-view" open>
    <summary>How {names[trace.to] ?? 'your teammate'}’s Alter <AlterBadge /> handled this</summary>
    <p className="a2a-route" aria-label={`${from}'s Alter asked ${to}'s Alter`}><AlterMark size="small" /><span>{from}’s Alter</span><span className="a2a-arrow" aria-hidden="true">→</span><AlterMark size="small" /><span>{to}’s Alter</span><span className="mono hint">{trace.id}</span></p>
    <ol className="trace-steps">{trace.steps.map((step, i) => <li key={i} style={{ animationDelay: `${i * 90}ms` }}>{step}</li>)}</ol>
    <div className="policy-row">{trace.policyChecks.map((check) => <p key={check.rule} className={`outcome outcome-${check.outcome}`}><span className={`policy-chip policy-${check.outcome}`}>{check.outcome}</span>{check.label} · {check.outcome === 'allow' ? 'Allowed' : check.outcome === 'ask' ? 'Owner asked' : 'Not shared'}</p>)}</div>
    <Citations sources={trace.sources} />
  </details>
}
