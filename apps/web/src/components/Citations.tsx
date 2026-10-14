import type { Citation } from '../api/types'

import { externalUrl } from '../api/presentation'

export function Citations({ sources }: { sources: Citation[] }) {
  return <div className="chips" aria-label="Sources">{sources.map((source) => {
    const url = externalUrl(source.url)
    const label = `${source.title} · ${source.locator}`
    return url
      ? <a className="chip" key={`${source.sourceId}-${source.locator}`} href={url} target="_blank" rel="noreferrer">{label} ↗</a>
      : <span className="chip" key={`${source.sourceId}-${source.locator}`}>{label}</span>
  })}</div>
}
