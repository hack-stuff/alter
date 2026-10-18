import type { Session, LiveServerMessage } from '@google/genai'
import { httpCall } from '../api/client'
import type { LiveOptions } from './session'

export async function connectRelay(options: LiveOptions, onMessage: (message: LiveServerMessage) => void, onClose: () => void, onError: (message: string, retryable?: boolean) => void, signal?: AbortSignal): Promise<Session> {
  const result = await httpCall<{ ticket: string; socketPath: string }>('POST', '/live/sessions', {
    mode: options.mode, targetId: options.targetId, conversationId: options.conversationId, meetingId: options.meetingId,
  })
  if (signal?.aborted) throw new Error('Voice was stopped.')
  const apiUrl = new URL(import.meta.env.VITE_API_BASE?.trim() || 'http://localhost:8080/v1', location.href)
  const socketUrl = new URL(result.socketPath, apiUrl.origin)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(socketUrl)
  signal?.addEventListener('abort', () => socket.close(), { once: true })
  const send = (value: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Voice connection timed out. Please retry.')) }, 40000)
    socket.onopen = () => send({ ticket: result.ticket })
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.error) { onError(data.error, data.retryable === true); clearTimeout(timeout); reject(new Error(data.error)); socket.close(); return }
      if (data.ready) { clearTimeout(timeout); resolve(); return }
      onMessage(data as LiveServerMessage)
    }
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('Voice connection interrupted. Please retry.')); onClose() }
    socket.onclose = () => { clearTimeout(timeout); reject(new Error('Voice connection closed. Please retry.')); onClose() }
  })
  return {
    sendRealtimeInput: (value: { audio?: { data: string }; audioStreamEnd?: boolean }) => send(value.audio ? { audio: value.audio.data } : { audioStreamEnd: true }),
    sendClientContent: (value: { turns?: { parts?: { text?: string }[] }[] }) => send({ text: value.turns?.flatMap((t) => t.parts?.map((p) => p.text ?? '') ?? []).join('\n') ?? '' }),
    sendToolResponse: (value: { functionResponses: unknown[] }) => send(value),
    close: () => socket.close(),
  } as unknown as Session
}
