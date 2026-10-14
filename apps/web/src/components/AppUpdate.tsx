import { useRegisterSW } from 'virtual:pwa-register/react'

export function AppUpdate() {
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW()
  if (!ready) return null
  return <div className="update-notice" role="status"><p>An app update is ready. Finish any edits before reloading.</p><div className="actions"><button onClick={() => void updateServiceWorker(true)}>Reload app</button><button onClick={() => setReady(false)}>Later</button></div></div>
}
