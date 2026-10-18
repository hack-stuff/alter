// The desktop helper runs on the user's own computer (apps/desktop-helper). This page
// relays screenshots to the API and the chosen steps back to the helper.
import { httpCall, MOCK } from './client'

export const HELPER_URL = 'http://127.0.0.1:47613/v1'
const TOKEN = 'alter.desktop.token'

export type HelperPlatform = 'windows' | 'macos' | 'linux'
export interface HelperStatus {
  app: string
  version: string
  platform: HelperPlatform
  paired: boolean
  paused: boolean
  askEveryStep: boolean
  confirmations: boolean
  screen?: { width: number; height: number }
}
export type HelperAction = { action: string } & Record<string, unknown>
export interface DesktopPlanStep { id: string; name: string; label: string; confirm: boolean; reason: string; actions: HelperAction[] }
export interface DesktopStepResult { id: string; ok: boolean; error?: string; acknowledged?: boolean }
export interface DesktopTurn { done: boolean; message: string; steps: DesktopPlanStep[]; step: number }
export interface Screenshot { image: string; mimeType: 'image/jpeg' | 'image/png'; width: number; height: number }

export class HelperError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code }
}

function token() {
  try { return localStorage.getItem(TOKEN) ?? '' } catch { return '' }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const auth = token()
  let response: Response
  try {
    response = await fetch(HELPER_URL + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new HelperError('The desktop helper isn’t running on this computer.', 0, 'UNREACHABLE')
  } finally { clearTimeout(timer) }
  const data = await response.json().catch(() => undefined)
  if (!response.ok) throw new HelperError(data?.error?.message ?? `The helper refused that (${response.status}).`, response.status, data?.error?.code ?? '')
  return data as T
}

export const helper = {
  status: () => call<HelperStatus>('GET', '/status', undefined, 1500),
  async pair(code: string) {
    const result = await call<{ token: string }>('POST', '/pair', { code: code.replace(/\D/g, '') })
    localStorage.setItem(TOKEN, result.token)
  },
  /** Asks the person at the computer to allow this page in a helper window; no code to type. */
  async connect() {
    const result = await call<{ token: string }>('POST', '/pair/request', {}, 130_000)
    localStorage.setItem(TOKEN, result.token)
  },
  screenshot: () => call<Screenshot>('POST', '/screenshot', {}, 20_000),
  // A confirmed step waits for the person to answer the helper's window.
  act: (actions: HelperAction[], confirm: boolean, summary: string) => call<{ ok: true }>('POST', '/act', { actions, confirm, summary }, confirm ? 150_000 : 60_000),
  resume: () => call<{ ok: true }>('POST', '/resume', {}),
  async unpair() {
    await call('POST', '/unpair', {}).catch(() => undefined)
    localStorage.removeItem(TOKEN)
  },
}

export const desktopApi = {
  start: (goal: string, platform: string) => MOCK
    ? Promise.reject(new Error('Desktop control needs the connected backend.'))
    : httpCall<{ sessionId: string; maxSteps: number }>('POST', '/desktop/sessions', { goal, platform }),
  step: (id: string, shot: Screenshot, results: DesktopStepResult[]) =>
    httpCall<DesktopTurn>('POST', `/desktop/sessions/${id}/step`, { screenshot: shot.image, mimeType: shot.mimeType, results }),
  stop: (id: string) => httpCall<{ ok: true }>('POST', `/desktop/sessions/${id}/stop`),
}

// Chat and voice hand a task to the Computer screen, which may not be mounted yet.
const REQUEST = 'alter.desktop.request'
export function requestDesktopTask(goal: string) {
  try { sessionStorage.setItem(REQUEST, goal) } catch { /* the event below still carries it */ }
  window.dispatchEvent(new CustomEvent('alter:desktop-task', { detail: goal }))
}
export function takeDesktopRequest(): string | undefined {
  try {
    const goal = sessionStorage.getItem(REQUEST) ?? undefined
    sessionStorage.removeItem(REQUEST)
    return goal
  } catch { return undefined }
}

// While a task runs, the page also listens to what the owner says ("allow", "skip", "stop").
const VOICE = 'alter:desktop-voice'
export function sendDesktopVoice(text: string) { window.dispatchEvent(new CustomEvent(VOICE, { detail: text })) }
export function onDesktopVoice(listener: (text: string) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(VOICE, handler)
  return () => window.removeEventListener(VOICE, handler)
}
export type VoiceCommand = 'allow' | 'skip' | 'stop'
/** Short spoken answers only; a longer sentence is a new request, not a command. */
export function voiceCommand(text: string): VoiceCommand | undefined {
  const value = text.trim().toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!value || value.split(' ').length > 5) return undefined
  if (/\b(?:don'?t|do not|never)\b/.test(value)) return /\b(?:allow|do it|go ahead)\b/.test(value) ? 'stop' : undefined
  if (/\b(?:stop|cancel|abort|halt|enough|end (?:the )?task)\b/.test(value)) return 'stop'
  if (/\bskip\b/.test(value)) return 'skip'
  if (/^(?:yes|yeah|yep|ok|okay|sure|allow|allowed|approve|approved|confirm|go ahead|do it|continue|proceed)\b/.test(value)) return 'allow'
  return undefined
}
