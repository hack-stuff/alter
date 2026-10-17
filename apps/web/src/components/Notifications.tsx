import { useState } from 'react'
import { httpCall, MOCK } from '../api/client'
import type { Notice } from '../api/meetings'
import { Icon } from './Icon'

export function Notifications({ items, onOpen }: { items: Notice[]; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const unread = items.filter((i) => !i.read).length
  return <div className="notifications">
    <button type="button" className="nav-item notice-toggle" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="nav-icon"><Icon name="bell" size={20} />{unread > 0 && <span className="count" aria-hidden="true">{unread}</span>}</span>
    </button>
    {open && <section className="notice-menu" aria-label="Your notifications">
      <div className="notice-head"><h3>Inbox</h3><button className="ghost icon-only" aria-label="Close notifications" onClick={() => setOpen(false)}><Icon name="close" size={16} /></button></div>
      {items.length ? [...items].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 15).map((item) => <button className={`notice-row ${item.read ? '' : 'unread'}`} key={item.id} onClick={() => { if (!MOCK) void httpCall('POST', `/notifications/${item.id}/read`).catch(() => {}); onOpen(item.path); setOpen(false) }}>
        <strong>{item.title}</strong><span>{item.body}</span><small className="mono">{new Date(item.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small>
      </button>) : <p className="empty">Important updates will find you here.</p>}
    </section>}
  </div>
}
