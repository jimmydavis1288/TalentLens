import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import authRoutes from './routes/auth.js'
import analysisRoutes from './routes/analysis.js'
import jobsRoutes from './routes/jobs.js'
import skillsRoutes from './routes/skills.js'
import portfolioRoutes from './routes/portfolio.js'
import { classifyGeminiError } from './services/resumePipelineService.js'

const app = express()
const allowedOrigins = new Set((process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean))
app.use(cors({ origin(origin, callback) {
  if (!origin || process.env.NODE_ENV !== 'production' || allowedOrigins.has(origin)) return callback(null, true)
  return callback(null, false)
} }))
app.use(express.json())
app.get('/api/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1
  return res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' })
})
app.use('/api/auth', authRoutes)
app.use('/api/analysis', analysisRoutes)
app.use('/api/jobs', jobsRoutes)
app.use('/api/skills', skillsRoutes)
app.use('/api/portfolio', portfolioRoutes)
app.use((error, _req, res, _next) => {
  const uploadError = error?.name === 'MulterError'
  const databaseFailure = /mongo|mongoose|database|connection|serverselection|buffering/i.test(`${error?.name || ''} ${error?.message || ''}`) || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code)
  const geminiCategory = error?.failureCategory || (String(error?.code || '').startsWith('GEMINI_') ? classifyGeminiError(error) : null)
  const geminiMessages = {
    gemini_quota_exhausted: [429, 'GEMINI_QUOTA_EXHAUSTED', 'Gemini quota is exhausted. Try again when quota is available, or contact the administrator.'],
    gemini_rate_limited: [429, 'GEMINI_RATE_LIMITED', 'Gemini is rate limiting requests. Please retry shortly.'],
    gemini_unavailable: [503, 'GEMINI_UNAVAILABLE', 'Gemini is temporarily unavailable. Please retry shortly.'],
    gemini_invalid_key: [503, 'GEMINI_INVALID_KEY', 'Gemini credentials are invalid. Contact the administrator to update the backend API key.'],
    gemini_not_configured: [503, 'GEMINI_NOT_CONFIGURED', 'AI analysis is not configured. Ask the administrator to configure Gemini.'],
    gemini_model_unavailable: [502, 'GEMINI_MODEL_UNAVAILABLE', 'The configured Gemini model is unavailable. Contact the administrator to verify the model configuration.'],
    gemini_invalid_response: [502, 'GEMINI_INVALID_RESPONSE', 'Gemini returned an unreadable analysis. Please retry.'],
  }
  const geminiFailure = geminiMessages[geminiCategory]
  const status = geminiFailure?.[0] || (databaseFailure ? 503 : uploadError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : Number(error?.status) || 500)
  const code = geminiFailure?.[1] || (databaseFailure ? 'DATABASE_UNAVAILABLE' : uploadError ? error.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'INVALID_UPLOAD' : error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'))
  const message = databaseFailure
    ? 'The database is temporarily unavailable. Please retry shortly.'
    : uploadError
    ? error.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file exceeds the 10MB limit.' : 'The uploaded files or form fields are invalid.'
    : geminiFailure?.[2] || (status >= 500 ? 'Something went wrong. Please try again.' : error.message)
  console.error('[API] Request failed', { stage: databaseFailure ? 'persist' : 'request', category: code.toLowerCase(), status, fallbackUsed: false, errorName: error?.name || 'Error' })
  res.status(status).json({ success: false, code, message })
})

export default app
