import { useEffect, useState } from 'react'
import { MOCK } from '../api/client'
import { mockTrace } from '../api/mock/traces'
import type { A2ATrace } from '../api/types'
import { TraceView } from './TraceView'

export function LiveTrace({ workspaceId, traceId }: { workspaceId: string; traceId: string }) {
  const [remote, setRemote] = useState<{ id: string; trace?: A2ATrace }>()
  useEffect(() => {
    if (MOCK || import.meta.env.VITE_DEV_AUTH === '1') return
    let stopped = false
    let unsubscribe: (() => void) | undefined
    void import('../firebase').then(({ watchTrace }) => {
      if (!stopped) unsubscribe = watchTrace(workspaceId, traceId, (trace) => setRemote({ id: traceId, trace }), () => setRemote({ id: traceId }))
    }).catch(() => { if (!stopped) setRemote({ id: traceId }) })
    return () => { stopped = true; unsubscribe?.() }
  }, [workspaceId, traceId])
  const trace = MOCK ? mockTrace(traceId) : remote?.id === traceId ? remote.trace : undefined
  return trace ? <TraceView trace={trace} /> : null
}
