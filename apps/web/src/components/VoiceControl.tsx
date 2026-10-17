import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LiveSession } from '../live/session'
import type { LiveMode } from '../live/modes'
import { Icon } from './Icon'
import type { NavigationAction, NavigationSource, ScreenId } from '../agent/navigation'
import { alterNav } from '../agent/navigator'
import type { DecisionIntent } from '../agent/decisions'
import { unlockVoiceAudio } from '../live/voiceAudio'

interface Props {
  mode: LiveMode
  targetId?: string
  conversationId?: string
  meetingId?: string
  inputDeviceId?: string
  /** Listen to this stream instead of the microphone (a meeting room mix). */
  inputStream?: MediaStream
  outputDeviceId?: string
  context?: string
  draftOnly?: boolean
  /** Float as the bottom-centre voice dock instead of sitting inline. */
  dock?: boolean
  /** Increment to replay the spoken briefing (chat mode). */
  briefing?: number
  /** With voice off, typed text goes here instead; resolving false keeps the text in the field. */
  onTextFallback?: (text: string) => unknown
  onTranscript?: (text: string) => void
  onUserUtterance?: (text: string) => void
  onResult: (result: unknown, tool: string, input: string) => void
  onSpeaking?: (speaking: boolean) => void
  onCapture?: (text: string, kind: 'human' | 'alter') => void
  onActive?: (active: boolean) => void
  onLevel?: (level: number) => void
  autoStart?: boolean
  /** How long to wait after the page is ready before an automatic start. */
  startDelay?: number
  active?: boolean
  greet?: boolean
  onState?: (state: 'connecting' | 'listening' | 'speaking' | 'closed') => void
  onNavigate?: (action: NavigationAction, source?: NavigationSource) => void
  onDecide?: (intent: DecisionIntent) => Promise<unknown>
  onFirstSpeech?: () => void
  onUnroutedUtterance?: (text: string) => void
  onError?: (message: string) => void
}

const screenNames: Record<ScreenId, string> = { home: 'Home', canvas: 'Canvas', meeting: 'Meeting', approvals: 'Approvals', decisions: 'Decisions', team: 'Team', 'work-log': 'Work log', rules: 'Rules & memory', files: 'Files' }
function describeTarget(target?: string) {
  if (!target) return ''
  const value = target.replace(/^(kind|label):/, '').replaceAll('_', ' ')
  return ` · ${value}`
}

const startLabels: Partial<Record<LiveMode, string>> = { revise: 'Revise by voice', review: 'Revise by voice', reply: 'Speak your reply', huddle: 'Talk to this Alter' }

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
  const [ended, setEnded] = useState(false)
  const [fallback, setFallback] = useState('')
  const queued = useRef('')
  const [lastSpeaker, setLastSpeaker] = useState<'user' | 'alter'>('user')
  const stateRef = useRef(state)
  // The Voice Bar narrates navigation so the user sees where the Alter took them.
  const [moved, setMoved] = useState<{ text: string; at: number }>()
  useEffect(() => {
    if (!props.dock) return
    return alterNav.subscribe((event) => {
      if (event.source === 'ui') return
      setMoved({ text: `Opened ${screenNames[event.screen]}${describeTarget(event.targetElementId)}`, at: event.at })
    })
  }, [props.dock])
  useEffect(() => {
    if (!moved) return
    const timer = setTimeout(() => setMoved(undefined), 3500)
    return () => clearTimeout(timer)
  }, [moved])
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
      onState: (value) => { stateRef.current = value; setState(value); if (value === 'listening' && queued.current) { const text = queued.current; queued.current = ''; session.current?.type(text) } if (value === 'closed') queued.current = ''; if (value === 'closed') setEnded(true); callbacks.current.onState?.(value); callbacks.current.onSpeaking?.(value === 'speaking'); callbacks.current.onActive?.(value !== 'closed') },
      onFirstSpeech: () => callbacks.current.onFirstSpeech?.(),
      onUnroutedUtterance: (text) => callbacks.current.onUnroutedUtterance?.(text),
      onTranscript: (text, speaker, final) => { setLastSpeaker(speaker === 'user' ? 'user' : 'alter'); if (speaker === 'user') { setInput(text); if (final) { callbacks.current.onUserUtterance?.(text); if (props.draftOnly) callbacks.current.onTranscript?.(text) } } else setOutput(text); if (final && text.trim()) callbacks.current.onCapture?.(text, speaker === 'user' ? 'human' : 'alter') },
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
    const timer = setTimeout(() => { started.current = true; startRef.current() }, props.startDelay ?? 700)
    return () => clearTimeout(timer)
  }, [props.autoStart, props.active, props.startDelay])
  const briefing = useRef(props.briefing ?? 0)
  useEffect(() => {
    if (!props.briefing || props.briefing === briefing.current) return
    briefing.current = props.briefing
    unlockVoiceAudio()
    if (stateRef.current === 'closed') startRef.current()
    else session.current?.greet()
  }, [props.briefing])
  if (props.active === false) return null

  const needsEnable = /enable voice/i.test(error)
  const failed = state === 'closed' && !!error && !needsEnable
  const visual = state === 'connecting' ? 'connecting' : state === 'speaking' ? 'speaking' : state === 'listening' ? (muted ? 'muted' : 'listening') : failed ? 'failed' : 'off'
  const status = state === 'connecting' ? 'Connecting voice…' : state === 'speaking' ? 'Your Alter is speaking…' : muted ? 'Microphone muted' : 'Listening…'
  const startLabel = needsEnable ? 'Enable voice' : props.mode === 'chat' && ended && !error ? 'Resume voice' : startLabels[props.mode] ?? 'Talk to your Alter'
  const startButton = <button type="button" className={`voice-start${needsEnable ? ' is-enable' : ''}`} onClick={() => { unlockVoiceAudio(); setEnded(false); start() }}><Icon name="mic" size={16} />{startLabel}</button>
  const indicator = <span className={`voice-indicator is-${visual}`} aria-hidden="true">
    {visual === 'connecting' && <span className="voice-orbit" />}
    {visual === 'listening' && <span className="voice-meter">{[.45, .8, 1, .7, .4].map((factor, i) => <i key={i} style={{ height: 4 + Math.min(1, level * 1.4) * factor * 18 }} />)}</span>}
    {visual === 'speaking' && <span className="voice-wave">{[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</span>}
    {(visual === 'muted' || visual === 'failed') && <Icon name="micOff" size={18} />}
  </span>
  const holdToTalk = <button type="button" disabled={state === 'connecting'}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setMuted(false); session.current?.mute(false) }}
    onPointerUp={() => { setMuted(true); session.current?.mute(true) }} onPointerCancel={() => { setMuted(true); session.current?.mute(true) }}
    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setMuted(false); session.current?.mute(false) } }}
    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { setMuted(true); session.current?.mute(true) } }}>Hold to talk</button>
  const controls = state === 'closed' ? startButton : <>
    {props.mode === 'chat' && !props.dock && state !== 'connecting' && <button type="button" className="ghost" onClick={() => { unlockVoiceAudio(); session.current?.greet() }}>Hear my briefing</button>}
    {props.mode === 'reply' ? holdToTalk : <button type="button" className="ghost" aria-pressed={muted} onClick={() => { const value = !muted; setMuted(value); session.current?.mute(value) }}><Icon name={muted ? 'mic' : 'micOff'} size={16} /><span className="voice-btn-label">{muted ? 'Unmute' : 'Mute mic'}</span></button>}
    <button type="button" className="ghost voice-end" aria-label="End voice" onClick={() => { setError(''); session.current?.stop() }}><Icon name="stop" size={14} /><span className="voice-btn-label">End voice</span></button>
  </>
  /** Typed text goes to the running voice session exactly like speech; with voice off it uses the text path or starts voice. */
  function sendTyped(text: string) {
    const value = text.trim()
    if (!value) return
    setFallback('')
    if (stateRef.current !== 'closed' && stateRef.current !== 'connecting' && session.current?.type(value)) return
    if (stateRef.current === 'connecting') { queued.current = value; return }
    if (props.onTextFallback) { void Promise.resolve(props.onTextFallback(value)).then((sent) => { if (sent === false) setFallback((current) => current || value) }); return }
    queued.current = value
    unlockVoiceAudio(); setEnded(false); start()
  }
  // Only the dock takes typing: every inline host already has its own text field.
  const placeholder = state === 'closed' ? 'Type to your Alter…' : 'Speak or type…'
  const textField = <>
    <label className="sr-only" htmlFor={`voice-text-${props.mode}-${props.targetId ?? 'chat'}`}>Type to your Alter</label>
    <input id={`voice-text-${props.mode}-${props.targetId ?? 'chat'}`} className="voice-input" value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder={placeholder} autoComplete="off" />
    {fallback.trim() && <button className="voice-send" aria-label="Send">Send</button>}
  </>
  const submitTyped = (e: FormEvent) => { e.preventDefault(); sendTyped(fallback) }
  const transcript = (input || output) && <div className="voice-transcript">
    {input && <div className="transcript"><span className="eyebrow">You said</span>{correcting ? <form onSubmit={(e) => { e.preventDefault(); session.current?.correct(input); callbacks.current.onTranscript?.(input); setCorrecting(false) }}><label className="sr-only" htmlFor={`transcript-${props.mode}-${props.targetId ?? 'chat'}`}>Correct transcript</label><textarea id={`transcript-${props.mode}-${props.targetId ?? 'chat'}`} value={input} onChange={(e) => setInput(e.target.value)} /><button disabled={state === 'closed'}>Send correction</button></form> : <button type="button" className="transcript-text" onClick={() => setCorrecting(true)}>{input} <span className="hint">· Tap to correct</span></button>}</div>}
    {output && <div className="transcript is-alter"><span className="eyebrow">Alter said</span><p>{output}</p></div>}
  </div>

  if (props.dock) {
    const caption = (state === 'speaking' || lastSpeaker === 'alter') && output ? output : input
    return <div className={`voice-dock voice-${state}`} aria-label={`${props.mode} voice controls`}>
      {correcting && input && <div className="voice-transcript"><div className="transcript"><span className="eyebrow">You said</span><form onSubmit={(e) => { e.preventDefault(); session.current?.correct(input); callbacks.current.onTranscript?.(input); setCorrecting(false) }}><label className="sr-only" htmlFor={`transcript-${props.mode}-${props.targetId ?? 'chat'}`}>Correct transcript</label><textarea id={`transcript-${props.mode}-${props.targetId ?? 'chat'}`} value={input} onChange={(e) => setInput(e.target.value)} /><div className="actions"><button disabled={state === 'closed'}>Send correction</button><button type="button" className="ghost" onClick={() => setCorrecting(false)}>Cancel</button></div></form></div></div>}
      {(state !== 'closed' || error || moved) && <div className="voice-caption">
        {(state !== 'closed' || needsEnable) && <p role="status" className="voice-status">{state !== 'closed' ? <span>{status}</span> : <span>Your browser needs a tap to play sound</span>}</p>}
        {state === 'closed' && error && <p className="voice-failed" role="alert" title={error}>{error}</p>}
        {moved ? <p className="voice-line is-alter voice-moved"><span aria-hidden="true">✦ </span>{moved.text}</p> : state !== 'closed' && caption && (caption === output
          ? <p className="voice-line is-alter" title={output}><span className="sr-only">Alter said: </span><span>{output}</span></p>
          : <button type="button" className="voice-line" title="Tap to correct" onClick={() => setCorrecting(true)}><span className="sr-only">You said: </span><span>{input}</span><span className="hint"> · Tap to correct</span></button>)}
      </div>}
      <form className="voice-dock-bar" onSubmit={submitTyped}>
        {state !== 'closed' && indicator}
        {textField}
        <div className="voice-dock-actions">{controls}</div>
      </form>
    </div>
  }

  return <div className={`voice-control voice-${state}`} aria-label={`${props.mode} voice controls`}>
    <div className="voice-inline-bar">
      {state !== 'closed' && indicator}
      <div className="actions">{controls}</div>
    </div>
    {state !== 'closed' && <p role="status" className="hint">{status}</p>}
    {transcript}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
