import { useEffect, useRef, useState } from 'react'
import { meetingApi } from '../api/meetings'
import { httpCall } from '../api/client'
import type { Meeting, MeetingDetail } from '../api/meetings'
import type { Member, Section } from '../api/types'
import { WorkPreview } from '../components/WorkPreview'
import { Citations } from '../components/Citations'
import { Icon, Avatar } from '../components/Icon'
import { VoiceControl } from '../components/VoiceControl'
import { RoomSetup } from '../components/RoomSetup'

const states: Record<string, string> = { capturing: 'Capturing meeting', preparing: 'Preparing your review', ready: 'Ready for your review', applying: 'Applying reviewed changes', completed: 'Reviewed work completed', needs_attention: 'Needs attention', cancelled: 'Cancelled', paused: 'Work paused' }
type Upload = { id: string; text: string; kind: 'human' | 'alter' }

export function Work({ members, memberId, initialId }: { members: Member[]; memberId: string; initialId?: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState(initialId ?? sessionStorage.getItem('alter.open.meeting') ?? '')
  const [detail, setDetail] = useState<MeetingDetail>()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('Login revamp · team sync')
  const [consent, setConsent] = useState(false)
  const [participants, setParticipants] = useState<string[]>(['dev', 'kani', 'sahil'])
  const [draft, setDraft] = useState('')
  const [instruction, setInstruction] = useState('')
  const [allow, setAllow] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reviewedKey, setReviewedKey] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [card, setCard] = useState(0)
  const [unsaved, setUnsaved] = useState(0)
  const [voiceActive, setVoiceActive] = useState(false)
  const [currentDoc, setCurrentDoc] = useState<{ sections: Section[]; revision: string; refreshedAt: string }>()
  const uploading = useRef(false)
  const pending = useRef<Upload[]>([])
  const scroll = useRef<HTMLDivElement>(null)
  const currentId = useRef(selected)
  const person = (id: string) => members.find((m) => m.id === id)?.name ?? id

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const update = async () => {
      try {
        const list = await meetingApi.list()
        if (stopped) return
        setMeetings(list)
        if (selected) {
          const value = await meetingApi.get(selected)
          if (!stopped) setDetail(value)
        }
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Work could not load.') }
      if (!stopped) timer = setTimeout(() => void update(), 1500)
    }
    void update()
    return () => { stopped = true; clearTimeout(timer) }
  }, [selected])

  useEffect(() => {
    currentId.current = selected
    sessionStorage.setItem('alter.open.meeting', selected)
    try { pending.current = JSON.parse(localStorage.getItem('alter.capture.' + selected) ?? '[]'); setUnsaved(pending.current.length) }
    catch { pending.current = [] }
    setCard(0); setConfirm(false); setCurrentDoc(undefined)
  }, [selected])

  async function action(name: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(name); setError('')
    try { await fn() }
    catch (e) { setError(e instanceof Error ? e.message : 'The action could not finish. Please retry.') }
    finally { setBusy('') }
  }
  async function flush() {
    if (uploading.current) throw new Error('Wait for the transcript upload to finish.')
    uploading.current = true
    try {
      while (pending.current.length) {
        const batch = pending.current.slice(0, 10)
        await meetingApi.append(currentId.current, batch)
        pending.current.splice(0, batch.length)
        localStorage.setItem('alter.capture.' + currentId.current, JSON.stringify(pending.current))
        setUnsaved(pending.current.length)
      }
    } finally { uploading.current = false }
  }
  function capture(text: string, kind: 'human' | 'alter') {
    for (const line of text.split(/\n+/).filter((line) => line.trim())) for (let offset = 0; offset < line.length; offset += 4000) pending.current.push({ id: 'seg_' + crypto.randomUUID().replaceAll('-', ''), text: line.slice(offset, offset + 4000), kind })
    localStorage.setItem('alter.capture.' + currentId.current, JSON.stringify(pending.current))
    setUnsaved(pending.current.length)
    if (!uploading.current) void flush().catch(() => setError('Some transcript segments are saved on this device. Retry upload before preparing the review.'))
  }
  const choose = (id: string) => { setDetail(undefined); setSelected(id); setCreating(false); setError(''); setAllow(false); setConsent(false) }
  const openCard = (index: number) => { setCard(index); scroll.current?.scrollTo({ left: scroll.current.clientWidth * index, behavior: 'smooth' }) }
  const doc = detail?.approvals.find((a) => a.kind === 'doc_edit')
  const summary = detail?.approvals.find((a) => a.kind === 'email')
  const applied = detail?.approvals.filter((a) => a.state === 'applied').length ?? 0
  const reviewKey = JSON.stringify([detail?.revision, detail?.approvals.map((a) => [a.id, a.revision, a.state])])

  return <section className="screen work-screen">
    {(!selected || creating) && <div className="section-heading"><div><h2>Meetings</h2><p className="hint">Each meeting becomes a status update, team summary and tasks for your review.</p></div><button className="primary icon-button" onClick={() => { setCreating(true); setConsent(false); setError('') }}><Icon name="plus" size={17} />New meeting</button></div>}
    {error && <><p className="error" role="alert">{error}</p>{selected && !detail && <button onClick={() => choose('')}>Back to all work</button>}</>}
    {creating && <form className="card meeting-create" onSubmit={(e) => { e.preventDefault(); void action('create', async () => { const value = await meetingApi.create(title, participants.filter((id) => members.some((m) => m.id === id)), 'siddhi'); choose(value.id) }) }}>
      <h3>Start a meeting workspace</h3><label>Meeting title<input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} required /></label>
      <fieldset className="participant-picker"><legend>Participants receiving the review summary</legend>{members.filter((m) => m.id !== memberId && m.id !== 'siddhi').map((m) => <label key={m.id}><input type="checkbox" checked={participants.includes(m.id)} onChange={(e) => setParticipants((list) => e.target.checked ? [...list, m.id] : list.filter((id) => id !== m.id))} /><Avatar name={m.name} size="small" />{m.name}</label>)}</fieldset>
      <label className="check-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />The participants consent to capturing this meeting's transcript. Siddhi's Alter represents his permitted work knowledge.</label>
      <div className="actions"><button className="primary" disabled={!consent || !!busy}>Start capture</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
    </form>}
    {!creating && !selected && <div className="meeting-list">{meetings.length ? meetings.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((m) => <button className="meeting-row" key={m.id} onClick={() => choose(m.id)}><span className="meeting-symbol"><Icon name="work" size={24} /></span><span><strong>{m.title}</strong><span className="hint">{states[m.state]} · {m.decisions.length} decisions</span></span><Icon name="arrow" /></button>) : <p className="empty">No meetings yet.</p>}</div>}
    {!creating && selected && !detail && !error && <div className="work-loading" role="status">Opening your meeting workspace…</div>}
    {!creating && detail && <>
      <button className="back-link" onClick={() => choose('')}>← All work</button>
      <header className="review-heading"><div><p className="eyebrow">{states[detail.state]}</p><h3>{detail.title}</h3><p className="hint">{detail.decisions.length} {detail.decisions.length === 1 ? 'decision' : 'decisions'} captured · {detail.approvals.length - applied} prepared actions · {applied} completed{detail.escalationId && detail.launchState !== 'confirmed' ? ' · 1 waiting on Siddhi' : ''}</p></div><span className={`review-status state-${detail.state}`}><Icon name={detail.state === 'completed' ? 'check' : 'clock'} size={15} />{states[detail.state]}</span></header>
      {detail.state === 'capturing' ? <div className="capture-layout"><section className="card"><p className="eyebrow">Consenting transcript capture</p><h3>Siddhi's knowledge can join the conversation.</h3><p className="hint">Start the room's audio, or paste a transcript. Speaker labels from mixed audio are unverified and never grant authority.</p>
        <VoiceControl mode="huddle" targetId={detail.representedMember} meetingId={detail.id} onCapture={capture} onSpeaking={() => {}} onResult={() => {}} onActive={setVoiceActive} />
        <RoomSetup meetingId={detail.id} memberId={detail.representedMember} />
        <label>Add meeting transcript<textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste the meeting transcript here…" /></label><button disabled={!draft.trim() || !!busy} onClick={() => { capture(draft.trim(), 'human'); setDraft('') }}>Save transcript</button>
        <p className="hint">{detail.segmentCount} saved segments{unsaved ? ` · ${unsaved} awaiting upload` : ''}</p>
        {unsaved > 0 && <button onClick={() => void action('upload', flush)}>Retry transcript upload</button>}
        <div className="actions"><button className="primary" disabled={!!busy || voiceActive || (!detail.segmentCount && !unsaved)} onClick={() => void action('prepare', async () => { await flush(); await meetingApi.finish(detail.id); setDetail(await meetingApi.get(detail.id)) })}>Prepare my review <Icon name="arrow" size={16} /></button></div><p className="hint">End voice before finalizing. Capture remains resumable until you prepare the review.</p>
      </section><aside className="transcript-paper"><p className="eyebrow">Meeting transcript</p>{detail.segments.length ? detail.segments.map((s) => <p key={s.id}><span>{s.kind === 'alter' ? "Siddhi's Alter · AI" : 'Meeting audio'}</span>{s.text}</p>) : <p className="empty">The conversation will appear here as segments are saved.</p>}</aside></div> : <>
        {!!detail.approvals.length && <>
          <div className="review-tabs" role="tablist" aria-label="Review cards">{['Status doc', 'Team summary', 'Task board'].map((name, i) => <button role="tab" aria-selected={card === i} key={name} onClick={() => openCard(i)}>{name}<span>0{i + 1}</span></button>)}</div>
          <div className="review-strip" ref={scroll} onScroll={() => { if (scroll.current) setCard(Math.round(scroll.current.scrollLeft / scroll.current.clientWidth)) }}>
            <section className="review-page"><div className="artifact-paper"><div className="artifact-title"><Icon name="files" /><div><p className="eyebrow">Google Docs · {currentDoc ? 'Current document' : doc?.state === 'applied' ? 'Approved version' : 'Proposed change'}</p><h3>Login revamp — status</h3></div></div>{doc && <><WorkPreview approval={currentDoc ? { ...doc, preview: { after: currentDoc.sections, diffs: [] } } : doc} /><Citations sources={doc.citations} />{doc.externalUrl && <div className="actions"><a href={doc.externalUrl} target="_blank" rel="noreferrer">Open updated document ↗</a><button disabled={!!busy} onClick={() => void action('refresh-doc', async () => setCurrentDoc(await httpCall('GET', `/artifacts/${doc.id}`)))}>Refresh current document</button></div>}{currentDoc && <p className="hint">Read from the provider at {new Date(currentDoc.refreshedAt).toLocaleTimeString()} · revision {currentDoc.revision}</p>}</>}</div></section>
            <section className="review-page"><div className="artifact-paper"><p className="eyebrow">Team inboxes · {summary?.state === 'applied' ? 'Delivered' : 'Ready to send after approval'}</p><h3>A clear next step for everyone.</h3>{summary ? <WorkPreview approval={summary} /> : <p>No summary recipients were selected.</p>}</div></section>
            <section className="review-page"><div className="artifact-paper"><p className="eyebrow">Your meeting's work</p><h3>Everyone knows what comes next.</h3><div className="task-board">{detail.tasks.map((task) => <div className="task-tile" key={task.id}><Avatar name={person(task.owner)} size="small" /><div><strong>{task.title}</strong><p>{person(task.owner)} · {task.due}</p></div><span className="task-state">{task.state}</span></div>)}<div className="task-tile"><Icon name="files" /><div><strong>Status document</strong><p>{doc?.state === 'applied' ? 'Updated in Google Docs' : 'Prepared for your approval'}</p></div><span className="task-state">{doc?.state ?? 'prepared'}</span></div>{detail.escalationId && <div className="task-tile"><Avatar name="Siddhi" size="small" /><div><strong>Confirm the launch date</strong><p>{detail.launchDecision ? detail.launchDecision.date : 'Priority question sent to Siddhi'}</p></div><span className="task-state">{detail.launchState === 'confirmed' ? 'confirmed' : 'waiting'}</span></div>}</div></div></section>
          </div>
        </>}
        {detail.state === 'ready' && <section className="review-controls"><div className="review-instruction"><label>One more thing to change?<input value={instruction} onChange={(e) => { setInstruction(e.target.value); setConfirm(false) }} placeholder="Add that Kani's mock-ups are due Friday…" /></label><button disabled={!instruction.trim() || !!busy} onClick={() => void action('revise', async () => { setDetail(await meetingApi.revise(detail.id, detail.revision, instruction)); setInstruction(''); setConfirm(false) })}>Apply edit</button></div><VoiceControl mode="review" targetId={detail.id} onResult={(value) => { setDetail(value as MeetingDetail); setConfirm(false) }} />
          <label className="check-label continuation-choice"><input type="checkbox" checked={allow} onChange={(e) => { setAllow(e.target.checked); setConfirm(false) }} /><span><strong>Let my Alter resolve the production-readiness follow-up.</strong><span>Ask Siddhi's Alter and fill only the production-readiness field in this status doc. One use, expires in an hour. Launch dates still need Siddhi.</span></span></label>
          {confirm && reviewedKey === reviewKey ? <div className="approval-confirmation"><h3>Approve these reviewed changes?</h3><p>Update the status document and deliver this summary to {detail.participants.filter((id) => id !== memberId).map(person).join(', ') || 'no additional teammates'}. {allow ? 'The limited production-readiness follow-up will also be authorized.' : 'Further document changes will require your approval.'}</p><div className="actions"><button className="primary" disabled={!!busy} onClick={() => void action('approve', async () => { await meetingApi.approve(detail, allow); setConfirm(false); setDetail(await meetingApi.get(detail.id)) })}>Approve reviewed changes <Icon name="check" size={16} /></button><button onClick={() => setConfirm(false)}>Keep reviewing</button></div></div> : <div className="review-action-bar"><span><strong>{detail.approvals.length} prepared actions</strong><small>Revision {detail.revision} · review before anything is published</small></span><button className="primary" disabled={!!busy} onClick={() => { setReviewedKey(reviewKey); setConfirm(true) }}>Review and approve <Icon name="arrow" size={16} /></button></div>}
        </section>}
        {detail.state === 'completed' && <div className="completed-banner"><Icon name="check" /><div><strong>{applied} reviewed actions completed.</strong><p>Open the document to inspect the result. The team summary is in the recipients' inboxes.</p></div></div>}
        {detail.grant?.state === 'active' && <button onClick={() => void action('revoke', async () => { await meetingApi.revoke(detail.id); setDetail(await meetingApi.get(detail.id)) })}>Revoke follow-up permission</button>}
        {detail.followupAnswer && <div className="card followup-result"><p className="eyebrow">Dev's Alter → Siddhi's Alter</p><h3>{detail.continuation === 'completed' ? 'One less thing to chase.' : 'Production-readiness follow-up'}</h3><p>{detail.followupAnswer.answer}</p><Citations sources={detail.followupAnswer.citations} /><p className="hint">{detail.continuation === 'completed' ? 'Document updated · checklist complete · earlier authorization used' : 'Review the current workflow status for its result.'}</p></div>}
      </>}
      {detail.events.length > 0 && <section className="meeting-timeline"><p className="eyebrow">Activity · what your Alter actually did</p>{detail.events.map((event, i) => <div className={`timeline-event event-${event.kind}`} key={event.key ?? `${event.ts}-${i}`}><span className="timeline-dot" /><p>{event.label}</p><time>{new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</section>}
      {detail.state === 'needs_attention' && <div className="actions"><button onClick={() => void action('retry', async () => { await meetingApi.command(detail.id, 'retry'); setDetail(await meetingApi.get(detail.id)) })}>Review results and retry safely</button><button onClick={() => void action('cancel', async () => { await meetingApi.command(detail.id, 'cancel'); setDetail(await meetingApi.get(detail.id)) })}>Cancel remaining work</button></div>}
      {['preparing', 'applying', 'paused'].includes(detail.state) && <div className="actions"><button disabled={!!busy} onClick={() => void action('control', async () => { await meetingApi.command(detail.id, detail.state === 'paused' ? 'resume' : 'pause'); setDetail(await meetingApi.get(detail.id)) })}>{detail.state === 'paused' ? 'Resume work' : 'Pause work'}</button><button disabled={!!busy} onClick={() => void action('cancel', async () => { await meetingApi.command(detail.id, 'cancel'); setDetail(await meetingApi.get(detail.id)) })}>Cancel remaining work</button><p className="hint">A write already in flight may finish. Its actual result remains in the receipt.</p></div>}
    </>}
  </section>
}
