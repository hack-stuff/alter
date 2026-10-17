import { AlterAvatar } from './AlterAvatar'
import type { AlterVoiceState } from './AlterAvatar'

const STATES: { state?: AlterVoiceState; label: string }[] = [
  { label: 'Ready' },
  { state: 'listening', label: 'Listening' },
  { state: 'speaking', label: 'Speaking' },
  { state: 'muted', label: 'Muted' },
]

/** The four voice states an Alter shows, on the Join screen. */
export function AlterAvatarPreview({ name = 'Alter' }: { name?: string }) {
  return <section className="aap" aria-labelledby="aap-title">
    <h3 id="aap-title">How your Alter looks in voice</h3>
    <ul>
    {STATES.map(({ state, label }) => <li key={label}>
      <AlterAvatar name={name} variant="alter-only" size="md" voiceState={state} />
      <small>{label}</small>
    </li>)}
    </ul>
  </section>
}
