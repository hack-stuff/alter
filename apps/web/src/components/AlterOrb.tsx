export function AlterOrb({ state, caption, label = 'Your Alter', onHome }: {
  state: 'idle' | 'listening' | 'speaking' | 'working'
  caption?: string
  label?: string
  onHome?: () => void
}) {
  const stateText = state === 'listening' ? 'Listening' : state === 'speaking' ? 'Speaking' : state === 'working' ? 'Working' : 'Here'
  return <div className={`alter-orb orb-${state}`}>
    {caption && <p className="orb-caption">{caption}</p>}
    <button type="button" className="orb-core" onClick={onHome} aria-label={`${label} — back to the cards`}>
      <span className="orb-ring" aria-hidden="true" />
      <span className="orb-ring orb-ring-far" aria-hidden="true" />
      <span className="orb-letter" aria-hidden="true">✦</span>
    </button>
    <span className="orb-state"><i aria-hidden="true" /> {stateText}</span>
  </div>
}
