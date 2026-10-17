import { useState } from 'react'
import { AlterAvatar } from './AlterAvatar'

// The seeded demo team, used as the room the judge joins — so typing "Dev"
// or "Siddhi" demonstrates collision detection live.
const ROOM = ['Dev', 'Kani', 'Sahil', 'Siddhi']

/** Preview of the Paired Totem avatar system, embedded at the bottom of the Join screen. */
export function AlterAvatarPreview() {
  const [judgeName, setJudgeName] = useState('')

  return (
    <details className="aap">
      <summary>Preview: the avatar system</summary>
      <div className="aap-grid">
        <div>
          <AlterAvatar name="Dev" role="Product Lead" variant="paired-offset" size="md" />
          <small>Dev</small>
        </div>
        <div>
          <AlterAvatar name="Kani" role="Designer" variant="paired-offset" size="md" />
          <small>Kani</small>
        </div>
        <div>
          <AlterAvatar name="Sahil" role="Engineer" variant="paired-offset" size="md" />
          <small>Sahil</small>
        </div>
        <div>
          <AlterAvatar name="Siddhi" role="Login Owner" variant="paired-offset" size="md" onLeave showLabel />
          <small>Siddhi · on leave</small>
        </div>
      </div>

      <div className="aap-row">
        <AlterAvatar name="Alter" variant="alter-only" size="sm" />
        <AlterAvatar name="Alter" variant="alter-only" size="md" voiceState="listening" />
        <AlterAvatar name="Alter" variant="alter-only" size="md" voiceState="speaking" />
        <AlterAvatar name="Alter" variant="alter-only" size="md" voiceState="muted" />
        <AlterAvatar name="Alter" variant="alter-only" size="md" voiceState="failed" />
        <AlterAvatar name="Alter" variant="alter-only" size="md" voiceState="connecting" />
        <AlterAvatar name="Dev" variant="paired-side-by-side" size="md" showLabel role="Product Lead" />
      </div>
      <p className="aap-note">
        Voice states left to right: idle, listening, speaking (equalizer), muted (strike + pill), failed (amber
        corner slash), connecting (breathing orbit + reduced-motion corner pip).
      </p>

      <div className="aap-join">
        <label>
          Simulate a judge joining by name
          <input
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
            placeholder="Type a name, e.g. Dev or Rohan"
            maxLength={32}
            aria-label="Simulate a judge joining by name"
          />
        </label>
        <AlterAvatar
          name={judgeName || 'New Judge'}
          role="Judge (you)"
          variant="paired-side-by-side"
          size="lg"
          showLabel
          existingNames={ROOM}
        />
      </div>
      <p className="aap-note">
        Palettes and spark-tick angles are hashed from the name. Sharing a first initial with a seeded teammate
        (try "Siddhi", "Rohan" or "Dev") switches to a two-character monogram and shifts the palette —
        two Alters in the same room never look identical.
      </p>
    </details>
  )
}
