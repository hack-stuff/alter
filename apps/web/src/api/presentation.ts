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
