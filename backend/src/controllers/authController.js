import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const publicUser = (user) => ({ id: user._id, email: user.email, role: user.role })
const tokenFor = (user) => jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })

export async function register(req, res, next) {
  try {
    const { email, password, role } = req.body
    if (!email || !password || !role) return res.status(400).json({ message: 'Email, password, and role are required.' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' })
    if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ message: 'An account with this email already exists. Please sign in.' })
    const user = await User.create({ email, password: await bcrypt.hash(password, 12), role })
    return res.status(201).json({ token: tokenFor(user), user: publicUser(user) })
  } catch (error) { return next(error) }
}

export async function login(req, res, next) {
  try {
    const { email, password, role } = req.body
    const user = await User.findOne({ email: email?.toLowerCase() }).select('+password')
    if (!user) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'No account was found for this email.' })
    if (!(await bcrypt.compare(password || '', user.password))) return res.status(401).json({ code: 'INVALID_PASSWORD', message: 'Incorrect email or password.' })
    if (user.role !== role) return res.status(403).json({ message: `This account is registered as a ${user.role}. Select that role to continue.` })
    return res.json({ token: tokenFor(user), user: publicUser(user) })
  } catch (error) { return next(error) }
}

export async function requestPasswordReset(req, res, next) {
  return res.status(503).json({ message: 'Password recovery is temporarily unavailable because secure email delivery is not configured. Please contact the administrator.' })
}

export async function resetPassword(req, res, next) {
  try {
    const { email, password, resetToken } = req.body
    if (!password || password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' })
    const tokenHash = crypto.createHash('sha256').update(resetToken || '').digest('hex')
    const resetFilter = { email: email?.toLowerCase(), passwordResetToken: tokenHash, passwordResetExpiresAt: { $gt: new Date() } }
    if (!(await User.exists(resetFilter))) return res.status(400).json({ message: 'This reset request is invalid or has expired.' })
    const hashedPassword = await bcrypt.hash(password, 12)
    resetFilter.passwordResetExpiresAt = { $gt: new Date() }
    const user = await User.findOneAndUpdate(
      resetFilter,
      { $set: { password: hashedPassword }, $unset: { passwordResetToken: 1, passwordResetExpiresAt: 1 } },
      { new: true },
    )
    if (!user) return res.status(400).json({ message: 'This reset request is invalid or has expired.' })
    return res.json({ message: 'Password updated. You can now sign in.' })
  } catch (error) { return next(error) }
}
