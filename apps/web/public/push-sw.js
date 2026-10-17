/* Imported by the PWA worker. No credentials or raw audio are stored here. */
self.addEventListener('push', (event) => {
  let data
  try { const payload = event.data?.json(); data = payload?.data ?? payload } catch { return }
  if (!data?.title || !data?.eventId) return
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body ?? '', tag: data.eventId, renotify: false,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { path: data.path ?? '/', workspaceId: data.workspaceId },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.path ?? '/', self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === target.origin)
    if (existing) { await existing.navigate(target.href); return existing.focus() }
    return self.clients.openWindow(target.href)
  }))
})
