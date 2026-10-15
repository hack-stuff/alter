// Local integration uses authenticated API snapshots instead of a Firestore emulator.
import { httpCall } from './client'
import type { WorkspaceData, ProgressEvent, Message } from './types'

function poll<T>(load: () => Promise<T>, next: (data: T) => void, failed: (error: Error) => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  async function update() {
    try { const result = await load(); if (!stopped) next(result) }
    catch (error) { if (!stopped) failed(error instanceof Error ? error : new Error('Updates unavailable.')) }
    if (!stopped) timer = setTimeout(() => void update(), 750)
  }
  void update()
  return () => { stopped = true; clearTimeout(timer) }
}
export function watchWorkspace(_join: unknown, next: (data: WorkspaceData) => void, failed: (error: Error) => void) {
  return poll(() => httpCall<WorkspaceData>('GET', '/workspace'), next, failed)
}
export function watchTrace(_wid: string, id: string, next: (trace: WorkspaceData['traces'][number] | undefined) => void, failed: (error: Error) => void) {
  return poll(async () => (await httpCall<WorkspaceData>('GET', '/workspace')).traces.find((trace) => trace.id === id), next, failed)
}
export function watchEvents(_wid: string, id: string, next: (events: ProgressEvent[]) => void, failed: (error: Error) => void) {
  return poll(async () => (await httpCall<{ events: ProgressEvent[] }>('GET', `/conversations/${id}`)).events, next, failed)
}
export function watchMessages(_wid: string, id: string, next: (messages: Message[]) => void, failed: (error: Error) => void) {
  return poll(async () => (await httpCall<{ messages: Message[] }>('GET', `/conversations/${id}`)).messages, next, failed)
}
