import 'dotenv/config'
import dns from 'node:dns'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import authRoutes from './routes/auth.js'
import analysisRoutes from './routes/analysis.js'
import jobsRoutes from './routes/jobs.js'
import skillsRoutes from './routes/skills.js'
import portfolioRoutes from './routes/portfolio.js'

const app = express()
// Atlas uses SRV records. This fallback avoids a local DNS resolver that rejects SRV queries.
dns.setServers([process.env.MONGODB_DNS_SERVER || '1.1.1.1'])
app.use(cors())
app.use(express.json())
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api/auth', authRoutes)
app.use('/api/analysis', analysisRoutes)
app.use('/api/jobs', jobsRoutes)
app.use('/api/skills', skillsRoutes)
app.use('/api/portfolio', portfolioRoutes)
app.use((error, _req, res, _next) => {
  const uploadError = error?.name === 'MulterError'
  const status = uploadError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : Number(error?.status) || 500
  const message = uploadError
    ? error.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file exceeds the 10MB limit.' : 'The uploaded files or form fields are invalid.'
    : status >= 500 ? 'Something went wrong. Please try again.' : error.message
  console.error('[API] Request failed', { status, errorName: error?.name || 'Error' })
  res.status(status).json({ message })
})

mongoose.connect(process.env.MONGODB_URI)
  .then(() => app.listen(process.env.PORT || 5000, () => console.log(`Jobekaa API listening on port ${process.env.PORT || 5000}`)))
  .catch((error) => { console.error('MongoDB connection failed:', error?.name || 'Error'); process.exit(1) })
