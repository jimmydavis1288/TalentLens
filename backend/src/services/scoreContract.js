export function boundedScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value)
}