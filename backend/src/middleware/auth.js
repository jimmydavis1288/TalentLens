import jwt from 'jsonwebtoken'

export function requireAuth(req, res, next) {
  if (!process.env.JWT_SECRET) return res.status(503).json({ message: 'Authentication is not configured.' })
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return res.status(401).json({ message: 'Authentication is required.' })
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    return next()
  } catch {
    return res.status(401).json({ message: 'Your session is invalid or has expired.' })
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ message: 'You do not have access to this workspace.' })
    return next()
  }
}
