import { Icon } from './Icon'

export interface TipItem {
  type: 'say' | 'do'
  text: string
  action?: () => void
  highlight?: boolean
}

interface OnScreenTipsProps {
  tips: TipItem[]
  title?: string
  className?: string
  onSelectPrompt?: (text: string) => void
}

export function OnScreenTips({ tips, title = 'Quick tips for judges', className = '', onSelectPrompt }: OnScreenTipsProps) {
  if (!tips.length) return null

  return (
    <aside className={`on-screen-tips ${className}`} aria-label="Guidance tips">
      <div className="tips-header">
        <span className="tips-badge"><Icon name="sparkle" size={14} />{title}</span>
        <span className="tips-hint">Say it, or click to send the instruction</span>
      </div>
      <div className="tips-list">
        {tips.map((tip, idx) => {
          const isSay = tip.type === 'say'
          return (
            <button
              key={idx}
              type="button"
              className={`tip-pill tip-${tip.type} ${tip.highlight ? 'tip-highlight' : ''}`}
              onClick={() => {
                if (tip.action) {
                  tip.action()
                } else if (isSay && onSelectPrompt) {
                  onSelectPrompt(tip.text)
                }
              }}
              title={isSay ? `Send instruction: "${tip.text}"` : tip.text}
            >
              <span className="tip-prefix">{isSay ? '🎙️ Try saying:' : '👆 Try doing:'}</span>
              <span className="tip-text">{isSay ? `"${tip.text}"` : tip.text}</span>
              {isSay && <span className="tip-action-tag">Use prompt ↗</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
