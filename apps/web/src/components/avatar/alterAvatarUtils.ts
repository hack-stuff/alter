// alterAvatarUtils — deterministic logic for the Paired Totem avatar system.
// Pure functions: no rendering, no state. See AlterAvatar.tsx for the component.

export type AlterVoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'muted'
  | 'ended'
  | 'failed'

export interface AlterAvatarProps {
  name: string
  userId?: string
  role?: string
  avatarUrl?: string // Optional human photo URL
  variant?: 'alter-only' | 'human-only' | 'paired-offset' | 'paired-side-by-side'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' // 24px, 32px, 44px, 64px, 80px
  voiceState?: AlterVoiceState
  onLeave?: boolean // Renders the "ON LEAVE / AUTONOMOUS" pill badge
  showLabel?: boolean // Renders Name + monospace [ALTER] badge + role
  existingNames?: string[] // Used for collision detection when a judge joins
  className?: string
  'aria-label'?: string
}

export interface KeycapPalette {
  id: number
  name: string
  base: string
  well: string
  glyph: string
}

/**
 * 8 AA-contrast "Warm Working Desk" keycap palettes.
 * Indexes 0-3 are the canonical demo team; 4-7 are their (+4) collision twins,
 * so two Alters in the same room never share a palette.
 */
export const KEYCAP_PALETTES: readonly KeycapPalette[] = [
  // 0: Terracotta — Dev (Product Lead)
  { id: 0, name: 'Terracotta', base: '#B55B33', well: '#CC6E43', glyph: '#FFF6EE' },
  // 1: Cobalt — Kani (Designer)
  { id: 1, name: 'Cobalt', base: '#2B45B0', well: '#3B5BDB', glyph: '#F2F6FF' },
  // 2: Forest — Sahil (Engineer)
  { id: 2, name: 'Forest', base: '#1F573F', well: '#2B6E52', glyph: '#F0FAF5' },
  // 3: Slate & Ochre — Siddhi (Login Owner, On Leave)
  { id: 3, name: 'Slate & Ochre', base: '#45525E', well: '#586775', glyph: '#E5C478' },
  // 4: Mulberry — collision twin of Terracotta
  { id: 4, name: 'Mulberry', base: '#6E2D5E', well: '#853A73', glyph: '#FDF4FB' },
  // 5: Amber — collision twin of Cobalt
  { id: 5, name: 'Amber', base: '#A36209', well: '#C2780E', glyph: '#FFF9ED' },
  // 6: Teal — collision twin of Forest
  { id: 6, name: 'Teal', base: '#165668', well: '#1E6B80', glyph: '#F0FAFC' },
  // 7: Espresso — collision twin of Slate & Ochre
  { id: 7, name: 'Espresso', base: '#5A4033', well: '#6F4E3D', glyph: '#FAF4EF' },
] as const

/** Canonical demo characters lock to a fixed palette index + tick rotation. */
const CANONICAL: Record<string, { index: number; rotation: 0 | 90 | 180 | 270 }> = {
  dev: { index: 0, rotation: 0 },
  kani: { index: 1, rotation: 90 },
  sahil: { index: 2, rotation: 180 },
  siddhi: { index: 3, rotation: 270 },
}

const COLLISION_PALETTE_OFFSET = 4 // modulo the 8 palettes
const COLLISION_ROTATION_OFFSET = 2 // modulo the 4 tick rotations

/** 32-bit FNV-1a string hash for deterministic custom judge palettes */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Collision rule: true when the joining person's name matches an existing
 * teammate, or shares a first initial with a distinct teammate (the judge
 * typing "Siddhi" or "Saanvi" beside the seeded Siddhi). An exact match from the
 * canonical member themselves (same userId) is NOT a collision.
 */
export function detectCollision(name: string, userId?: string, existingNames?: string[]): boolean {
  if (!existingNames || existingNames.length === 0) return false
  const clean = name.trim().toLowerCase()
  if (!clean) return false

  // The owner of the name is not colliding with themselves.
  if (userId && existingNames.some((other) => other.toLowerCase() === userId.toLowerCase())) {
    return false
  }

  const distinctByInitial = existingNames.some((other) => {
    const lower = other.trim().toLowerCase()
    // Exact name match by a different person, or a shared first initial.
    return lower === clean || (lower.length > 0 && lower.charAt(0) === clean.charAt(0))
  })
  return distinctByInitial
}

/** Resolves the monogram: one initial normally, two on collision (PJ or R2). */
export function getMonogram(name: string, isCollision: boolean): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const firstInitial = (parts[0][0] || '?').toUpperCase()

  if (parts.length >= 2) {
    return `${firstInitial}${(parts[parts.length - 1][0] || '').toUpperCase()}`
  }
  if (isCollision) return `${firstInitial}2`
  return firstInitial
}

/** Resolves deterministic palette & tick rotation, with collision offset (+4 % 8). */
export function getAlterVisuals(
  name: string,
  userId?: string,
  isCollision = false,
): { palette: KeycapPalette; tickRotation: 0 | 90 | 180 | 270 } {
  const rotations = [0, 90, 180, 270] as const

  // Canonical demo characters keep their locked look unless colliding.
  const canonical =
    CANONICAL[name.trim().toLowerCase()] ?? CANONICAL[(userId || '').trim().toLowerCase()]
  if (canonical) {
    if (!isCollision) {
      return { palette: KEYCAP_PALETTES[canonical.index], tickRotation: canonical.rotation }
    }
    return {
      palette: KEYCAP_PALETTES[(canonical.index + COLLISION_PALETTE_OFFSET) % 8],
      tickRotation: rotations[(rotations.indexOf(canonical.rotation) + COLLISION_ROTATION_OFFSET) % 4],
    }
  }

  // Custom judge name: FNV-1a hash of name (+userId) drives palette and ticks.
  const hash = fnv1a(name.trim() + (userId || ''))
  let paletteIndex = hash % 8
  if (isCollision) paletteIndex = (paletteIndex + COLLISION_PALETTE_OFFSET) % 8

  const rotationIndex = Math.floor(hash / 8) % 4
  const tickRotation = rotations[isCollision ? (rotationIndex + COLLISION_ROTATION_OFFSET) % 4 : rotationIndex]

  return { palette: KEYCAP_PALETTES[paletteIndex], tickRotation }
}
