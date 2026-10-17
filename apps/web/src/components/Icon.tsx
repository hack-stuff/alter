import type { CSSProperties } from 'react'

const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z',
  work: 'M8 6V4h8v2M3 7h18v13H3ZM3 12h18M10 12v3h4v-3',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  approvals: 'm8 12 3 3 5-6M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6Z',
  escalations: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  decision: 'M12 3v4M12 17v4M4 12h4M16 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  files: 'M3 5h7l2 3h9v12H3Z',
  computer: 'M3 4h18v12H3ZM8 20h8M12 16v4',
  canvas: 'M4 4h6v6H4ZM14 14h6v6h-6ZM10 7h4a3 3 0 0 1 3 3v4',
  meeting: 'M3 7h12v10H3ZM15 10l6-3v10l-6-3',
  log: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M19 10v2a7 7 0 0 1-1.1 3.8M5 10v2a7 7 0 0 0 11.5 5.4M12 19v3M8 22h8',
  play: 'M7 4v16l13-8Z',
  stop: 'M6 6h12v12H6Z',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  more: 'M4 12h1m6 0h1m6 0h1',
  keyboard: 'M3 6h18v12H3ZM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  logout: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M13 8l4 4-4 4M7 12h10',
  close: 'm6 6 12 12M6 18 18 6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0',
  lock: 'M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  send: 'M4 12 20 4l-6 16-3-7Z',
  copy: 'M8 8h12v12H8ZM4 16V4h12',
  video: 'M3 7h12v10H3ZM15 10l6-3v10l-6-3',
  videoOff: 'M3 3l18 18M15 10l6-3v10l-6-3M3 7h4M11 7h4v4M15 15v2H3V7',
}

export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg className={`icon ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.sparkle} /></svg>
}

export { Avatar } from './People'
