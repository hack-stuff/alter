export interface TipItem {
  type: 'say' | 'do'
  text: string
  action?: () => void
  highlight?: boolean
}

/** Example requests the person can say, or click to send as text. */
export function OnScreenTips({ tips, title = 'Try saying', className = '', onSelectPrompt }: { tips: TipItem[]; title?: string; className?: string; onSelectPrompt?: (text: string) => void }) {
  if (!tips.length) return null
  return <div className={`tips ${className}`} aria-label={title}>
    <p className="eyebrow">{title} · say it or tap to send</p>
    <div className="chip-row">
      {tips.map((tip, idx) => <button key={idx} type="button" className="chip" title={tip.type === 'say' ? `Send instruction: "${tip.text}"` : tip.text}
        onClick={() => { if (tip.action) tip.action(); else if (tip.type === 'say') onSelectPrompt?.(tip.text) }}>
        <span className="sr-only">{tip.type === 'say' ? 'Try saying:' : 'Try doing:'} </span>{tip.text}
      </button>)}
    </div>
  </div>
}
