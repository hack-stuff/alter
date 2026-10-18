export function externalUrl(value?: string): string | undefined {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch { /* Sources can carry locators without a published URL. */ }
}

export function timestamp() { return new Date().toISOString() }

// A record without a string ts sorts first instead of throwing.
export const byTime = (a: { ts?: unknown }, b: { ts?: unknown }) => String(a.ts ?? '').localeCompare(String(b.ts ?? ''))

// Local calendar day and time for an ISO timestamp; falls back to the raw text.
export function localDayAndTime(ts: string): [string, string] {
  const at = new Date(ts)
  if (Number.isNaN(at.getTime())) return [ts.slice(0, 10), ts.slice(11, 16)]
  const pad = (n: number) => String(n).padStart(2, '0')
  return [`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, `${pad(at.getHours())}:${pad(at.getMinutes())}`]
}

// Siddhi is on leave and represented by Siddhi's Alter, so the name is taken (the API checks too).
export const SIDDHI_TAKEN = 'Nice try! Siddhi is on leave, and Siddhi’s Alter already has that job covered. Pick a name of your own.'
export const SIDDHI_IN_ROOM = 'Siddhi’s Alter is already in this meeting, and two Siddhis would confuse everyone. Try your own name.'
export function pretendsToBeSiddhi(name: string) {
  const letters = name.toLowerCase().replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[^a-z]/g, '')
  return letters.includes('siddhi') || letters.includes('sidhi')
}
