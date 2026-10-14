import { useState } from 'react'
import { api } from '../api/client'
import type { Memory, Rule, Member, Outcome } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'

export function Settings({ memories, rules, me, onRefresh }: { memories: Memory[]; rules: Rule[]; me?: Member; onRefresh: () => void }) {
  const [content, setContent] = useState('')
  const [editedEmail, setEmail] = useState<string | undefined>(undefined)
  const email = editedEmail ?? me?.email ?? ''
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function save(id: string, action: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(id); setError(''); setMessage('')
    try { await action(); setMessage(success); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.') }
    finally { setBusy('') }
  }
  return <section className="screen"><h2>Your Alter <AlterBadge /> · Settings</h2><div className="settings-layout">
    <section className="card"><h3>What it knows</h3><p className="hint">Starter notes and approved memories. Teaching creates a proposal for you to review.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (content.trim()) void save('teach', async () => { await api.teach(content.trim()); setContent('') }, 'Memory proposed. Review it below.') }}><label>Teach your Alter something<textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={!!busy} /></label><button disabled={!!busy || !content.trim()}>Teach</button></form>
      {memories.map((m) => <article className="memory" key={m.id}><span className="eyebrow">{m.source} · {m.state}</span><p>{m.content}</p><div className="actions">{m.state !== 'approved' && <button disabled={!!busy} onClick={() => void save(m.id, () => api.decideMemory(m.id, 'approve'), 'Memory approved.')}>Approve memory</button>}{m.state !== 'revoked' && <button disabled={!!busy} onClick={() => void save(m.id, () => api.decideMemory(m.id, 'revoke'), 'Memory revoked.')}>Revoke memory</button>}</div></article>)}
      {!memories.length && <p className="empty">No memories yet.</p>}
    </section>
    <section className="card"><h3>What it may do</h3><p className="hint">Allow a request, ask you first, or keep it private.</p>{rules.map((rule) => <fieldset className="rule" key={rule.id} disabled={!!busy}><legend>{rule.label}</legend><div className="segmented">{(['allow', 'ask', 'deny'] as Outcome[]).map((mode) => <button type="button" key={mode} aria-pressed={rule.mode === mode} onClick={() => void save(rule.id, () => api.setRule(rule.id, mode), 'Sharing rule saved.')}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></fieldset>)}
      <h3>Organization rules</h3><p className="locked-rule">🔒 External email: denied by organization</p><p className="locked-rule">🔒 Calendar attendees: workspace members only</p><p className="locked-rule">🔒 File changes: workspace folder only</p>
    </section>
    <section className="card"><h3>Personal preferences</h3><form onSubmit={(e) => { e.preventDefault(); void save('email', () => api.updateMe({ email: email.trim() }), 'Email preference saved.') }}><label>Email me copies<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!busy} placeholder="Optional email address" /></label><button disabled={!!busy}>Save email</button></form><button disabled={!!busy} onClick={() => void save('status', () => api.updateMe({ status: me?.status === 'away' ? 'available' : 'away' }), 'Availability saved.')}>{me?.status === 'away' ? 'Set available' : 'Set away'}</button></section>
  </div>{error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}</section>
}
