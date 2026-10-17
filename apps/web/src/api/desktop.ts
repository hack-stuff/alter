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
