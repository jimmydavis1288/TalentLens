export function formatScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? `${Math.round(value)}%`
    : 'Match unavailable'
}

export function isValidScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}