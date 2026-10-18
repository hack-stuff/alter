// The Alter mark: Alter's own avatar. An amber keycap with the spark ticks every Alter
// carries, and a hollow "A" in the same double-ribbon style as any Alter's monogram.
export const BRAND_A = 'M21.5 44 29.2 22h5.6l7.7 22H37l-1.6-4.5h-6.8L27 44zM30 35.5h4l-2-5.8z'

export function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <svg className={`brand-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect className="brand-mark-base" x="4" y="4" width="56" height="56" rx="15" />
    <path d="M14 58h36" stroke="rgba(0,0,0,.28)" strokeWidth="1.5" strokeLinecap="round" />
    <rect className="brand-mark-well" x="9" y="9" width="46" height="46" rx="11" />
    <g className="brand-mark-glyph" fill="none" strokeWidth="2.2" strokeLinecap="round">
      <path d="M43 17l4-4M47 20l4-4M15 47l3-3" />
    </g>
    <path className="brand-mark-letter" d={BRAND_A} fillRule="evenodd" strokeWidth="5.5" strokeLinejoin="round" paintOrder="stroke fill" />
    <path className="brand-mark-inner" d={BRAND_A} fillRule="evenodd" fill="none" strokeWidth="2" strokeLinejoin="round" />
  </svg>
}
