import type { Session, LiveServerMessage } from '@google/genai'
import type { LiveMode } from './modes'
import { dispatchLiveTool } from './tools'
import type { ToolContext } from './tools'
import { pcm16Resampler, pcmBase64, decodeAudio } from './audio'
import { connectRelay } from './relay'
import { startVoiceAudio, pauseVoiceAudio, voiceSpeaker } from './voiceAudio'
import { parseNavigation } from '../agent/navigation'

export interface LiveOptions extends ToolContext {
  mode: LiveMode
  context?: string
  greet?: boolean
  inputDeviceId?: string
  outputDeviceId?: string
  /** Listen to this stream (for example, a meeting room's mix) instead of the microphone. */
  inputStream?: MediaStream
  onState: (state: 'connecting' | 'listening' | 'speaking' | 'closed') => void
  onTranscript: (text: string, speaker: 'user' | 'alter', final: boolean) => void
  onError: (message: string) => void
  onLevel?: (level: number) => void
  onFirstSpeech?: () => void
  onUnroutedUtterance?: (text: string) => void
}
let currentSession: LiveSession | undefined
export class LiveSession {
  private options: LiveOptions
  private connection?: Session
  private stream?: MediaStream
  private audio?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private microphone?: AudioWorkletNode
  private silence?: GainNode
  private players = new Set<AudioBufferSourceNode>()
  private playAt = 0
  private deadline?: ReturnType<typeof setTimeout>
  private playbackTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private abort = new AbortController()
  private muted = false
  private input = ''
  private output = ''
  private pending = new Set<string>()
  private handled = new Set<string>()
  private cancelled = new Set<string>()
  private release?: () => void
  private firstSpeech = false
  private toolCalled = false
  private fallbackTimer?: ReturnType<typeof setTimeout>
  private fastKey = ''
  constructor(options: LiveOptions) { this.options = options }
  // The page's conversation can change while voice is open (for example, after a typed message).
  setConversationId(id: string | undefined) { this.options.conversationId = id }
  async start() {
    if (currentSession && currentSession !== this) currentSession.stop()
    // oxlint-disable-next-line typescript/no-this-alias -- Own one microphone across work surfaces.
    currentSession = this
    this.options.onState('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice needs a secure browser connection and microphone access. You can continue by text.')
      this.audio = await startVoiceAudio()
      if (this.stopped) { if (!currentSession) pauseVoiceAudio(this.audio); return }
      if (this.options.outputDeviceId) {
        const audio = this.audio as AudioContext & { setSinkId?: (id: string) => Promise<void> }
        if (!audio.setSinkId) throw new Error('Choose the output device in your operating system audio routing settings.')
        await audio.setSinkId(this.options.outputDeviceId)
      }
      this.stream = this.options.inputStream ? new MediaStream(this.options.inputStream.getAudioTracks().map((track) => track.clone())) : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: this.options.mode !== 'huddle', noiseSuppression: this.options.mode !== 'huddle', autoGainControl: this.options.mode !== 'huddle', channelCount: 1, ...(this.options.inputDeviceId ? { deviceId: { exact: this.options.inputDeviceId } } : {}) }, video: false })
      if (this.stopped) { this.stop(); return }
      let connection: Session
      this.deadline = setTimeout(() => this.stop(), 10 * 60_000)
      if (!import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()) {
        connection = await connectRelay(this.options, (message) => { void this.message(message) }, () => this.stop(), (message) => this.options.onError(message), this.abort.signal)
      } else {
      if (this.options.mode === 'diagram') throw new Error('Design voice editing requires the Vertex relay. Leave VITE_LIVE_TOKEN_BASE empty.')
      const { firebaseIdToken } = await import('../firebase-auth')
      const base = import.meta.env.VITE_LIVE_TOKEN_BASE?.trim() || `${import.meta.env.VITE_API_BASE?.trim() || 'http://localhost:8080/v1'}/live/token`
      const response = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await firebaseIdToken()}` },
        body: JSON.stringify({ mode: this.options.mode, memberId: this.options.mode === 'huddle' ? this.options.targetId : undefined }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined)
        throw new Error(body?.detail?.error?.message ?? body?.error?.message ?? 'Voice is unavailable. Please continue by text.')
      }
      const token: { token: string; model: string; expiresAt: string; sessionId?: string } = await response.json()
      if (token.sessionId && base.endsWith('/token')) this.release = releaser(base.replace(/\/token$/, '/release'), token.sessionId, firebaseIdToken)
      const remaining = Date.parse(token.expiresAt) - Date.now()
      if (!token.token || !token.model || !Number.isFinite(remaining) || remaining <= 0) throw new Error('The voice session expired. Start a new session.')
      if (this.stopped) { this.stop(); return }
      this.deadline = setTimeout(() => this.stop(), Math.min(remaining, 10 * 60_000))
      const { GoogleGenAI } = await import('@google/genai')
      if (this.stopped) return
      const client = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: 'v1alpha' } })
      connection = await client.live.connect({
        model: token.model,
        // The server locks model, tools, audio settings, and system instructions into this single-use token.
        config: {},
        callbacks: {
          onmessage: (message) => { void this.message(message) },
          onerror: () => { if (!this.stopped) this.options.onError('Voice connection interrupted. Please try again or use text.'); this.stop() },
          onclose: () => { if (!this.stopped) this.options.onError('The voice session ended. Start again or continue by text.'); this.stop() },
        },
      })
      }
      if (this.stopped) { connection.close(); return }
      this.connection = connection
      this.source = this.audio.createMediaStreamSource(this.stream)
      await this.audio.audioWorklet.addModule('/mic-worklet.js')
      if (this.stopped) return
      this.microphone = new AudioWorkletNode(this.audio, 'alter-microphone')
      this.silence = this.audio.createGain(); this.silence.gain.value = 0
      const resample = pcm16Resampler(this.audio.sampleRate)
      this.microphone.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.stopped && !this.muted && this.connection) this.connection.sendRealtimeInput({ audio: { data: pcmBase64(resample(event.data)), mimeType: 'audio/pcm;rate=16000' } })
      }
      this.source.connect(this.microphone); this.microphone.connect(this.silence); this.silence.connect(this.audio.destination)
      this.options.onState('listening')
      if (this.options.greet && this.options.mode === 'chat') this.greet()
      if (this.options.targetId && !['diagram', 'huddle'].includes(this.options.mode)) this.connection.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `Open ${this.options.mode} target ID: ${this.options.targetId}. ${this.options.context ?? ''}. ${this.options.draftOnly ? 'Read the question briefly, then draft a reply for on-screen review; do not claim it was sent.' : ''}` }] }], turnComplete: this.options.mode === 'reply' })
    } catch (error) {
      if (!this.stopped) this.options.onError(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings, then try voice again.' : error instanceof Error && error.name === 'NotFoundError' ? 'No microphone was found. Check your input device, then try voice again.' : error instanceof Error ? error.message : 'Could not start voice. Please use text.')
      this.stop()
    }
  }
  private async message(message: LiveServerMessage) {
    if (this.stopped) return
    if (message.toolCall?.functionCalls?.length) {
      this.toolCalled = true
      clearTimeout(this.fallbackTimer)
    }
    for (const id of message.toolCallCancellation?.ids ?? []) this.cancelled.add(id)
    const content = message.serverContent
    if (content?.interrupted) { this.clearPlayback(); this.output = ''; this.options.onState('listening') }
    if (content?.inputTranscription?.text) {
      this.input += content.inputTranscription.text
      this.options.onTranscript(this.input, 'user', false)
      this.fastNavigate(this.input)
    }
    if (content?.outputTranscription?.text) {
      this.output += content.outputTranscription.text
      this.options.onTranscript(this.output, 'alter', false)
    }
    for (const part of content?.modelTurn?.parts ?? []) if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) this.play(part.inlineData.data, part.inlineData.mimeType)
    if (content?.turnComplete) {
      if (this.input) this.options.onTranscript(this.input, 'user', true)
      if (this.output) this.options.onTranscript(this.output, 'alter', true)
      const utterance = this.input.trim()
      if (utterance && !this.toolCalled && this.options.onUnroutedUtterance) {
        clearTimeout(this.fallbackTimer)
        this.fallbackTimer = setTimeout(() => {
          if (!this.stopped) this.options.onUnroutedUtterance?.(utterance)
        }, 500)
      }
      this.input = ''; this.output = ''
      this.toolCalled = false
      this.fastKey = ''
    }
    for (const call of message.toolCall?.functionCalls ?? []) {
      if (!call.id || !call.name || this.cancelled.has(call.id) || this.pending.has(call.id) || this.handled.has(call.id)) continue
      const id = call.id
      this.pending.add(id)
      try {
        const result = await dispatchLiveTool(call.name, call.args ?? {}, { ...this.options, onResult: (value, tool, input) => { if (!this.stopped && !this.cancelled.has(id)) this.options.onResult(value, tool, input) } })
        if (call.name === 'alter_chat' && result && typeof result === 'object' && 'conversationId' in result && typeof result.conversationId === 'string') this.options.conversationId = result.conversationId
        if (!this.stopped && !this.cancelled.has(id)) this.connection?.sendToolResponse({ functionResponses: [{ id, name: call.name, response: { result } }] })
      } catch (error) {
        if (!this.stopped && !this.cancelled.has(id)) {
          const message = error instanceof Error ? error.message : 'The request failed. Please try again.'
          this.options.onError(message)
          this.connection?.sendToolResponse({ functionResponses: [{ id, name: call.name, response: { error: message } }] })
        }
      } finally { this.pending.delete(id); this.handled.add(id) }
    }
  }
  // Sub-100ms path: as soon as the streaming transcript is an unambiguous
  // "open X", move the view. The model's later tool call is then deduplicated.
  private fastNavigate(text: string) {
    if (this.options.mode !== 'chat' || !this.options.onNavigate) return
    const intent = parseNavigation(text)
    if (intent?.confidence !== 'high') return
    const key = `${intent.action.screen}|${intent.action.targetElementId ?? ''}`
    if (key === this.fastKey) return
    this.fastKey = key
    this.options.onNavigate(intent.action, 'voice-fast')
  }
  private play(data: string, mimeType: string) {
    if (!this.audio || this.stopped) return
    const rate = Number(mimeType.match(/rate=(\d+)/)?.[1] ?? 24000)
    const buffer = decodeAudio(data, this.audio, rate)
    const samples = buffer.getChannelData(0)
    let energy = 0
    for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i]
    this.options.onLevel?.(Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 5))
    const node = this.audio.createBufferSource(); node.buffer = buffer; node.connect(voiceSpeaker())
    this.playAt = Math.max(this.playAt, this.audio.currentTime)
    node.start(this.playAt); this.playAt += buffer.duration; this.players.add(node)
    if (!this.firstSpeech) { this.firstSpeech = true; this.options.onFirstSpeech?.() }
    node.onended = () => { this.players.delete(node); node.disconnect() }
    this.options.onState('speaking')
    clearTimeout(this.playbackTimer)
    this.playbackTimer = setTimeout(() => { if (!this.stopped) this.options.onState('listening') }, Math.max(0, (this.playAt - this.audio.currentTime) * 1000))
  }
  private clearPlayback() { for (const player of this.players) { try { player.stop() } catch { /* Playback already ended. */ } }; this.players.clear(); this.playAt = 0; clearTimeout(this.playbackTimer); this.options.onLevel?.(0) }
  mute(value: boolean) { this.muted = value; if (value) this.connection?.sendRealtimeInput({ audioStreamEnd: true }) }
  greet() {
    if (this.stopped || this.options.mode !== 'chat') return
    this.connection?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Start by saying hello to me by my first name and welcoming me to the day, in one short warm sentence. Then bring me into the work already moving. If the verified agenda has two upcoming items, link them in order; otherwise mention the next item or saved work. Ask which thread we should pick up. Only mention pending decisions if the context lists them. Do not introduce the product or list capabilities.' }] }], turnComplete: true })
  }
  /** Typed text takes the same path as speech: fast navigation, the transcript, the model's tools and the unrouted fallback. */
  type(text: string) {
    const value = text.trim()
    if (this.stopped || !value || !this.connection) return false
    this.clearPlayback()
    this.input = value
    this.toolCalled = false
    this.options.onTranscript(value, 'user', false)
    this.fastNavigate(value)
    this.connection.sendClientContent({ turns: [{ role: 'user', parts: [{ text: value }] }], turnComplete: true })
    return true
  }
  /** A status update from the app (the Computer page) for the Alter to say in a sentence. */
  announce(text: string) {
    if (this.stopped || !text.trim()) return
    this.connection?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `[App update, not a request from me — do not call tools] ${text.trim()} Tell me this in one short sentence.` }] }], turnComplete: true })
  }
  correct(text: string) { if (!this.stopped && text.trim()) this.connection?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `Correction to my last transcript: ${text.trim()}` }] }], turnComplete: true }) }
  stop() {
    if (currentSession === this) currentSession = undefined
    const alreadyStopped = this.stopped
    if (!alreadyStopped) {
      if (this.input) this.options.onTranscript(this.input, 'user', true)
      if (this.output) this.options.onTranscript(this.output, 'alter', true)
      this.input = ''; this.output = ''
    }
    this.stopped = true; clearTimeout(this.deadline); clearTimeout(this.playbackTimer); clearTimeout(this.fallbackTimer)
    this.abort.abort()
    this.clearPlayback(); const connection = this.connection; this.connection = undefined; connection?.close()
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined
    this.source?.disconnect(); this.microphone?.disconnect(); this.silence?.disconnect()
    this.source = undefined; this.microphone = undefined; this.silence = undefined
    if (this.audio && !currentSession) pauseVoiceAudio(this.audio)
    this.audio = undefined
    const release = this.release; this.release = undefined; release?.()
    if (!alreadyStopped) this.options.onState('closed')
  }
}
// Best effort: frees the per-user voice lock early. The server lock still expires on its own.
function releaser(url: string, sessionId: string, idToken: () => Promise<string>) {
  return () => { void idToken().then((token) => fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId }) })).catch(() => undefined) }
}
