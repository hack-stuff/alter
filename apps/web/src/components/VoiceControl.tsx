import { useEffect, useRef, useState } from 'react'
import { LiveSession } from '../live/session'
import type { LiveMode } from '../live/modes'
import { Icon } from './Icon'
import type { WorkSurface } from '../agent/navigation'
import { unlockVoiceAudio } from '../live/voiceAudio'

interface Props {
  mode: LiveMode
  targetId?: string
  conversationId?: string
  meetingId?: string
  inputDeviceId?: string
  outputDeviceId?: string
  context?: string
  draftOnly?: boolean
  onTranscript?: (text: string) => void
  onResult: (result: unknown, tool: string, input: string) => void
  onSpeaking?: (speaking: boolean) => void
  onCapture?: (text: string, kind: 'human' | 'alter') => void
  onActive?: (active: boolean) => void
  onLevel?: (level: number) => void
  autoStart?: boolean
  active?: boolean
  greet?: boolean
  onState?: (state: 'connecting' | 'listening' | 'speaking' | 'closed') => void
  onNavigate?: (screen: WorkSurface) => void
  onFirstSpeech?: () => void
  onUnroutedUtterance?: (text: string) => void
  onError?: (message: string) => void
}
export function VoiceControl(props: Props) {
  const callbacks = useRef(props)
  useEffect(() => { callbacks.current = props }, [props])
  const session = useRef<LiveSession | undefined>(undefined)
  const [state, setState] = useState<'connecting' | 'listening' | 'speaking' | 'closed'>('closed')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [level, setLevel] = useState(0)
  const stateRef = useRef(state)
  const started = useRef(false)
  useEffect(() => () => { session.current?.stop() }, [])
  useEffect(() => { session.current?.setConversationId(props.conversationId) }, [props.conversationId])
  function start() {
    if (stateRef.current !== 'closed' || props.active === false) return
    stateRef.current = 'connecting'
    started.current = true
    setError(''); setInput(''); setOutput(''); setMuted(props.mode === 'reply')
    const instance = new LiveSession({
      ...props,
      onResult: (result, tool, text) => { if (tool === 'respond_escalation' && props.draftOnly) callbacks.current.onTranscript?.(text); callbacks.current.onResult(result, tool, text) },
      onState: (value) => { stateRef.current = value; setState(value); callbacks.current.onState?.(value); callbacks.current.onSpeaking?.(value === 'speaking'); callbacks.current.onActive?.(value !== 'closed') },
      onFirstSpeech: () => callbacks.current.onFirstSpeech?.(),
      onUnroutedUtterance: (text) => callbacks.current.onUnroutedUtterance?.(text),
      onTranscript: (text, speaker, final) => { if (speaker === 'user') { setInput(text); if (final && props.draftOnly) callbacks.current.onTranscript?.(text) } else setOutput(text); if (final && text.trim()) callbacks.current.onCapture?.(text, speaker === 'user' ? 'human' : 'alter') },
      onError: (message) => { setError(message); callbacks.current.onError?.(message) },
      onLevel: (value) => { setLevel(value); callbacks.current.onLevel?.(value) },
    })
    session.current = instance; if (props.mode === 'reply') instance.mute(true); void instance.start()
  }
  const startRef = useRef(start)
  useEffect(() => { startRef.current = start })
  useEffect(() => {
    if (props.active === false) { session.current?.stop(); started.current = false; return }
    if (!props.autoStart || started.current) return
    const timer = setTimeout(() => { started.current = true; startRef.current() }, 700)
    return () => clearTimeout(timer)
  }, [props.autoStart, props.active])
  if (props.active === false) return null
  return <div className={`voice-control voice-${state}`} aria-label={`${props.mode} voice controls`}>
    <div className="actions">{state === 'closed' ? <button type="button" onClick={() => { unlockVoiceAudio(); start() }}><Icon name="mic" size={16} />{/enable voice/i.test(error) ? 'Enable voice' : props.mode === 'revise' || props.mode === 'review' ? 'Revise by voice' : props.mode === 'reply' ? 'Speak your reply' : props.mode === 'huddle' ? 'Talk to this Alter' : 'Talk to your Alter'}</button> : <><span className="voice-wave" aria-hidden="true">{[.5,.8,1,.7,.4].map((factor, i) => <i key={i} style={{ height: 4 + level * factor * 16 }} />)}</span>
      <button type="button" onClick={() => { session.current?.stop() }}>End voice</button>
      {props.mode === 'chat' && state !== 'connecting' && <button type="button" onClick={() => { unlockVoiceAudio(); session.current?.greet() }}>Hear my briefing</button>}
      {props.mode === 'reply' ? <button type="button" disabled={state === 'connecting'}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setMuted(false); session.current?.mute(false) }}
        onPointerUp={() => { setMuted(true); session.current?.mute(true) }} onPointerCancel={() => { setMuted(true); session.current?.mute(true) }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setMuted(false); session.current?.mute(false) } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { setMuted(true); session.current?.mute(true) } }}>Hold to talk</button> : <button type="button" aria-pressed={muted} onClick={() => { const value = !muted; setMuted(value); session.current?.mute(value) }}>{muted ? 'Unmute' : 'Mute mic'}</button>}
    </>}</div>
    {state !== 'closed' && <p role="status" className="hint">{state === 'connecting' ? 'Connecting voice…' : state === 'speaking' ? 'Your Alter is speaking…' : muted ? 'Microphone muted' : 'Listening…'} · up to 10 minutes</p>}
    {input && <div className="transcript"><span className="eyebrow">You said</span>{correcting ? <form onSubmit={(e) => { e.preventDefault(); session.current?.correct(input); callbacks.current.onTranscript?.(input); setCorrecting(false) }}><label className="sr-only" htmlFor={`transcript-${props.mode}-${props.targetId ?? 'chat'}`}>Correct transcript</label><textarea id={`transcript-${props.mode}-${props.targetId ?? 'chat'}`} value={input} onChange={(e) => setInput(e.target.value)} /><button disabled={state === 'closed'}>Send correction</button></form> : <button type="button" className="transcript-text" onClick={() => setCorrecting(true)}>{input} <span className="hint">· Tap to correct</span></button>}</div>}
    {output && <div className="transcript"><span className="eyebrow">Alter said</span><p>{output}</p></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
