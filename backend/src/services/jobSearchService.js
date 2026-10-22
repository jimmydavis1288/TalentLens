import { createHash } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import jobRoles from '../data/jobRoles.js'
import { classifyGeminiError, withGeminiRetry } from './resumePipelineService.js'
import { detectJobDomain, weightedSkillScore } from './domainWeighting.js'
import { getSkillCatalog } from './skillCatalogService.js'
import Skill from '../models/Skill.js'
import mongoose from 'mongoose'
import { boundedScore } from './scoreContract.js'

const cache = new Map()
const clean = (text = '') => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const normalizedSkill = (skill = '') => skill.toLowerCase().replace(/react\s*\.?(js)?/g, 'react').replace(/node\s*\.?(js)?/g, 'node').replace(/mongo\s*db/g, 'mongodb').replace(/type\s*script/g, 'typescript').replace(/java\s*script/g, 'javascript').replace(/\W/g, '')
const roleWords = (role = '') => role.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !['developer', 'engineer', 'software', 'senior', 'junior', 'full', 'stack'].includes(word))
const embeddingModel = () => process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001'
const stopWords = new Set('a an and are as at be been by for from had has have in into is it its of on or our that the their then this to was were will with we you your'.split(' '))
let createGeminiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export function setGeminiClientFactory(factory) {
  if (typeof factory !== 'function') throw new TypeError('A Gemini client factory must be a function.')
  createGeminiClient = factory
}

export function resetGeminiClientFactory() {
  createGeminiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

export function scoreJob(job, { role, skills = [], location = 'india' }) {
  const title = job.jobTitle || ''; const text = clean(`${title} ${job.jobDescription || ''}`).toLowerCase(); const originalLocation = job.jobGeo || ''; const geographicScore = geographyScore(originalLocation, location)
  const candidateSkills = skills.filter((skill) => typeof skill === 'string' && skill.trim()).map((skill) => ({ label: skill.trim(), normalized: normalizedSkill(skill) })).filter((skill) => skill.normalized)
  const matchedSkills = candidateSkills.filter((skill) => skillOccursInText(skill.label, text)).map((skill) => skill.label)
  const relevantWords = roleWords(role); const titleWords = title.toLowerCase(); const matchedRoleWords = relevantWords.filter((word) => titleWords.includes(word) || text.includes(word)); const roleScore = relevantWords.length ? Math.round((matchedRoleWords.length / relevantWords.length) * 30) : 0
  const domain = detectJobDomain({ jobTitle: title, jobDescription: job.jobDescription || '' })
  const skillScore = candidateSkills.length ? Math.round((matchedSkills.length / candidateSkills.length) * 70) : null
  const domainWeightedSkillScore = candidateSkills.length ? weightedSkillScore(candidateSkills.map(({ label }) => label), matchedSkills, domain) : null
  const calculatedScore = skillScore === null ? roleScore : Math.min(100, skillScore + roleScore)
  // A zero provides no useful matching evidence, so it is intentionally unavailable to the UI.
  const matchScore = calculatedScore > 0 ? calculatedScore : null
  const rankingScore = (matchScore ?? 0) * 0.6
  const weightedScore = domain && domainWeightedSkillScore !== null ? boundedScore(roleScore + domainWeightedSkillScore) : boundedScore(matchScore)
  const dateValue = job.pubDate ? new Date(job.pubDate).getTime() : null
  const recencyScore = Number.isFinite(dateValue) ? Math.max(0, 100 - Math.max(0, (Date.now() - dateValue) / 86400000) * 3) : 50
  const finalScore = boundedScore(rankingScore + geographicScore * 0.25 + recencyScore * 0.15)
  return { id: job.id, title, company: job.companyName, location: originalLocation, originalLocation, type: job.jobType || [], level: job.jobLevel, excerpt: job.jobExcerpt || clean(job.jobDescription), publishedAt: job.pubDate, url: job.url, source: 'Jobicy', matchScore: boundedScore(matchScore), geographicScore: boundedScore(geographicScore), matchedSkills, missingSkills: [], domain, domainWeightedScore: weightedScore, finalScore }
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]); const b = Number(right[index])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    dot += a * b; leftMagnitude += a * a; rightMagnitude += b * b
  }
  if (!leftMagnitude || !rightMagnitude) return null
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)))
}

export function contextualOverlapScore(resumeText, jobText) {
  const tokens = (text) => new Set(clean(text).toLowerCase().match(/[a-z0-9+#.]+/g)?.map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter((token) => token.length > 2 && !stopWords.has(token)) || [])
  const resumeTokens = tokens(resumeText); const jobTokens = tokens(jobText)
  if (!resumeTokens.size || !jobTokens.size) return 0
  let overlap = 0
  for (const token of resumeTokens) if (jobTokens.has(token)) overlap += 1
  return Math.round((2 * overlap / (resumeTokens.size + jobTokens.size)) * 100)
}

export function scoreJobWithContext(job, { role, skills = [], location = 'india', resumeText = '', semanticScore = null, skillCatalog = getSkillCatalog() }) {
  const baseline = scoreJob(job, { role, skills, location })
  const jobText = clean(`${job.jobTitle || ''} ${job.jobDescription || ''}`)
  const candidateSkills = skills.filter((skill) => typeof skill === 'string' && skill.trim())
  const normalizedJobSkills = new Set(skillCatalog.filter((skill) => skillOccursInText(skill, jobText)).map(normalizedSkill))
  const candidateSkillKeys = new Set(candidateSkills.map(normalizedSkill))
  const matchedSkills = candidateSkills.filter((skill) => skillOccursInText(skill, jobText))
  const missingSkills = skillCatalog.filter((skill) => normalizedJobSkills.has(normalizedSkill(skill)) && !candidateSkillKeys.has(normalizedSkill(skill)))
  const hasEmbedding = Number.isFinite(semanticScore)
  const contextualScore = hasEmbedding ? Math.round(Math.max(0, Math.min(1, semanticScore)) * 100) : contextualOverlapScore(resumeText, jobText)
  const baselineScore = baseline.matchScore
  const weightedBaselineScore = baseline.domainWeightedScore
  const baselineWeight = hasEmbedding ? 0.35 : resumeText ? 0.4 : 1
  const contextualWeight = 1 - baselineWeight
  const matchScore = boundedScore((weightedBaselineScore ?? 0) * baselineWeight + contextualScore * contextualWeight)
  const dateValue = job.pubDate ? new Date(job.pubDate).getTime() : null
  const recencyScore = Number.isFinite(dateValue) ? Math.max(0, 100 - Math.max(0, (Date.now() - dateValue) / 86400000) * 3) : 50
  const finalScore = boundedScore((matchScore ?? 0) * 0.6 + baseline.geographicScore * 0.25 + recencyScore * 0.15)

  return {
    ...baseline,
    matchScore: matchScore > 0 ? matchScore : null,
    matchedSkills,
    missingSkills,
    finalScore,
    matchMethod: hasEmbedding ? 'gemini-embedding' : resumeText ? 'deterministic-context' : 'keyword-baseline',
    scoreComponents: {
      baselineScore,
      domainWeightedScore: weightedBaselineScore,
      contextualScore: boundedScore(contextualScore),
      baselineWeight,
      contextualWeight,
      locationScore: baseline.geographicScore,
      recencyScore,
    },
  }
}

function skillOccursInText(skill, text) {
  const key = normalizedSkill(skill)
  const variants = {
    node: ['node\\s*\\.?\\s*js', 'nodejs', 'node'],
    react: ['react\\s*\\.?\\s*js', 'reactjs', 'react'],
    express: ['express\\s*\\.?\\s*js', 'expressjs', 'express'],
    mongodb: ['mongodb', 'mongo\\s*db'],
    javascript: ['javascript', 'java\\s*script'],
    typescript: ['typescript', 'type\\s*script'],
  }[key] || [String(skill).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')]
  return variants.some((variant) => new RegExp(`(^|[^a-z0-9])${variant}(?=$|[^a-z0-9])`, 'i').test(text))
}

async function embedTexts(texts) {
  const ai = createGeminiClient()
  try {
    return await withGeminiRetry('embedding generation', async () => {
      const response = await ai.models.embedContent({
        model: embeddingModel(),
        contents: texts.map((text) => ({ role: 'user', parts: [{ text: text.slice(0, 12000) }] })),
        config: { taskType: 'SEMANTIC_SIMILARITY' },
      })
      const embeddings = response.embeddings?.map((item) => item.values)
      if (embeddings?.length !== texts.length || embeddings.some((item) => !Array.isArray(item) || !item.length)) {
        throw Object.assign(new Error('The embedding service returned an incomplete response.'), { status: 502, code: 'GEMINI_INVALID_RESPONSE', failureCategory: 'gemini_invalid_response' })
      }
      return embeddings
    }, { maxAttempts: 3, baseDelayMs: 150 })
  } catch (error) {
    error.failureCategory ||= classifyGeminiError(error)
    throw error
  }
}

export async function findRecommendedJobs({ role, skills = [], location = 'india', tag = '', resumeText = '' }) {
  const profileHash = createHash('sha256').update(resumeText).digest('hex')
  const usesEmbeddings = Boolean(resumeText)
  if (usesEmbeddings && !process.env.GEMINI_API_KEY) throw Object.assign(new Error('Job recommendations require Gemini configuration.'), { status: 503, code: 'GEMINI_NOT_CONFIGURED', failureCategory: 'gemini_not_configured' })
  const storedSkills = mongoose.connection.readyState === 1 ? await Skill.find({}, { name: 1, _id: 0 }).lean().catch(() => []) : []
  const skillCatalog = [...new Set([...getSkillCatalog(), ...storedSkills.map(({ name }) => name)])]
  const key = JSON.stringify({ role, skills, location, tag, profileHash, skillCatalog, embeddingModel: usesEmbeddings ? embeddingModel() : null })
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value
  const params = new URLSearchParams({ count: '50', tag: tag || role })
  try {
    const response = await fetch(`https://jobicy.com/api/v2/remote-jobs?${params}`); if (!response.ok) throw new Error('Jobicy unavailable')
    const jobs = (await response.json()).jobs || []
    const eligible = jobs.map((job) => ({ job, baseline: scoreJob(job, { role, skills, location }) }))
      .filter(({ baseline }) => baseline.geographicScore > 0)
      .sort((a, b) => b.baseline.finalScore - a.baseline.finalScore)
      .slice(0, 20)
    if (usesEmbeddings && eligible.length) {
      const embeddings = await embedTexts([resumeText, ...eligible.map(({ job }) => clean(`${job.jobTitle || ''} ${job.jobDescription || ''}`))])
      const value = eligible.map(({ job }, index) => {
        const similarity = cosineSimilarity(embeddings[0], embeddings[index + 1])
        if (!Number.isFinite(similarity)) throw Object.assign(new Error('Gemini returned invalid recommendation embeddings.'), { status: 502, code: 'GEMINI_INVALID_RESPONSE', failureCategory: 'gemini_invalid_response' })
        return scoreJobWithContext(job, { role, skills, location, resumeText, semanticScore: (similarity + 1) / 2, skillCatalog })
      }).sort((a, b) => b.finalScore - a.finalScore).slice(0, 8)
      const result = { source: 'Jobicy', jobs: value, fallbackSearchLinks: fallbackLinks(role) }; cache.set(key, { value: result, expires: Date.now() + 15 * 60 * 1000 }); return result
    }
    const value = eligible.map(({ job }) => scoreJobWithContext(job, { role, skills, location, skillCatalog }))
      .sort((a, b) => b.finalScore - a.finalScore).slice(0, 8)
    const result = { source: 'Jobicy', jobs: value, fallbackSearchLinks: fallbackLinks(role) }; cache.set(key, { value: result, expires: Date.now() + 15 * 60 * 1000 }); return result
  } catch (error) {
    if (usesEmbeddings) throw error
    return { source: null, jobs: [], fallbackSearchLinks: fallbackLinks(role) }
  }
}
function geographyScore(location, scope) { if (scope === 'global') return 70; const value = location.toLowerCase(); const foreignOnly = /united states|\busa\b|canada|united kingdom|\buk\b|europe only|us only/.test(value); if (foreignOnly) return 0; if (/india|\bin\b/.test(value)) return 100; if (/anywhere|worldwide|global/.test(value)) return scope === 'remote-india' ? 70 : 70; return scope === 'remote-india' && /remote/.test(value) ? 70 : 0 }
function fallbackLinks(role) { const query = encodeURIComponent(`${role} India`); return [{ name: 'LinkedIn Jobs', url: `https://www.linkedin.com/jobs/search/?keywords=${query}` }, { name: 'Naukri', url: 'https://www.naukri.com/' }, { name: 'Indeed India', url: `https://in.indeed.com/jobs?q=${query}` }, { name: 'Internshala', url: 'https://internshala.com/jobs' }, { name: 'Wellfound', url: 'https://wellfound.com/jobs' }, { name: 'Cutshort', url: 'https://cutshort.io/jobs' }] }
