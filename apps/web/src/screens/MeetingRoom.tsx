import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { roomApi, roomLink, type RoomInfo, type RoomSummary } from '../api/rooms'
import { Icon } from '../components/Icon'
import { Avatar, AlterAvatar } from '../components/People'
import { VoiceControl } from '../components/VoiceControl'
import { voiceAudio, voiceSpeaker } from '../live/voiceAudio'
import { RoomConnection, type AlterUpdate, type RemotePeer } from '../room/connection'
import { voiceHold } from '../live/dock'
import { pretendsToBeSiddhi, SIDDHI_IN_ROOM } from '../api/presentation'

// Demo prompts for the represented teammate's Alter, shown at the top of the room.
const QUESTIONS = ['When are we launching the login revamp?', 'Why did we switch to one-tap sign-in?', 'Is the one-tap sign-in backend approved for production?']

export interface RoomHost {
  meetingId: string
  alterId: string
  alterName: string
  onCapture: (text: string, kind: 'human' | 'alter') => void
  /** End the meeting for everyone and prepare the review. */
  onEnd: () => void
  /** Teammates shown as sample attendees until a real person joins. */
  others?: string[]
}

/** Everyone brings their Alter: a small window in the corner of their tile. */
function AlterPip({ owner }: { owner: string }) {
  return <div className="room-pip" aria-label={`${owner}’s Alter, taking notes`}>
    <AlterAvatar name={owner} variant="alter-only" size="sm" />
    <span><strong>{owner}’s Alter</strong><small>Taking notes</small></span>
  </div>
}

function Tile({ stream, name, owner, muted = false, mirrored = false, camera = true, sample = false }: { stream?: MediaStream; name: string; owner: string; muted?: boolean; mirrored?: boolean; camera?: boolean; sample?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current && video.current.srcObject !== (stream ?? null)) video.current.srcObject = stream ?? null
  }, [stream])
  const showVideo = camera && !!stream?.getVideoTracks().length
  return <div className={`room-tile${sample ? ' is-sample' : ''}`}>
    {/* Remote audio plays through this element even while the picture is hidden. */}
    <video ref={video} autoPlay playsInline muted={muted} className={mirrored ? 'is-mirrored' : undefined} hidden={!showVideo} />
    {!showVideo && <Avatar name={owner} size="large" />}
    <AlterPip owner={owner} />
    <span className="room-tile-name">{name}{sample && <span className="room-sample"> · sample</span>}</span>
  </div>
}

/** Alter's own meeting room: everyone with the link sees and hears each other and the represented Alter. */
export function MeetingRoom({ code, name, host, onLeave }: { code: string; name: string; host?: RoomHost; onLeave: () => void }) {
  const [raw, setRaw] = useState<MediaStream>()
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('Joining…')
  const [room, setRoom] = useState<RoomInfo>()
  const [peers, setPeers] = useState<RemotePeer[]>([])
  const [alter, setAlter] = useState<AlterUpdate>({ state: 'connecting' })
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const [ended, setEnded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [alterInput, setAlterInput] = useState<MediaStream>()
  // Bumped to restart the Alter's voice after it closes (sessions last up to ten minutes).
  const [voiceKey, setVoiceKey] = useState(0)
  const [tip, setTip] = useState(true)
  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => { const timer = setInterval(() => setTipIndex((index) => index + 1), 9000); return () => clearInterval(timer) }, [])
  const connection = useRef<RoomConnection | undefined>(undefined)
  const mix = useRef<{ gate: GainNode; sources: Map<string, MediaStreamAudioSourceNode> } | undefined>(undefined)
  const isHost = !!host
  // The host's own Alter stays quiet in the meeting, so only the represented Alter hears them.
  useEffect(() => isHost ? voiceHold.take('meeting-room') : undefined, [isHost])

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    const audio = { echoCancellation: true, noiseSuppression: true }
    void (async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio, video: { width: 640, height: 360 } }) }
      catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio }); setNotice('Your camera is unavailable, so you joined with audio only.') }
        catch { stream = new MediaStream(); setNotice('Your microphone and camera are blocked, so others can’t hear you. Allow them in the browser and rejoin.') }
      }
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return }
      setRaw(stream)
    })()
    return () => { cancelled = true; stream?.getTracks().forEach((track) => track.stop()) }
  }, [])

  useEffect(() => {
    if (!raw) return
    let outgoing = raw
    let release = () => {}
    if (isHost) {
      // The host's page runs the Alter: everyone hears it in the host's outgoing audio,
      // and it hears the host's microphone plus every guest.
      const context = voiceAudio()
      void context.resume()
      const out = context.createMediaStreamDestination()
      const listen = context.createMediaStreamDestination()
      const gate = context.createGain()
      const speaker = voiceSpeaker()
      if (raw.getAudioTracks().length) {
        const microphone = context.createMediaStreamSource(raw)
        microphone.connect(out)
        microphone.connect(gate)
      }
      speaker.connect(out)
      gate.connect(listen)
      mix.current = { gate, sources: new Map() }
      outgoing = new MediaStream([...out.stream.getAudioTracks(), ...raw.getVideoTracks()])
      // oxlint-disable-next-line react/set-state-in-effect -- The mix exists only once the microphone does.
      setAlterInput(listen.stream)
      release = () => { speaker.disconnect(out); gate.disconnect(); mix.current?.sources.forEach((source) => source.disconnect()); mix.current = undefined }
    }
    const value = new RoomConnection(code, name, outgoing, {
      onPeers: setPeers,
      onAlter: setAlter,
      onEnded: () => setEnded(true),
      onError: setStatus,
    })
    connection.current = value
    value.join().then((info) => { setRoom(info); setStatus('') }).catch((error) => setStatus(error instanceof Error ? error.message : 'Could not join this meeting.'))
    return () => { void value.leave(); release() }
  }, [raw, code, name, isHost])

  // The Alter hears each guest who joins.
  useEffect(() => {
    if (!isHost || !mix.current) return
    const { gate, sources } = mix.current
    for (const peer of peers) {
      if (sources.has(peer.id) || !peer.stream?.getAudioTracks().length) continue
      const source = voiceAudio().createMediaStreamSource(peer.stream)
      source.connect(gate)
      sources.set(peer.id, source)
    }
    for (const [id, source] of sources) if (!peers.some((peer) => peer.id === id)) { source.disconnect(); sources.delete(id) }
  }, [peers, isHost])

  // While the Alter talks it stops listening, so it never answers its own voice.
  useEffect(() => { if (mix.current) mix.current.gate.gain.value = alter.state === 'speaking' ? 0 : 1 }, [alter.state])
  useEffect(() => { if (isHost) connection.current?.sendAlter(alter) }, [alter, isHost])
  useEffect(() => { raw?.getAudioTracks().forEach((track) => { track.enabled = mic }) }, [raw, mic])
  useEffect(() => { raw?.getVideoTracks().forEach((track) => { track.enabled = camera }) }, [raw, camera])

  const alterName = host?.alterName ?? room?.alter.name ?? 'Teammate'
  // An empty room looks broken in a demo; teammates sit in as quiet samples until someone joins.
  const samples = isHost && peers.length === 0 ? (host?.others ?? []).slice(0, 3) : []
  const voiceState = alter.state === 'closed' ? 'muted' : alter.state
  if (ended && !host) return <MeetingSummary code={code} />
  return <main className="room" aria-label={`${room?.title ?? 'Team sync'} meeting`}>
    <header className="room-head">
      <strong>{room?.title ?? 'Team sync'}</strong>
      <span className="mono">{code}</span>
      {(status || notice) && <span className="room-status" role="status">{status || notice}</span>}
    </header>
    {tip && <p className="room-tip"><span className="alter-glyph" aria-hidden="true">✦</span><span>Try asking out loud: <strong>“{QUESTIONS[tipIndex % QUESTIONS.length]}”</strong></span><button type="button" aria-label="Hide tip" onClick={() => setTip(false)}><Icon name="close" size={14} /></button></p>}
    {!tip && <div aria-hidden="true" />}
    <section className={`room-grid count-${Math.min(peers.length + samples.length + 2, 6)}`} aria-label="Participants">
      <Tile stream={raw} name={`${name} (you)`} owner={name} muted mirrored camera={camera} />
      {/* The absent teammate is represented by their Alter alone, at full size. */}
      <div className={`room-tile is-alter is-${alter.state}`} aria-label={`${alterName}’s Alter`}>
        <AlterAvatar name={alterName} variant="alter-only" size="xl" voiceState={voiceState} />
        {alter.caption && <p className="room-caption">{alter.caption}</p>}
        {host && alter.state === 'closed' && <button type="button" className="room-reconnect" onClick={() => { setAlter({ state: 'connecting' }); setVoiceKey((key) => key + 1) }}>Reconnect {alterName}’s Alter</button>}
        <span className="room-tile-name">{alterName}’s Alter<span className="room-for"> · speaking for {alterName}</span></span>
      </div>
      {peers.map((peer) => <Tile key={peer.id} stream={peer.stream} owner={peer.name} name={peer.connected ? peer.name : `${peer.name} · connecting…`} />)}
      {samples.map((sample) => <Tile key={`sample-${sample}`} owner={sample} name={sample} sample />)}
    </section>
    <footer className="room-bar">
      <div className="room-controls">
        <button type="button" className={mic ? '' : 'is-off'} aria-pressed={!mic} aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => setMic(!mic)}><Icon name={mic ? 'mic' : 'micOff'} size={20} /></button>
        <button type="button" className={camera ? '' : 'is-off'} aria-pressed={!camera} aria-label={camera ? 'Turn off camera' : 'Turn on camera'} onClick={() => setCamera(!camera)}><Icon name={camera ? 'video' : 'videoOff'} size={20} /></button>
        <button type="button" aria-label="Copy invite link" onClick={() => { void navigator.clipboard.writeText(roomLink(code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => setNotice(roomLink(code))) }}><Icon name={copied ? 'check' : 'link'} size={20} /></button>
        <button type="button" className={host ? "room-step-out" : "room-leave"} onClick={onLeave}>Leave</button>
        {host && <button type="button" className="room-leave" onClick={host.onEnd}>End meeting</button>}
      </div>
      {host && alterInput && <div className="room-voice">
        <VoiceControl key={voiceKey} mode="huddle" targetId={host.alterId} meetingId={host.meetingId} inputStream={alterInput} autoStart
          onState={(state) => setAlter((current) => ({ ...current, state }))}
          onCapture={(text, kind) => { host.onCapture(text, kind); if (kind === 'alter') setAlter((current) => ({ ...current, caption: text })) }}
          onError={setStatus}
          onResult={() => {}} />
      </div>}
    </footer>
  </main>
}

/** Someone who opened the meeting link: ask their name, then join. */
export function GuestRoom({ code }: { code: string }) {
  const [info, setInfo] = useState<RoomInfo>()
  const [error, setError] = useState('')
  const [name, setName] = useState(() => { try { return localStorage.getItem('alter.room.name') ?? '' } catch { return '' } })
  const [joined, setJoined] = useState(false)
  const [nameError, setNameError] = useState('')
  const [left, setLeft] = useState(false)
  useEffect(() => { roomApi.info(code).then(setInfo).catch((e) => setError(e instanceof Error ? e.message : 'This meeting link is not valid.')) }, [code])
  if (joined) return <MeetingRoom code={code} name={name.trim()} onLeave={() => { setJoined(false); setLeft(true) }} />
  return <main className="room-join">
    <form className="sheet" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; if (pretendsToBeSiddhi(name)) { setNameError(SIDDHI_IN_ROOM); return } setNameError(''); try { localStorage.setItem('alter.room.name', name.trim()) } catch { /* Remembering the name is optional. */ } setJoined(true) }}>
      <p className="brand-line"><BrandMark />Alter</p>
      {error ? <p className="error" role="alert">{error}</p> : <>
        <h1>{left ? 'You left the meeting' : info?.title ?? 'Joining…'}</h1>
        {info && <p className="hint">{info.host} is hosting. {info.alter.name}’s Alter is in the meeting and can answer for {info.alter.name}.</p>}
        <label>Your name<input value={name} onChange={(e) => { setName(e.target.value); setNameError('') }} maxLength={40} required autoFocus autoComplete="name" /></label>
        {nameError && <p className="error" role="alert">{nameError}</p>}
        <button className="primary" disabled={!info || info.ended || !name.trim()}>{info?.ended ? 'This meeting has ended' : left ? 'Rejoin' : 'Join meeting'}</button>
      </>}
    </form>
  </main>
}

/** After the meeting: what was decided, who does what, and what the absent teammate's Alter said. */
export function MeetingSummary({ code, onReview, onClose }: { code: string; onReview?: () => void; onClose?: () => void }) {
  const [summary, setSummary] = useState<RoomSummary>()
  const [error, setError] = useState('')
  const ready = !!summary && !['capturing', 'preparing'].includes(summary.state)
  useEffect(() => {
    if (ready) return
    let stopped = false
    const load = () => roomApi.summary(code).then((value) => { if (!stopped) setSummary(value) }).catch((e) => { if (!stopped) setError(e instanceof Error ? e.message : 'The summary could not load.') })
    void load()
    const timer = setInterval(load, 2500)
    return () => { stopped = true; clearInterval(timer) }
  }, [code, ready])
  return <main className="room room-summary" aria-label="Meeting summary">
    <section className="summary-card">
      <p className="eyebrow">{summary?.title ?? 'Team sync'} · meeting ended</p>
      <h1>Meeting summary</h1>
      {error && !summary && <p className="error" role="alert">{error}</p>}
      {!ready ? <p className="summary-wait" role="status"><span className="alter-glyph" aria-hidden="true">✦</span>{summary?.host ?? 'The organizer'}’s Alter is writing the summary from the conversation…</p> : <>
        <section aria-label="Decisions">
          <h2>Decisions</h2>
          {summary.decisions.length ? <ul>{summary.decisions.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="hint">No decision was confirmed in this meeting.</p>}
        </section>
        <section aria-label="Action items">
          <h2>Action items</h2>
          {summary.tasks.length ? <ul>{summary.tasks.map((task) => <li key={task.title}><strong>{task.owner}</strong> · {task.title}<small>{task.due === 'Unconfirmed' ? 'No date yet' : `Due ${task.due}`}</small></li>)}</ul> : <p className="hint">No action item was assigned.</p>}
        </section>
        {(summary.answers.length > 0 || summary.waitingOnAlterOwner) && <section aria-label={`From ${summary.alter}’s Alter`}>
          <h2><AlterAvatar name={summary.alter} variant="alter-only" size="xs" />From {summary.alter}’s Alter</h2>
          <ul>{summary.answers.map((text) => <li key={text}>{text}</li>)}</ul>
          {summary.waitingOnAlterOwner && <p className="summary-flag">The launch date is waiting on {summary.alter}; {summary.alter}’s Alter asked for confirmation.</p>}
        </section>}
      </>}
      {(onReview || onClose) && <div className="actions">
        {onReview && <button type="button" className="primary" disabled={!ready} onClick={onReview}>Open the full review</button>}
        {onClose && <button type="button" onClick={onClose}>Back to Alter</button>}
      </div>}
    </section>
  </main>
}
