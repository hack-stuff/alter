export function externalUrl(value?: string): string | undefined {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch { /* Sources can carry locators without a published URL. */ }
}

export function timestamp() { return new Date().toISOString() }
