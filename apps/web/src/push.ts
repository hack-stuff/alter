import { getMessaging, getToken, isSupported, deleteToken } from 'firebase/messaging'
import { firebaseApp } from './firebase-auth'
import { httpCall } from './api/client'

export async function enablePush(): Promise<void> {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim()
  if (!vapidKey) throw new Error('Push notifications need the project’s Web Push certificate configured. In-app notifications are available now.')
  if (!await isSupported()) throw new Error('This browser does not support push. On iPhone, open the installed app from the Home Screen on iOS 16.4 or later.')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted. You can still check updates inside Alter.')
  const registration = await navigator.serviceWorker.ready
  const token = await getToken(getMessaging(firebaseApp()), { vapidKey, serviceWorkerRegistration: registration })
  const result = await httpCall<{ id: string }>('POST', '/push/devices', { token })
  localStorage.setItem('alter.push.device', result.id)
}

export async function disablePush(): Promise<void> {
  const id = localStorage.getItem('alter.push.device')
  if (id) await httpCall('DELETE', '/push/devices/' + id)
  if (await isSupported()) await deleteToken(getMessaging(firebaseApp()))
  localStorage.removeItem('alter.push.device')
}
