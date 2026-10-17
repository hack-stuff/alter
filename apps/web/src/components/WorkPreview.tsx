import type { Approval, Section, Diff } from '../api/types'

// Diffs, not explanations: a before → after strip in a mini page.
function Content({ sections, diffs }: { sections: Section[]; diffs: Diff[] }) {
  return <>{sections.map((section, index) => <section key={index}><h4>{section.section}</h4>{section.lines.filter((line) => line.trim()).map((line, i) => {
    const diff = diffs.find((d) => d.section === section.section && d.line === line && d.op !== 'remove')
    return <p key={i} className={diff ? 'diff-line' : undefined}>{diff && <span className="diff-label">{diff.op === 'add' ? 'Added' : 'Changed'}</span>}{line}</p>
  })}</section>)}</>
}

function Removed({ diffs }: { diffs: Diff[] }) {
  return <>{diffs.filter((d) => d.op === 'remove').map((d, i) => <p className="removed-line" key={i}><span className="diff-label">Removed</span><del>{d.line}</del></p>)}</>
}

function Slot({ sections, kind }: { sections: Section[]; kind: 'before' | 'after' }) {
  return <div className={`calendar-slot is-${kind}`}>
    <span className="eyebrow">{kind === 'before' ? 'Was' : 'Proposed'}</span>
    {sections.map((section, i) => <div key={i}><strong>{section.section}</strong>{section.lines.map((line, j) => <p key={j}>{line}</p>)}</div>)}
  </div>
}

export function WorkPreview({ approval }: { approval: Approval }) {
  const { before, after, diffs } = approval.preview
  if (approval.kind === 'calendar_event') return <div className="work-preview preview-calendar_event">
    <div className="slot-strip">
      {before?.length ? <><Slot sections={before} kind="before" /><span className="slot-arrow" aria-hidden="true">→</span></> : null}
      <div aria-label="Proposed content"><Slot sections={after} kind="after" /></div>
    </div>
  </div>
  if (approval.kind === 'email') return <div className="work-preview preview-email">
    <div className="mail-draft" aria-label="Proposed content"><Content sections={after} diffs={diffs} /></div>
  </div>
  return <div className={`work-preview preview-${approval.kind}`}>
    {before?.length ? <details className="before-page"><summary>Before this change</summary><div className="mini-page is-before"><Content sections={before} diffs={[]} /></div></details> : null}
    <div className="mini-page" aria-label="Proposed content">
      {approval.kind === 'sheet_update' ? <div className="table-scroll"><table><caption>Proposed tracker rows</caption><tbody>{after.flatMap((section, i) => section.lines.map((line, j) => <tr key={`${i}-${j}`} className={diffs.some((d) => d.line === line && d.op !== 'remove') ? 'diff-line' : undefined}>{line.split('|').map((cell, k) => <td key={k}>{cell.trim()}</td>)}</tr>))}</tbody></table></div>
        : <Content sections={after} diffs={diffs} />}
      <Removed diffs={diffs} />
    </div>
  </div>
}
