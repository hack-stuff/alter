import type { CSSProperties } from 'react'

const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  work: 'M8 6V4h8v2M3 7h18v13H3ZM3 12h18M10 12v3h4v-3',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  approvals: 'm8 12 3 3 5-6M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6Z',
  escalations: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  files: 'M3 5h7l2 3h9v12H3Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  more: 'M4 12h1m6 0h1m6 0h1',
  close: 'm6 6 12 12M6 18 18 6',
}
export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg className={`icon ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.sparkle} /></svg>
}

export function Avatar({ name, id, size = 'medium' }: { name: string; id?: string; size?: 'small' | 'medium' | 'large' }) {
  const hue = [...(id ?? name)].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6
  return <span className={`avatar avatar-${size} avatar-color-${hue}`} aria-hidden="true">{name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
}
