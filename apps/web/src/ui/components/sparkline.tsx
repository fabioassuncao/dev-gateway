export function Sparkline({ values, className = '' }: { values: Array<number | null>; className?: string }) {
  const points = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (points.length < 2) return null
  const width = 120
  const height = 28
  const max = Math.max(...points, 0.01)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const polyline = values
    .map((value, index) => {
      const y = height - ((value ?? 0) / max) * (height - 4) - 2
      return `${index * step},${y}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`h-7 w-28 text-accent ${className}`} aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" points={polyline} />
    </svg>
  )
}
