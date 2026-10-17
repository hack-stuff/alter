import { useEffect, useState } from 'react'
import { httpCall, MOCK } from '../api/client'

interface Source { id: string; title: string; text: string; audience: string; version: number; status: string }
export function SourceSettings() {
  const [sources, setSources] = useState<Source[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [audience, setAudience] = useState('owner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string>()
  const [revision, setRevision] = useState('')
  async function refresh() { if (!MOCK) setSources(await httpCall('GET', '/sources')) }
  useEffect(() => {
    if (MOCK) return
    let active = true
    void httpCall<Source[]>('GET', '/sources').then((items) => { if (active) setSources(items) }).catch(() => { if (active) setError('Imported sources could not load.') })
    return () => { active = false }
  }, [])
  async function save(action: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'The source could not be saved.') } finally { setBusy(false) } }
  return <section className="sheet"><h2>Context you add</h2><p className="hint">Import selected text from your work. Each excerpt keeps its owner, audience and version. Add only information you are authorized to use.</p><form onSubmit={(e) => { e.preventDefault(); void save(async () => { await httpCall('POST', '/sources', { title, text, audience }); setTitle(''); setText('') }) }}><label>Source title<input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} required /></label><label>Selected source excerpt<textarea value={text} maxLength={40000} onChange={(e) => setText(e.target.value)} required /></label><label>Source audience<select value={audience} onChange={(e) => setAudience(e.target.value)}><option value="owner">Only my own work</option><option value="team">Workspace team</option></select></label><button disabled={busy || MOCK || !title.trim() || !text.trim()}>Import excerpt</button></form>{sources.map((source) => <article className="memory" key={source.id}><p className="eyebrow">{source.status} · {source.audience} · v{source.version}</p><h4>{source.title}</h4><details><summary>Inspect source</summary><p className="source-excerpt">{source.text}</p></details>{editing === source.id ? <form onSubmit={(e) => { e.preventDefault(); void save(async () => { await httpCall('PUT', `/sources/${source.id}`, { text: revision, expectedVersion: source.version }); setEditing(undefined) }) }}><label>Updated source excerpt<textarea value={revision} maxLength={40000} onChange={(e) => setRevision(e.target.value)} /></label><button disabled={busy}>Save source revision</button></form> : <button disabled={busy} onClick={() => { setEditing(source.id); setRevision(source.text) }}>Update excerpt</button>}<div className="actions"><button disabled={busy || source.status !== 'active' || source.text.length > 10000} onClick={() => void save(() => httpCall('POST', '/memories', { content: source.text, audience: source.audience, sourceIds: [source.id], appliesTo: 'Login revamp' }))}>Propose guidance from excerpt</button><button disabled={busy || source.status === 'revoked'} onClick={() => void save(() => httpCall('DELETE', `/sources/${source.id}`))}>Revoke source</button></div></article>)}{error && <p className="error" role="alert">{error}</p>}</section>
}
