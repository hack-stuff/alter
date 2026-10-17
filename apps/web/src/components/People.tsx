// Humans are circles with initials; Alters are amber squircles with ✦.
// These two shapes are used everywhere so people can tell them apart at a glance.
import type { MemberStatus } from '../api/types'

type Size = 'small' | 'medium' | 'large'

function initials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export function Avatar({ name, size = 'medium', away = false }: { name: string; id?: string; size?: Size; away?: boolean }) {
  return <span className={`avatar avatar-${size}${away ? ' is-away' : ''}`} aria-hidden="true">{initials(name)}</span>
}

export function AlterMark({ size = 'medium', lit = true, label }: { size?: Size; lit?: boolean; label?: string }) {
  return <span className={`alter-mark alter-mark-${size}${lit ? '' : ' is-dim'}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>✦</span>
}

/** A person's circle with their Alter's squircle overlapping it. */
export function PersonWithAlter({ name, status, size = 'medium' }: { name: string; status?: MemberStatus; size?: Size }) {
  const away = status === 'on_leave' || status === 'away'
  return <span className={`person-pair person-pair-${size}`} aria-hidden="true">
    <Avatar name={name} size={size} away={away} />
    <AlterMark size={size === 'large' ? 'medium' : 'small'} lit />
  </span>
}
