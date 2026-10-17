import { useState } from 'react'
import { api } from '../api/client'
import type { Memory, Rule, Member, Outcome } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { MemoryEditor } from '../components/MemoryEditor'
import { SourceSettings } from '../components/SourceSettings'
import { Icon } from '../components/Icon'

const MODES: { mode: Outcome; label: string }[] = [{ mode: 'allow', label: 'Allow' }, { mode: 'ask', label: 'Ask' }, { mode: 'deny', label: 'Deny' }]

export function Settings({ memories, rules, me, onRefresh }: { memories: Memory[]; rules: Rule[]; me?: Member; onRefresh: () => void }) {
  const [content, setContent] = useState('')
  const [audience, setAudience] = useState<'owner' | 'team'>('owner')
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
  return <section className="screen">
    <header className="page-head"><h1>Rules &amp; memory</h1><p className="hint">What your Alter <AlterBadge /> may share, with whom, and what it remembers.</p></header>
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    <div className="settings-layout">
      <section className="sheet">
        <h2>What it may do</h2><p className="hint">Allow a request, ask you first, or keep it private.</p>
        <ul className="rule-list">{rules.map((rule) => <li key={rule.id}><fieldset className="rule" disabled={!!busy}>
          <legend>{rule.label}</legend>
          <div className="segmented">{MODES.map(({ mode, label }) => <button type="button" key={mode} className={`seg-${mode}`} aria-pressed={rule.mode === mode} onClick={() => void save(rule.id, () => api.setRule(rule.id, mode), 'Sharing rule saved.')}>{label}</button>)}</div>
        </fieldset></li>)}</ul>
        <h3>Organization rules</h3>
        <ul className="locked-rules"><li className="locked-rule"><Icon name="lock" size={14} />External email: denied by organization</li><li className="locked-rule"><Icon name="lock" size={14} />Calendar invites: team members only</li><li className="locked-rule"><Icon name="lock" size={14} />File changes: team folder only</li></ul>
      </section>
      <section className="sheet">
        <h2>What it knows</h2><p className="hint">Starter notes and approved memories. Teaching creates a proposal for you to review.</p>
        <form className="teach-form" onSubmit={(e) => { e.preventDefault(); if (content.trim()) void save('teach', async () => { await api.teach(content.trim(), audience); setContent('') }, 'Memory proposed. Review it below.') }}>
          <label>Teach your Alter something<textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={!!busy} /></label>
          <label>Use new guidance<select value={audience} onChange={(e) => setAudience(e.target.value as 'owner' | 'team')}><option value="owner">Only for my own work</option><option value="team">For permitted team requests too</option></select></label>
          <button disabled={!!busy || !content.trim()}>Teach</button>
        </form>
        <ul className="memory-list">{memories.map((m) => <li key={m.id}><article className={`memory memory-${m.state}`}>
          <div className="memory-meta"><span className={`memory-pill pill-${m.state}`}>{m.state}</span><span className="hint">{m.source}</span></div>
          <p>{m.content}</p>
          <MemoryEditor memory={m} onSaved={onRefresh} />
          <div className="actions">{m.state !== 'approved' && <button className="approve small" disabled={!!busy} onClick={() => void save(m.id, () => api.decideMemory(m.id, 'approve'), 'Memory approved.')}>Approve memory</button>}{m.state !== 'revoked' && <button className="small" disabled={!!busy} onClick={() => void save(m.id, () => api.decideMemory(m.id, 'revoke'), 'Memory revoked.')}>Revoke memory</button>}</div>
        </article></li>)}</ul>
        {!memories.length && <p className="empty">No memories yet.</p>}
      </section>
      <SourceSettings />
      <section className="sheet">
        <h2>Personal preferences</h2>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void save('email', () => api.updateMe({ email: email.trim() }), 'Email preference saved.') }}><label>Email me copies<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!busy} placeholder="Optional email address" /></label><button disabled={!!busy}>Save email</button></form>
        <div className="actions"><button disabled={!!busy} onClick={() => void save('status', () => api.updateMe({ status: me?.status === 'away' ? 'available' : 'away' }), 'Availability saved.')}>{me?.status === 'away' ? 'Set available' : 'Set away'}</button></div>
        <h3>Phone notifications</h3><p className="hint">Get a phone notification when work is ready or your Alter needs a decision.</p>
        <div className="actions"><button disabled={!!busy} onClick={() => void save('push', () => import('../push').then((m) => m.enablePush()), 'Push notifications enabled on this device.')}>Enable phone notifications</button><button disabled={!!busy} onClick={() => void save('push-off', () => import('../push').then((m) => m.disablePush()), 'Push notifications disabled on this device.')}>Disable phone notifications</button></div>
      </section>
    </div>
  </section>
}
