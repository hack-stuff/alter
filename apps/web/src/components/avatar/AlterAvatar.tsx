import { useId, useState } from 'react'
import './AlterAvatar.css'
import {
  type AlterAvatarProps,
  type AlterVoiceState,
  type KeycapPalette,
  detectCollision,
  getAlterVisuals,
  getMonogram,
} from './alterAvatarUtils'

export type { AlterAvatarProps, AlterVoiceState, KeycapPalette }

/** Spark tick geometry: two parallel 45° ticks top-right, one counter-tick bottom-left. */
const SPARK_TICKS = [
  { x1: 43, y1: 17, x2: 47, y2: 13 },
  { x1: 47, y1: 20, x2: 51, y2: 16 },
  { x1: 15, y1: 47, x2: 18, y2: 44 },
] as const

/** AlterAvatar — chamfered tactile keycap squircle (the AI representative). */
function AlterKeycapSquircle({
  monogram,
  palette,
  tickRotation,
  voiceState,
  isAutonomousActive,
}: {
  monogram: string
  palette: KeycapPalette
  tickRotation: 0 | 90 | 180 | 270
  voiceState?: AlterVoiceState
  isAutonomousActive: boolean
}) {
  const gradientId = useId()
  const fontSize = monogram.length > 1 ? 22 : 30
  const muted = voiceState === 'muted'
  const failed = voiceState === 'failed'
  const speaking = voiceState === 'speaking'
  const connecting = voiceState === 'connecting'

  const monoProps = {
    x: 32,
    y: 33,
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const,
    fontWeight: 800,
    fontSize,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
  }

  return (
    <div
      className={`alter-keycap-wrapper is-state-${voiceState || 'idle'}${
        isAutonomousActive ? ' is-autonomous-active' : ''
      }`}
    >
      <span className="alter-autonomous-orbit" aria-hidden="true" />
      {connecting && <span className="alter-voice-pip" aria-hidden="true" />}
      {speaking && (
        <span className="alter-eq" aria-hidden="true">
          <span className="alter-eq-bar alter-eq-bar-1" />
          <span className="alter-eq-bar alter-eq-bar-2" />
          <span className="alter-eq-bar alter-eq-bar-3" />
        </span>
      )}
      {muted && (
        <span className="alter-muted-pill" aria-hidden="true">
          Muted
        </span>
      )}
      <svg viewBox="0 0 64 64" className="alter-keycap-svg" aria-hidden="true" focusable="false">
        <defs>
          {/* Subtle tactile lighting gradient over the outer keycap base */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={palette.base} stopOpacity="1" />
            <stop offset="100%" stopColor={palette.base} stopOpacity="0.88" />
          </linearGradient>
        </defs>

        {/* Outer chamfered tactile keycap squircle (rx="15") */}
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="15"
          fill={`url(#${gradientId})`}
          className="alter-keycap-base"
        />

        {/* Tactile bottom bevel shadow */}
        <path
          d="M 14 58 L 50 58"
          stroke="rgba(0, 0, 0, 0.28)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Inner recessed well (rx="11") */}
        <rect x="9" y="9" width="46" height="46" rx="11" fill={palette.well} className="alter-keycap-well" />

        {/* Tactile well top-edge bevel highlight */}
        <path
          d="M 18 10.5 L 46 10.5"
          stroke="rgba(255, 255, 255, 0.16)"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Universal AI signature: 45° spark ticks rotated around the well centre */}
        <g
          transform={`rotate(${tickRotation}, 32, 32)`}
          stroke={palette.glyph}
          strokeWidth="2.2"
          strokeLinecap="round"
          className="alter-spark-ticks"
        >
          {SPARK_TICKS.map((t) => (
            <line key={`${t.x1}-${t.y1}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
          ))}
        </g>

        {muted && (
          // Diagonal strike-through across the well and spark ticks.
          <line
            x1="13"
            y1="51"
            x2="51"
            y2="13"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="alter-muted-strike"
          />
        )}

        {failed && (
          // A quiet amber warning slash in the corner — never look broken or scary.
          <path
            d="M 6 22 L 22 6"
            strokeWidth="3"
            strokeLinecap="round"
            className="alter-failed-slash"
          />
        )}

        {/* Double-ribbon monogram: a hollow architectural inscription, any initial */}
        <text {...monoProps} fill={palette.well} stroke={palette.glyph} strokeWidth="5.5" strokeLinejoin="round" paintOrder="stroke fill" className="alter-monogram-outer">
          {monogram}
        </text>
        <text {...monoProps} fill="none" stroke={palette.well} strokeWidth="2" strokeLinejoin="round" className="alter-monogram-inner">
          {monogram}
        </text>
      </svg>
    </div>
  )
}

/** HumanAvatar — always a circle: a photo, or a clean single-stroke initial. */
function HumanCircle({
  name,
  avatarUrl,
  onLeave,
}: {
  name: string
  avatarUrl?: string
  onLeave?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const initial = (name.trim()[0] || '?').toUpperCase()

  return (
    <span className={`alter-human${onLeave ? ' is-on-leave' : ''}`} aria-hidden="true">
      {avatarUrl && !imgError ? (
        <img src={avatarUrl} alt="" className="alter-human-photo" onError={() => setImgError(true)} />
      ) : (
        <span className="alter-human-initial">{initial}</span>
      )}
    </span>
  )
}

/**
 * AlterAvatar — the Paired Totem dynamic avatar system for Alter.
 * Zero-asset, accessible, and deterministic for any name a judge types.
 * Zero external dependencies; theming rides on the app's token variables.
 */
export function AlterAvatar({
  name,
  userId,
  role,
  avatarUrl,
  variant = 'paired-offset',
  size = 'md',
  voiceState,
  onLeave = false,
  showLabel = false,
  existingNames,
  className = '',
  'aria-label': customAriaLabel,
}: AlterAvatarProps) {
  const isCollision = detectCollision(name, userId, existingNames)
  const monogram = getMonogram(name, isCollision)
  const { palette, tickRotation } = getAlterVisuals(name, userId, isCollision)

  const sizeClass = `size-${size}`
  const variantClass = `variant-${variant}`
  const voiceClass = voiceState ? `voice-${voiceState}` : ''

  // Accessible descriptive label — this is how "clearly labelled as AI" sounds.
  const computedAriaLabel =
    customAriaLabel ??
    (variant === 'alter-only'
      ? `${name}, AI Alter${voiceState ? ` (voice ${voiceState})` : ''}${onLeave ? ', autonomous' : ''}`
      : variant === 'human-only'
        ? `${name}${onLeave ? ' (on leave)' : ''}`
        : `${name} and their AI Alter${onLeave ? ' (on leave, Alter active autonomously)' : ''}${
            voiceState ? ` (voice ${voiceState})` : ''
          }`)

  return (
    <div className={`alter-avatar-container ${sizeClass} ${variantClass} ${voiceClass} ${className}`.trim()}
      role="img"
      aria-label={computedAriaLabel}
    >
      <div className="alter-totem">
        {variant !== 'alter-only' && <HumanCircle name={name} avatarUrl={avatarUrl} onLeave={onLeave} />}
        {variant !== 'human-only' && (
          <AlterKeycapSquircle
            monogram={monogram}
            palette={palette}
            tickRotation={tickRotation}
            voiceState={voiceState}
            isAutonomousActive={onLeave}
          />
        )}
      </div>

      {showLabel && (
        <div className="alter-avatar-details">
          <div className="alter-avatar-title-row">
            <span className="alter-avatar-name">{name}</span>
            {variant !== 'human-only' && (
              <span className="alter-badge-tag">
                <span aria-hidden="true">✦</span>[ALTER]
              </span>
            )}
            {onLeave && (
              <span className="alter-onleave-pill" role="status">
                <span className="alter-onleave-pill-dot" aria-hidden="true" />
                ON LEAVE / AUTONOMOUS
              </span>
            )}
          </div>
          {role && <span className="alter-avatar-role">{role}</span>}
        </div>
      )}
    </div>
  )
}
