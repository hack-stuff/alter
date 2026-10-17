import type { Workspace, InboxMessage, Member } from '../api/types'
import { externalUrl } from '../api/presentation'
import { AlterBadge } from '../components/AlterBadge'
import { AppIcon, type GoogleApp } from '../components/AppIcon'
import { AlterMark } from '../components/People'

const groups: { app: GoogleApp; title: string }[] = [
  { app: 'docs', title: 'Docs' }, { app: 'sheets', title: 'Sheets' }, { app: 'calendar', title: 'Calendar' }, { app: 'drive', title: 'Drive' },
]

export function Files({ workspace, inbox, members }: { workspace?: Workspace; inbox: InboxMessage[]; members: Member[] }) {
  const links: { app: GoogleApp; name: string; url?: string }[] = [
    ...Object.entries(workspace?.google?.docs ?? {}).map(([name, url]) => ({ app: 'docs' as const, name: name.replace(/([A-Z])/g, ' $1'), url })),
    { app: 'sheets', name: 'Login revamp tracker', url: workspace?.google?.sheetUrl },
    { app: 'calendar', name: 'Team calendar', url: workspace?.google?.calendarUrl },
    { app: 'drive', name: 'Drive folder', url: workspace?.google?.folderUrl },
  ]
  return <section className="screen">
    <header className="page-head"><h1>Files &amp; inbox</h1><p className="hint">The documents, tracker and calendar your team works in, and messages from teammates’ Alters.</p></header>
    <div className="files-layout">
      <div className="stack">{groups.map((group) => {
        const files = links.filter((link) => link.app === group.app)
        if (!files.length) return null
        return <section className="sheet file-group" key={group.app} aria-label={group.title} tabIndex={-1} data-nav-id={group.app} data-nav-label={group.title}>
          <h2><AppIcon app={group.app} size={20} />{group.title}<span className="count-pill">{files.length}</span></h2>
          <ul>{files.map((link) => {
            const url = externalUrl(link.url)
            return <li key={link.name} className="file-row"><AppIcon app={link.app} /><span className="capitalize">{link.name}</span>{url && !url.includes('/TODO') ? <a href={url} target="_blank" rel="noreferrer">Open file ↗</a> : <span className="hint">A file link is not available yet.</span>}</li>
          })}</ul>
        </section>
      })}</div>
      <section className="sheet inbox" aria-label="Team inbox" tabIndex={-1} data-nav-id="inbox" data-nav-label="inbox email">
        <h2><AppIcon app="gmail" size={20} />Team inbox{inbox.length > 0 && <span className="count-pill">{inbox.length}</span>}</h2>
        {inbox.map((mail) => <article className="inbox-message" key={mail.id}>
          <h3>{mail.subject}</h3>
          <p className="hint from-line"><AlterMark size="small" />From {members.find((m) => m.id === mail.from)?.name ?? 'Your teammate'}'s Alter <AlterBadge /> · <span className="mono">{new Date(mail.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></p>
          <p className="mail-body">{mail.body}</p>
          {externalUrl(mail.gmailMessageUrl) && <a className="source-pill" href={externalUrl(mail.gmailMessageUrl)} target="_blank" rel="noreferrer"><AppIcon app="gmail" />Open in Gmail ↗</a>}
        </article>)}
        {!inbox.length && <p className="empty">No team messages yet.</p>}
      </section>
    </div>
  </section>
}
