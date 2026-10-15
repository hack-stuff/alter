import { getFirestore, connectFirestoreEmulator, collection, doc, onSnapshot, query, where, or, Timestamp } from 'firebase/firestore'
import type { Unsubscribe, Firestore } from 'firebase/firestore'
import { firebaseApp, firebaseIdToken } from './firebase-auth'
import { emptyWorkspace } from './api/types'
import type { WorkspaceData, JoinResult, Workspace, ProgressEvent, Receipt } from './api/types'

function normalize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  return value
}
let database: Firestore | undefined
function services() {
  if (!database) {
    database = getFirestore(firebaseApp())
    const hostAndPort = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST
    if (hostAndPort) { const [host, port] = hostAndPort.split(':'); connectFirestoreEmulator(database, host, Number(port)) }
  }
  return { db: database }
}

export function watchWorkspace(join: JoinResult, next: (data: WorkspaceData) => void, failed: (error: Error) => void): () => void {
  const subscriptions: Unsubscribe[] = []
  const receiptSubscriptions = new Map<string, Unsubscribe>()
  const receipts = new Map<string, Receipt>()
  let stopped = false
  let state: WorkspaceData = structuredClone(emptyWorkspace)
  const emit = () => { if (!stopped) next({ ...state }) }
  const fail = (error: Error) => { if (!stopped) failed(error) }
  void firebaseIdToken().then(() => {
    if (stopped) return
    const { db } = services()
    const base = `workspaces/${join.workspaceId}`
    subscriptions.push(onSnapshot(doc(db, base), (snapshot) => {
      state = { ...state, workspace: snapshot.exists() ? normalize(snapshot.data()) as Workspace : undefined }; emit()
    }, fail))
    const collections: { key: keyof WorkspaceData; path: string; filter?: [string, '==' | 'array-contains', string] }[] = [
      { key: 'members', path: 'members' },
      { key: 'approvals', path: 'approvals', filter: ['owner', '==', join.memberId] },
      { key: 'escalations', path: 'escalations', filter: ['owner', '==', join.memberId] },
      { key: 'activity', path: 'activity', filter: ['visibleTo', 'array-contains', join.memberId] },
      { key: 'memories', path: 'memories', filter: ['owner', '==', join.memberId] },
      { key: 'rules', path: `rules/${join.memberId}/items` },
      { key: 'inbox', path: `inbox/${join.memberId}/messages` },
      { key: 'traces', path: 'a2aTraces' },
      { key: 'meetings', path: 'meetings', filter: ['owner', '==', join.memberId] },
      { key: 'notifications', path: 'notifications', filter: ['owner', '==', join.memberId] },
    ]
    for (const { key, path, filter } of collections) {
      const ref = collection(db, `${base}/${path}`)
      const source = key === 'traces' ? query(ref, or(where('from', '==', join.memberId), where('to', '==', join.memberId))) : filter ? query(ref, where(...filter)) : ref
      subscriptions.push(onSnapshot(source, (snapshot) => {
        const rows = snapshot.docs.map((entry) => ({ ...normalize(entry.data()) as object, id: entry.id }))
        state = { ...state, [key]: rows }
        if (key === 'activity') {
          const ids = new Set(state.activity.map((item) => item.receiptId))
          for (const [id, off] of receiptSubscriptions) if (!ids.has(id)) { off(); receiptSubscriptions.delete(id); receipts.delete(id) }
          for (const id of ids) if (!receiptSubscriptions.has(id)) {
            receiptSubscriptions.set(id, onSnapshot(doc(db, `${base}/receipts/${id}`), (receipt) => {
              if (receipt.exists()) receipts.set(id, { ...normalize(receipt.data()) as object, id } as Receipt)
              else receipts.delete(id)
              state = { ...state, receipts: [...receipts.values()] }; emit()
            }, fail))
          }
          state = { ...state, receipts: [...receipts.values()] }
        }
        emit()
      }, fail))
    }
  }).catch(fail)
  return () => { stopped = true; subscriptions.forEach((off) => off()); receiptSubscriptions.forEach((off) => off()) }
}
export function watchTrace(workspaceId: string, traceId: string, next: (trace: WorkspaceData['traces'][number] | undefined) => void, failed: (error: Error) => void) {
  const { db } = services()
  return onSnapshot(doc(db, `workspaces/${workspaceId}/a2aTraces/${traceId}`), (snapshot) => next(snapshot.exists() ? { ...normalize(snapshot.data()) as object, id: snapshot.id } as WorkspaceData['traces'][number] : undefined), failed)
}
export function watchEvents(workspaceId: string, conversationId: string, next: (events: ProgressEvent[]) => void, failed: (error: Error) => void) {
  const { db } = services()
  return onSnapshot(collection(db, `workspaces/${workspaceId}/conversations/${conversationId}/events`), (snapshot) => next(snapshot.docs.map((entry) => ({ ...normalize(entry.data()) as object, id: entry.id }) as ProgressEvent)), failed)
}

export function watchMessages(workspaceId: string, conversationId: string, next: (messages: import('./api/types').Message[]) => void, failed: (error: Error) => void) {
  const { db } = services()
  return onSnapshot(collection(db, `workspaces/${workspaceId}/conversations/${conversationId}/messages`), (snapshot) => {
    const messages = snapshot.docs.map((entry) => normalize(entry.data()) as import('./api/types').Message)
    next(messages.sort((a, b) => a.ts.localeCompare(b.ts)))
  }, failed)
}
