import type { Workspace, InboxMessage, Member } from '../api/types'
import { externalUrl } from '../api/presentation'
import { AlterBadge } from '../components/AlterBadge'

export function Files({ workspace, inbox, members }: { workspace?: Workspace; inbox: InboxMessage[]; members: Member[] }) {
  const links = [
    { name: 'Drive folder', url: workspace?.google?.folderUrl },
    ...Object.entries(workspace?.google?.docs ?? {}).map(([name, url]) => ({ name: name.replace(/([A-Z])/g, ' $1'), url })),
    { name: 'Login revamp tracker', url: workspace?.google?.sheetUrl },
    { name: 'Team calendar', url: workspace?.google?.calendarUrl },
  ]
  return <section className="screen"><h2>Your workspace files</h2><p className="hint">The documents, tracker, and calendar your team works in.</p><div className="file-grid">{links.map((link) => {
    const url = externalUrl(link.url)
    return <article className="card" key={link.name}><h3 className="capitalize">{link.name}</h3>{url && !url.includes('/TODO') ? <a href={url} target="_blank" rel="noreferrer">Open file ↗</a> : <p className="hint">A file link is not available yet.</p>}</article>
  })}</div><h2 className="inbox-heading">Team inbox</h2>{inbox.map((mail) => <article className="card inbox-message" key={mail.id}><h3>{mail.subject}</h3><p className="hint">From {members.find((m) => m.id === mail.from)?.name ?? 'Your teammate'}'s Alter <AlterBadge /></p><p className="mail-body">{mail.body}</p>{externalUrl(mail.gmailMessageUrl) && <a href={externalUrl(mail.gmailMessageUrl)} target="_blank" rel="noreferrer">Open in Gmail ↗</a>}</article>)}{!inbox.length && <p className="empty">No team messages yet.</p>}</section>
}
