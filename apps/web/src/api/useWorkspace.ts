import { useEffect, useState, useSyncExternalStore } from 'react'
import { MOCK } from './client'
import { loadSubscriptions } from './subscriptions'
import { mockSnapshot, subscribeMock } from './mock/workspace'
import { emptyWorkspace } from './types'
import type { JoinResult, WorkspaceData } from './types'

const noSubscription = () => () => {}
export function useWorkspace(join?: JoinResult) {
  const mockData = useSyncExternalStore(MOCK ? subscribeMock : noSubscription, MOCK ? mockSnapshot : () => emptyWorkspace)
  const [remote, setRemote] = useState<{ workspaceId?: string; data: WorkspaceData; error: string }>({ data: emptyWorkspace, error: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!join || MOCK) return
    let stopped = false
    let unsubscribe: (() => void) | undefined
    void loadSubscriptions().then(({ watchWorkspace }) => {
      if (stopped) return
      unsubscribe = watchWorkspace(join, (data) => setRemote({ workspaceId: join.workspaceId, data, error: '' }), () => setRemote((state) => ({ ...state, workspaceId: join.workspaceId, error: 'Your Alter’s updates are unavailable. Check your connection and try again.' })))
    }).catch(() => { if (!stopped) setRemote({ workspaceId: join.workspaceId, data: emptyWorkspace, error: 'Could not load your Alter. Please try again.' }) })
    return () => { stopped = true; unsubscribe?.() }
  }, [join, retry])
  const current = remote.workspaceId === join?.workspaceId
  return { data: MOCK ? mockData : current ? remote.data : emptyWorkspace, error: current ? remote.error : '', refresh: () => setRetry((value) => value + 1) }
}
