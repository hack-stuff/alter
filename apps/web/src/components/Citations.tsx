import type { Citation } from '../api/types'
import { externalUrl } from '../api/presentation'
import { AppIcon } from './AppIcon'
import { appFor } from './apps'

export function Citations({ sources }: { sources: Citation[] }) {
  if (!sources.length) return null
  return <div className="source-pills" aria-label="Sources">{sources.map((source) => {
    const url = externalUrl(source.url)
    const app = appFor(source.url, source.title)
    const title = source.retrievalBackend === 'vertex_search' ? 'Retrieved through Vertex AI Search' : 'Source-backed evidence'
    const content = <>{app && <AppIcon app={app} />}<span>{source.title} · {source.locator}</span>{url && <span aria-hidden="true"> ↗</span>}</>
    return url
      ? <a className="source-pill" title={title} key={`${source.sourceId}-${source.locator}`} href={url} target="_blank" rel="noreferrer">{content}</a>
      : <span className="source-pill" title={title} key={`${source.sourceId}-${source.locator}`}>{content}</span>
  })}</div>
}
