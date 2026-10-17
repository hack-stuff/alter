import { initializeApp, getApps } from 'firebase/app'
import { getAuth, signInAnonymously, connectAuthEmulator, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'

let signedIn: Promise<User> | undefined
let emulatorConnected = false
export function firebaseApp() {
  const configText = import.meta.env.VITE_FIREBASE_CONFIG
  if (!configText) throw new Error('Sign-in is unavailable. Please try again once the workspace is configured.')
  const config = JSON.parse(configText)
  if (!config.apiKey || !config.projectId || !config.appId) throw new Error('Workspace sign-in configuration is incomplete.')
  return getApps()[0] ?? initializeApp(config)
}
export async function firebaseIdToken(): Promise<string> {
  const auth = getAuth(firebaseApp())
  if (!emulatorConnected) {
    emulatorConnected = true
    const host = import.meta.env.VITE_AUTH_EMULATOR_HOST
    if (host) connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true })
  }
  await auth.authStateReady()
  if (auth.currentUser) return auth.currentUser.getIdToken()
  signedIn ??= signInAnonymously(auth).then(({ user }) => user)
  try { const user = await signedIn; return await user.getIdToken() }
  finally { signedIn = undefined }
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(getAuth(firebaseApp()))
  signedIn = undefined
}
