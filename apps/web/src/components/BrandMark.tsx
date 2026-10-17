// The Alter mark: a person's circle with their Alter's squircle stepping out beside it.
export function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <svg className={`brand-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <circle className="brand-mark-person" cx="15" cy="16" r="12" />
    <g className="brand-mark-alter">
      <rect className="brand-mark-rim" x="16" y="14" width="23" height="23" rx="8" />
      <rect className="brand-mark-key" x="18.5" y="16.5" width="18" height="18" rx="6" />
      <path className="brand-mark-spark" d="M27.5 20.5c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5z" />
    </g>
  </svg>
}
