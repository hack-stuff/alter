import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { VoiceControl } from '../components/VoiceControl'
import { AlterBadge } from '../components/AlterBadge'
import type { Answer } from '../api/types'
import { Citations } from '../components/Citations'
import { meetingApi } from '../api/meetings'

const names: Record<string, string> = { siddhi: 'Siddhi', dev: 'Dev', kani: 'Kani', sahil: 'Sahil' }
export function Kiosk({ memberId, meetingId }: { memberId: string; meetingId?: string }) {
  const [speaking, setSpeaking] = useState(false)
  const [answer, setAnswer] = useState<Answer>()
  const [clean, setClean] = useState(false)
  const [room, setRoom] = useState('')
  const [bound, setBound] = useState(!!sessionStorage.getItem('alter.meeting.room'))
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [active, setActive] = useState(false)
  const [level, setLevel] = useState(0)
  const [saved, setSaved] = useState(0)
  const uploads = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setClean(false) }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape) }, [])
  async function refreshDevices() {
    try {
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true })
      permission.getTracks().forEach((track) => track.stop())
      setDevices(await navigator.mediaDevices.enumerateDevices())
    } catch { setError('Microphone access is required to list the audio devices.') }
  }
  function capture(text: string, kind: 'human' | 'alter') {
    if (!meetingId) return
    const segments = text.split(/\n+/).flatMap((line) => {
      const items = []
      for (let offset = 0; offset < line.length; offset += 4000) items.push({ id: 'seg_' + crypto.randomUUID().replaceAll('-', ''), text: line.slice(offset, offset + 4000), kind })
      return items
    })
    uploads.current = uploads.current.catch(() => {}).then(async () => {
      const key = 'alter.capture.' + meetingId
      const pending = [...JSON.parse(localStorage.getItem(key) ?? '[]'), ...segments]
      localStorage.setItem(key, JSON.stringify(pending))
      while (pending.length) {
        const batch = pending.slice(0, 10)
        await meetingApi.append(meetingId, batch)
        pending.splice(0, batch.length)
        localStorage.setItem(key, JSON.stringify(pending))
        setSaved((count) => count + batch.length)
      }
    }).catch(() => setError('Transcript upload paused. Unsent segments remain on this rig. Reconnect room access and retry before finalizing.'))
  }
  return <main style={{ '--voice-level': level } as CSSProperties} className={`kiosk ${speaking ? 'is-speaking' : ''} ${clean ? 'clean-kiosk' : ''}`}>
    <div className="alter-cube" aria-hidden="true">{(names[memberId] ?? 'A')[0]}</div>
    <h1>{names[memberId] ?? 'Teammate'}'s Alter <AlterBadge /></h1><p>{memberId === 'siddhi' ? 'Siddhi is on leave' : 'AI representative'}</p>
    <div className="kiosk-operator" hidden={clean}>
      {meetingId && !bound && <form onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem('alter.meeting.room', room.trim()); setRoom(''); setBound(true) }}><label>Short-lived meeting room access<input type="password" autoComplete="off" value={room} onChange={(e) => setRoom(e.target.value)} required /></label><button>Connect this room</button><p className="hint">Generate room access from the organizer's meeting capture screen. This rig can only capture and ask within that meeting.</p></form>}
      {(!meetingId || bound) && <>
        <details><summary>Audio routing</summary><button disabled={active} onClick={() => void refreshDevices()}>Refresh audio devices</button><div className="audio-devices"><label>Meeting audio input<select disabled={active} value={input} onChange={(e) => setInput(e.target.value)}><option value="">System default microphone</option>{devices.filter((d) => d.kind === 'audioinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></label><label>Alter voice output<select disabled={active} value={output} onChange={(e) => setOutput(e.target.value)}><option value="">System default output</option>{devices.filter((d) => d.kind === 'audiooutput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></label></div></details>
        <VoiceControl mode="huddle" targetId={memberId} meetingId={meetingId} inputDeviceId={input} outputDeviceId={output} onActive={setActive} onLevel={setLevel} onSpeaking={setSpeaking} onCapture={capture} onResult={(result) => setAnswer(result as Answer)} />
        <div className="actions"><button onClick={() => setClean(true)}>Clean recording view</button>{meetingId && <button disabled={active} onClick={() => { sessionStorage.removeItem('alter.meeting.room'); setBound(false) }}>Change room access</button>}{meetingId && <button onClick={() => capture('', 'human')}>Retry transcript upload</button>}</div>
      </>}
      {meetingId && <p className="hint">{saved} transcript segments uploaded during this take. End voice before the organizer prepares the review.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {answer && <div className="kiosk-answer"><p>{answer.answer}</p><Citations sources={answer.citations} /></div>}
      <p className="hint">Capture this window in OBS. Route Meet output to this page's input and this page's output to Meet's microphone. Press Escape to show controls.</p>
    </div>
    {clean && <button className="kiosk-show-controls" onClick={() => setClean(false)}>Show controls</button>}
  </main>
}
