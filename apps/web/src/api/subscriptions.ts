// Firebase sign-in and workspace storage are independent. Local SQLite runs
// still read updates from the API even when the caller uses Firebase Auth.
export function loadSubscriptions() {
  return import.meta.env.VITE_DEV_AUTH === '1' || import.meta.env.VITE_UPDATES_SOURCE === 'api'
    ? import('./polling')
    : import('../firebase')
}
