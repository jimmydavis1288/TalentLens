import 'dotenv/config'
import dns from 'node:dns'
import mongoose from 'mongoose'
import app from './app.js'
import User from './models/User.js'
import Skill from './models/Skill.js'
import RecruitmentAnalysis from './models/RecruitmentAnalysis.js'
import RecruitmentResumeSource from './models/RecruitmentResumeSource.js'
import ResumeProfileCache from './models/ResumeProfileCache.js'
import JobProfileCache from './models/JobProfileCache.js'

// Keep the hosting environment's DNS configuration unless an operator explicitly overrides it.
if (process.env.MONGODB_DNS_SERVER) dns.setServers([process.env.MONGODB_DNS_SERVER])

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Production configuration is incomplete: MONGODB_URI and a JWT_SECRET of at least 32 characters are required.')
  process.exit(1)
}

const requiredModels = [User, Skill, RecruitmentAnalysis, RecruitmentResumeSource, ResumeProfileCache, JobProfileCache]
let server

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    // Build unique and TTL indexes before accepting requests; startup fails safely if they cannot be built.
    await Promise.all(requiredModels.map((model) => model.createIndexes()))
    const port = Number(process.env.PORT || 5000)
    server = app.listen(port, '0.0.0.0', () => console.log(`TalentLens API listening on port ${port}`))
  } catch (error) {
    console.error('Backend startup failed:', error?.name || 'Error')
    await mongoose.disconnect().catch(() => {})
    process.exitCode = 1
  }
}

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`)
  if (server) await new Promise((resolve) => server.close(resolve))
  await mongoose.disconnect().catch((error) => console.error('MongoDB shutdown failed:', error?.name || 'Error'))
}

process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => { process.exitCode = 1 }) })
process.once('SIGINT', () => { shutdown('SIGINT').catch(() => { process.exitCode = 1 }) })

await start()
