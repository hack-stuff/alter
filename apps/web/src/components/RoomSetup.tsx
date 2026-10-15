import { useState } from 'react'
import { meetingApi } from '../api/meetings'

export function RoomSetup({ meetingId, memberId }: { meetingId: string; memberId: string }) {
  const [access, setAccess] = useState<{ token: string; expiresAt: string }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <details className="room-setup"><summary>Connect the Meet recording rig</summary><p className="hint">Room access lets the rig capture this meeting and ask the represented Alter. Your approval controls stay on your phone.</p><button disabled={busy} onClick={() => { setBusy(true); setError(''); void meetingApi.room(meetingId).then(setAccess).catch((e) => setError(e.message)).finally(() => setBusy(false)) }}>Generate 20-minute room access</button>{access && <><label>Room access<input type="password" value={access.token} readOnly autoComplete="off" onFocus={(e) => e.target.select()} /></label><button onClick={() => { void navigator.clipboard.writeText(access.token).catch(() => setError('Select the room access field and copy it manually.')) }}>Copy room access</button><a href={`?kiosk=1&tile=${memberId}&meeting=${meetingId}`} target="_blank" rel="noreferrer">Open the recording rig ↗</a><p className="hint">Expires {new Date(access.expiresAt).toLocaleTimeString()}. Enter it in the rig; keep it outside the recording.</p></>}{error && <p role="alert" className="error">{error}</p>}</details>
}
