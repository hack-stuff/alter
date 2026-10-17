// Humans are circles with initials; Alters are tactile keycap squircles with double-ribbon monograms.
// These two shapes are used everywhere so people can tell them apart at a glance.
import type { MemberStatus } from '../api/types'
import { AlterAvatar, type AlterAvatarProps, type AlterVoiceState } from './avatar/AlterAvatar'

export { AlterAvatar }
export type { AlterAvatarProps, AlterVoiceState }

type Size = 'small' | 'medium' | 'large'

const SIZE_MAP: Record<Size, 'sm' | 'md' | 'lg'> = {
  small: 'sm',
  medium: 'md',
  large: 'lg',
}

export function Avatar({
  name,
  id,
  size = 'medium',
  away = false,
}: {
  name: string
  id?: string
  size?: Size
  away?: boolean
}) {
  return (
    <AlterAvatar
      name={name}
      userId={id}
      size={SIZE_MAP[size] || 'md'}
      variant="human-only"
      onLeave={away}
      className={`avatar avatar-${size}`}
    />
  )
}

export function AlterMark({
  size = 'medium',
  lit = true,
  label,
}: {
  size?: Size
  lit?: boolean
  label?: string
}) {
  return (
    <AlterAvatar
      name="Alter"
      size={SIZE_MAP[size] || 'md'}
      variant="alter-only"
      className={`alter-mark alter-mark-${size}${lit ? '' : ' is-dim'}`}
      aria-label={label}
    />
  )
}

/** A person's circle with their Alter's squircle overlapping it (The Paired Totem). */
export function PersonWithAlter({
  name,
  status,
  size = 'medium',
}: {
  name: string
  status?: MemberStatus
  size?: Size
}) {
  const away = status === 'on_leave' || status === 'away'
  return (
    <AlterAvatar
      name={name}
      size={SIZE_MAP[size] || 'md'}
      variant="paired-offset"
      onLeave={away}
      className={`person-pair person-pair-${size}`}
    />
  )
}
