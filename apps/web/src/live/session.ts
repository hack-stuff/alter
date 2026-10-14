import type { Session, LiveServerMessage } from '@google/genai'
import type { LiveMode } from './modes'
import { dispatchLiveTool } from './tools'
import type { ToolContext } from './tools'
import { pcm16, pcmBase64, decodeAudio } from './audio'

export interface LiveOptions extends ToolContext {
  mode: LiveMode
  context?: string
  onState: (state: 'connecting' | 'listening' | 'speaking' | 'closed') => void
  onTranscript: (text: string, speaker: 'user' | 'alter', final: boolean) => void
  onError: (message: string) => void
}
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
  private muted = false
  private input = ''
  private output = ''
  private pending = new Set<string>()
  private handled = new Set<string>()
  private cancelled = new Set<string>()
  constructor(options: LiveOptions) { this.options = options }
  async start() {
    this.options.onState('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice needs a secure browser connection and microphone access. You can continue by text.')
      this.audio = new AudioContext()
      await this.audio.resume()
      if (this.stopped) return
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false })
      if (this.stopped) { this.stop(); return }
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
      const token: { token: string; model: string; expiresAt: string } = await response.json()
      const remaining = Date.parse(token.expiresAt) - Date.now()
      if (!token.token || !token.model || !Number.isFinite(remaining) || remaining <= 0) throw new Error('The voice session expired. Start a new session.')
      if (this.stopped) { this.stop(); return }
      this.deadline = setTimeout(() => this.stop(), Math.min(remaining, 10 * 60_000))
      const { GoogleGenAI } = await import('@google/genai')
      if (this.stopped) return
      const client = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: 'v1alpha' } })
      const connection = await client.live.connect({
        model: token.model,
        // The server locks model, tools, audio settings, and system instructions into this single-use token.
        config: {},
        callbacks: {
          onmessage: (message) => { void this.message(message) },
          onerror: () => { if (!this.stopped) this.options.onError('Voice connection interrupted. Please try again or use text.'); this.stop() },
          onclose: () => this.stop(),
        },
      })
      if (this.stopped) { connection.close(); return }
      this.connection = connection
      this.source = this.audio.createMediaStreamSource(this.stream)
      await this.audio.audioWorklet.addModule('/mic-worklet.js')
      if (this.stopped) return
      this.microphone = new AudioWorkletNode(this.audio, 'alter-microphone')
      this.silence = this.audio.createGain(); this.silence.gain.value = 0
      this.microphone.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.stopped && !this.muted && this.connection && this.audio) this.connection.sendRealtimeInput({ audio: { data: pcmBase64(pcm16(event.data, this.audio.sampleRate)), mimeType: 'audio/pcm;rate=16000' } })
      }
      this.source.connect(this.microphone); this.microphone.connect(this.silence); this.silence.connect(this.audio.destination)
      this.options.onState('listening')
      if (this.options.targetId) this.connection.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `Open ${this.options.mode} target ID: ${this.options.targetId}. ${this.options.context ?? ''}. ${this.options.draftOnly ? 'Read the question briefly, then draft a reply for on-screen review; do not claim it was sent.' : ''}` }] }], turnComplete: this.options.mode === 'reply' })
    } catch (error) {
      if (!this.stopped) this.options.onError(error instanceof Error ? error.message : 'Could not start voice. Please use text.')
      this.stop()
    }
  }
  private async message(message: LiveServerMessage) {
    if (this.stopped) return
    for (const id of message.toolCallCancellation?.ids ?? []) this.cancelled.add(id)
    const content = message.serverContent
    if (content?.interrupted) { this.clearPlayback(); this.output = ''; this.options.onState('listening') }
    if (content?.inputTranscription?.text) {
      this.input += content.inputTranscription.text
      this.options.onTranscript(this.input, 'user', !!content.inputTranscription.finished)
    }
    if (content?.outputTranscription?.text) {
      this.output += content.outputTranscription.text
      this.options.onTranscript(this.output, 'alter', !!content.outputTranscription.finished)
    }
    for (const part of content?.modelTurn?.parts ?? []) if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) this.play(part.inlineData.data, part.inlineData.mimeType)
    if (content?.turnComplete) {
      if (this.input) this.options.onTranscript(this.input, 'user', true)
      if (this.output) this.options.onTranscript(this.output, 'alter', true)
      this.input = ''; this.output = ''
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
        if (!this.stopped && !this.cancelled.has(id)) this.connection?.sendToolResponse({ functionResponses: [{ id, name: call.name, response: { error: error instanceof Error ? error.message : 'The request failed. Ask the user to retry.' } }] })
      } finally { this.pending.delete(id); this.handled.add(id) }
    }
  }
  private play(data: string, mimeType: string) {
    if (!this.audio || this.stopped) return
    const rate = Number(mimeType.match(/rate=(\d+)/)?.[1] ?? 24000)
    const buffer = decodeAudio(data, this.audio, rate)
    const node = this.audio.createBufferSource(); node.buffer = buffer; node.connect(this.audio.destination)
    this.playAt = Math.max(this.playAt, this.audio.currentTime)
    node.start(this.playAt); this.playAt += buffer.duration; this.players.add(node)
    node.onended = () => { this.players.delete(node); node.disconnect() }
    this.options.onState('speaking')
    clearTimeout(this.playbackTimer)
    this.playbackTimer = setTimeout(() => { if (!this.stopped) this.options.onState('listening') }, Math.max(0, (this.playAt - this.audio.currentTime) * 1000))
  }
  private clearPlayback() { for (const player of this.players) { try { player.stop() } catch { /* Playback already ended. */ } }; this.players.clear(); this.playAt = 0; clearTimeout(this.playbackTimer) }
  mute(value: boolean) { this.muted = value; if (value) this.connection?.sendRealtimeInput({ audioStreamEnd: true }) }
  correct(text: string) { if (!this.stopped && text.trim()) this.connection?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `Correction to my last transcript: ${text.trim()}` }] }], turnComplete: true }) }
  stop() {
    const alreadyStopped = this.stopped
    this.stopped = true; clearTimeout(this.deadline); clearTimeout(this.playbackTimer)
    this.clearPlayback(); const connection = this.connection; this.connection = undefined; connection?.close()
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined
    this.source?.disconnect(); this.microphone?.disconnect(); this.silence?.disconnect()
    this.source = undefined; this.microphone = undefined; this.silence = undefined
    if (this.audio && this.audio.state !== 'closed') void this.audio.close()
    this.audio = undefined
    if (!alreadyStopped) this.options.onState('closed')
  }
}
