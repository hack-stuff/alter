// The docked voice bar shares its state and controls here, so other surfaces (the Computer
// page and its floating panel) can show and drive the same voice session.
export type DockVoiceState = 'connecting' | 'listening' | 'speaking' | 'closed'
export interface DockSnapshot { state: DockVoiceState; muted: boolean }
interface DockControls { start: () => void; end: () => void; mute: (value: boolean) => void; announce: (text: string) => void }

let snapshot: DockSnapshot = { state: 'closed', muted: false }
let controls: DockControls | undefined
const listeners = new Set<(value: DockSnapshot) => void>()

export const voiceDock = {
  get: () => snapshot,
  publish(value: DockSnapshot) {
    if (value.state === snapshot.state && value.muted === snapshot.muted) return
    snapshot = value
    listeners.forEach((listener) => listener(value))
  },
  subscribe(listener: (value: DockSnapshot) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  attach(value: DockControls) {
    controls = value
    return () => { if (controls === value) controls = undefined }
  },
  start: () => controls?.start(),
  end: () => controls?.end(),
  mute: (value: boolean) => controls?.mute(value),
  /** Has the Alter say a short update out loud, when voice is on. */
  announce: (text: string) => { if (snapshot.state !== 'closed') controls?.announce(text) },
}
