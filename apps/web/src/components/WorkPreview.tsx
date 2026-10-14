import type { Approval, Section, Diff } from '../api/types'

function Content({ sections, diffs }: { sections: Section[]; diffs: Diff[] }) {
  return <>{sections.map((section, index) => <section key={index}><h4>{section.section}</h4>{section.lines.map((line, i) => {
    const diff = diffs.find((d) => d.section === section.section && d.line === line && d.op !== 'remove')
    return <p key={i} className={diff ? 'diff-line' : undefined}>{diff && <span className="diff-label">{diff.op === 'add' ? 'Added' : 'Changed'}</span>}{line}</p>
  })}</section>)}</>
}
export function WorkPreview({ approval }: { approval: Approval }) {
  const { before, after, diffs } = approval.preview
  return <div className={`work-preview preview-${approval.kind}`}>
    {before && <details><summary>Before this change</summary><Content sections={before} diffs={[]} /></details>}
    <div aria-label="Proposed content">
      {approval.kind === 'sheet_update' ? <div className="table-scroll"><table><caption>Proposed tracker rows</caption><tbody>{after.flatMap((section, i) => section.lines.map((line, j) => <tr key={`${i}-${j}`} className={diffs.some((d) => d.line === line && d.op !== 'remove') ? 'diff-line' : undefined}>{line.split('|').map((cell, k) => <td key={k}>{cell.trim()}</td>)}</tr>))}</tbody></table></div>
        : <Content sections={after} diffs={diffs} />}
    </div>
    {diffs.filter((d) => d.op === 'remove').map((d, i) => <p className="removed-line" key={i}><span className="diff-label">Removed</span><del>{d.line}</del></p>)}
  </div>
}
