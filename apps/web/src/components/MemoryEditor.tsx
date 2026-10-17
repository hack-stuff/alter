import { useState } from 'react'
import type { Memory } from '../api/types'
import { httpCall, MOCK } from '../api/client'

export function MemoryEditor({ memory, onSaved }: { memory: Memory; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [audience, setAudience] = useState(memory.audience ?? 'team')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="memory-editor"><p className="hint">{memory.audience === 'owner' ? 'Only for your own work' : 'Permitted team requests'} · {memory.appliesTo ?? 'Role guidance'} · v{memory.version ?? 1}</p><button disabled={MOCK} onClick={() => setOpen(!open)}>Edit guidance</button>{open && <form onSubmit={(e) => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); void httpCall('PUT', `/memories/${memory.id}`, { content, audience, appliesTo: memory.appliesTo ?? 'Login revamp', expectedVersion: memory.version ?? 1, sourceIds: memory.sourceIds ?? [] }).then(() => { setOpen(false); onSaved() }).catch((e) => setError(e.message)).finally(() => setBusy(false)) }}><label>Corrected guidance<textarea value={content} onChange={(e) => setContent(e.target.value)} required /></label><label>Use this guidance<select value={audience} onChange={(e) => setAudience(e.target.value as 'owner' | 'team')}><option value="owner">Only for my own work</option><option value="team">For permitted team requests too</option></select></label><p className="hint">An edit returns this memory to review. It becomes usable after your new approval.</p><button disabled={busy}>Save for review</button>{error && <p className="error">{error}</p>}</form>}</div>
}
