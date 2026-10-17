// 16px Google app marks for file, event and source pills. The product name is
// the accessible label; the glyph itself is decorative.
import type { GoogleApp } from './apps'

export type { GoogleApp } from './apps'

const names: Record<GoogleApp, string> = { docs: 'Google Docs', sheets: 'Google Sheets', drive: 'Google Drive', calendar: 'Google Calendar', gmail: 'Gmail', meet: 'Google Meet' }

function Glyph({ app }: { app: GoogleApp }) {
  switch (app) {
    case 'docs': return <><path d="M4 1.5h5.5L13 5v9.5H4Z" fill="#4285F4" /><path d="M9.5 1.5V5H13" fill="#A1C2FA" /><path d="M6 8h5M6 10h5M6 12h3.5" stroke="#fff" strokeWidth="1" /></>
    case 'sheets': return <><path d="M4 1.5h5.5L13 5v9.5H4Z" fill="#0F9D58" /><path d="M9.5 1.5V5H13" fill="#87CEAC" /><path d="M6 7.5h5v5H6ZM6 10h5M8.5 7.5v5" stroke="#fff" strokeWidth=".9" fill="none" /></>
    case 'drive': return <><path d="M5.6 2h4.8l4.4 7.6h-4.8Z" fill="#FBBC04" /><path d="M1.2 9.6 5.6 2l2.4 4.2-4.4 7.6Z" fill="#0F9D58" /><path d="M3.6 13.8 6 9.6h8.8l-2.4 4.2Z" fill="#4285F4" /></>
    case 'calendar': return <><rect x="2" y="2.5" width="12" height="11.5" rx="1.6" fill="#fff" stroke="#4285F4" strokeWidth="1.2" /><path d="M2 5.5h12" stroke="#4285F4" strokeWidth="1.6" /><text x="8" y="12.4" textAnchor="middle" fontSize="6" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text></>
    case 'gmail': return <><rect x="1.5" y="3" width="13" height="10" rx="1.4" fill="#fff" stroke="#d9d9d9" strokeWidth=".6" /><path d="M1.8 4 8 8.6 14.2 4" stroke="#EA4335" strokeWidth="1.6" fill="none" strokeLinejoin="round" /><path d="M1.8 4v8.6M14.2 4v8.6" stroke="#4285F4" strokeWidth="1.4" /></>
    case 'meet': return <><rect x="1.5" y="4" width="9" height="8" rx="1.3" fill="#00AC47" /><path d="m10.5 7 4-2.5v7l-4-2.5Z" fill="#FFBA00" /><path d="M1.5 4h4v4h-4Z" fill="#4285F4" opacity=".9" /></>
  }
}

export function AppIcon({ app, size = 16 }: { app: GoogleApp; size?: number }) {
  return <svg className="app-icon" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={names[app]}><Glyph app={app} /></svg>
}
