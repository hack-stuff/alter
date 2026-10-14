import { useEffect, useRef, useState } from 'react'
import { LiveSession } from '../live/session'
import type { LiveMode } from '../live/modes'

interface Props {
  mode: LiveMode
  targetId?: string
  conversationId?: string
  context?: string
  draftOnly?: boolean
  onTranscript?: (text: string) => void
  onResult: (result: unknown, tool: string, input: string) => void
  onSpeaking?: (speaking: boolean) => void
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
  useEffect(() => () => { session.current?.stop() }, [])
  function start() {
    if (state !== 'closed') return
    setError(''); setInput(''); setOutput(''); setMuted(props.mode === 'reply')
    const instance = new LiveSession({
      ...props,
      onResult: (result, tool, text) => { if (tool === 'respond_escalation' && props.draftOnly) callbacks.current.onTranscript?.(text); callbacks.current.onResult(result, tool, text) },
      onState: (value) => { setState(value); callbacks.current.onSpeaking?.(value === 'speaking') },
      onTranscript: (text, speaker, final) => { if (speaker === 'user') { setInput(text); if (final && props.draftOnly) callbacks.current.onTranscript?.(text) } else setOutput(text) },
      onError: setError,
    })
    session.current = instance; if (props.mode === 'reply') instance.mute(true); void instance.start()
  }
  return <div className={`voice-control voice-${state}`} aria-label={`${props.mode} voice controls`}>
    <div className="actions">{state === 'closed' ? <button type="button" onClick={start}>🎙 {props.mode === 'revise' ? 'Revise by voice' : props.mode === 'reply' ? 'Speak your reply' : props.mode === 'huddle' ? 'Talk to this Alter' : 'Talk to your Alter'}</button> : <>
      <button type="button" onClick={() => { session.current?.stop() }}>End voice</button>
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
