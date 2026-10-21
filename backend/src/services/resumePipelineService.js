import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { GoogleGenAI, Type } from '@google/genai'
import jobRoles from '../data/jobRoles.js'

const model = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const meaningful = (value) => typeof value === 'string' && value.trim() && !/^\.+$/.test(value.trim())
const stringArray = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\n]/) : []).map((item) => typeof item === 'string' ? item.trim() : item?.name || item?.value || item?.skill || '').filter(meaningful)
const objectArray = (value, label = 'description') => Array.isArray(value) ? value.flatMap((item) => {
  if (typeof item === 'string' && meaningful(item)) return [{ [label]: item.trim() }]
  return item && typeof item === 'object' && !Array.isArray(item) ? [item] : []
}) : []
const retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504])
let createGeminiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export function setGeminiClientFactory(factory) {
  if (typeof factory !== 'function') throw new TypeError('A Gemini client factory must be a function.')
  createGeminiClient = factory
}

export function resetGeminiClientFactory() {
  createGeminiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

export function isRetryableGeminiError(error) {
  if (!error) return false
  const status = Number(error?.status ?? error?.statusCode ?? error?.code ?? error?.error?.status ?? 0)
  const message = String(error?.message ?? error?.error?.message ?? '').toLowerCase()
  if (retryableStatusCodes.has(status) || status >= 500) return true
  if (status === 429 || status === 408) return true
  return /rate limit|too many requests|temporarily unavailable|unavailable|timeout|timed out|try again later/i.test(message)
}

export async function withGeminiRetry(operationName, request, { maxAttempts = 3, baseDelayMs = 150 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (!isRetryableGeminiError(error) || attempt >= maxAttempts) throw error
      const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), 800) + Math.floor(Math.random() * 100)
      console.warn(`[Gemini] ${operationName} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms.`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

export const isSupportedResume = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer)) return false
  if (/\.pdf$/i.test(file.originalname)) return file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
  if (/\.docx$/i.test(file.originalname)) return file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  return false
}

export async function extractResumeText(file) {
  let text = ''
  if (/\.pdf$/i.test(file.originalname)) {
    const parser = new PDFParse({ data: file.buffer })
    try { text = (await parser.getText()).text } finally { await parser.destroy() }
  } else if (/\.docx$/i.test(file.originalname)) text = (await mammoth.extractRawText({ buffer: file.buffer })).value
  text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
  if (text.length < 80) throw Object.assign(new Error('We could not extract readable text. Please upload a text-based PDF or DOCX resume.'), { status: 422 })
  return text
}

function redactContactInformation(text) {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[redacted email]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[redacted link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted phone]')
    .replace(/^(?:home\s+)?address\s*[:|-].*$/gim, '[redacted address]')
}

function geminiServiceUnavailable(message = 'Resume analysis is temporarily unavailable. Please try again in a moment.') {
  const error = new Error(message)
  error.status = 503
  error.retryable = true
  error.code = 'GEMINI_UNAVAILABLE'
  return error
}

const resumeResponseSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    email: { type: Type.STRING },
    headline: { type: Type.STRING },
    professionalSummary: { type: Type.STRING },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    education: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { degree: { type: Type.STRING }, institution: { type: Type.STRING }, school: { type: Type.STRING }, year: { type: Type.STRING }, graduationYear: { type: Type.STRING }, description: { type: Type.STRING }, cgpa: { type: Type.STRING } } } },
    experience: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, role: { type: Type.STRING }, company: { type: Type.STRING }, duration: { type: Type.STRING }, dates: { type: Type.STRING }, description: { type: Type.STRING } } } },
    projects: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, name: { type: Type.STRING }, description: { type: Type.STRING }, contribution: { type: Type.STRING }, technologies: { type: Type.ARRAY, items: { type: Type.STRING } }, github: { type: Type.STRING }, githubUrl: { type: Type.STRING }, demo: { type: Type.STRING }, demoUrl: { type: Type.STRING } } } },
    certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
    github: { type: Type.STRING },
    linkedin: { type: Type.STRING },
    website: { type: Type.STRING },
    professionalLinks: { type: Type.OBJECT, properties: { github: { type: Type.STRING }, linkedin: { type: Type.STRING }, website: { type: Type.STRING }, portfolio: { type: Type.STRING } } },
    achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
    languages: { type: Type.ARRAY, items: { type: Type.STRING } },
    resumeSectionsPresent: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
}

function extractProfessionalLinks(text) {
  const links = { github: '', linkedin: '', website: '' }
  const urls = text.match(/(?:https?:\/\/)?(?:www\.)?[^\s<>]*?(?:github\.com|linkedin\.com|[a-z0-9-]+\.[a-z]{2,})[^\s<>]*/gi) || []
  for (const candidate of urls) {
    const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
    try {
      const url = new URL(normalized.replace(/[),.;]+$/, ''))
      if (!['https:', 'http:'].includes(url.protocol)) continue
      const host = url.hostname.toLowerCase()
      if (host.includes('github.com')) links.github ||= url.toString()
      else if (host.includes('linkedin.com')) links.linkedin ||= url.toString()
      else if (!/example\.(com|org|net)$/.test(host)) links.website ||= url.toString()
    } catch { /* Ignore malformed or partial URLs. */ }
  }
  return Object.fromEntries(Object.entries(links).filter(([, value]) => value))
}

export async function parseResume(text) {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error('Resume analysis is not configured yet. Please add GEMINI_API_KEY to backend/.env.'), { status: 503, code: 'GEMINI_NOT_CONFIGURED', retryable: false })
  }

  const ai = createGeminiClient()
  const response = await withGeminiRetry('resume parsing', async () => ai.models.generateContent({
    model: model(),
    contents: `Extract only facts from this resume. Never invent skills or experience. Use empty arrays for absent lists; never use punctuation placeholders.\n${redactContactInformation(text)}`,
    config: { responseMimeType: 'application/json', responseSchema: resumeResponseSchema },
  }))

  try {
    const extracted = JSON.parse(response.text)
    const professionalLinks = { ...extractProfessionalLinks(text), ...(extracted.professionalLinks || {}) }
    return { ...extracted, professionalLinks }
  } catch (error) {
    throw geminiServiceUnavailable('Resume analysis is temporarily unavailable. Please try again in a moment.')
  }
}

function resumeSource(profile = {}) {
  let source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {}
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = source.resume || source.profile || source.data?.resume
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break
    source = { ...source, ...nested }
  }
  return source
}

export const normalizeResume = (profile = {}) => {
  const source = resumeSource(profile)
  const summary = source.professionalSummary || source.professional_summary || source.summary
  return {
    name: meaningful(source.name) ? source.name.trim() : '',
    email: meaningful(source.email) ? source.email.trim() : '',
    professionalSummary: meaningful(summary) ? summary.trim() : '',
    summary: meaningful(summary) ? summary.trim() : '',
    headline: meaningful(source.headline || source.professionalHeadline || source.currentTitle) ? (source.headline || source.professionalHeadline || source.currentTitle).trim() : '',
    github: meaningful(source.github || source.githubUrl) ? (source.github || source.githubUrl).trim() : '',
    linkedin: meaningful(source.linkedin || source.linkedinUrl) ? (source.linkedin || source.linkedinUrl).trim() : '',
    website: meaningful(source.website || source.portfolioUrl) ? (source.website || source.portfolioUrl).trim() : '',
    professionalLinks: source.professionalLinks && typeof source.professionalLinks === 'object' ? source.professionalLinks : {},
    skills: stringArray(source.skills),
    education: objectArray(source.education, 'degree'),
    experience: objectArray(source.experience, 'title'),
    projects: objectArray(source.projects, 'title'),
    certifications: stringArray(source.certifications),
    achievements: stringArray(source.achievements),
    languages: stringArray(source.languages),
    resumeSectionsPresent: stringArray(source.resumeSectionsPresent),
    resumeSectionsMissing: stringArray(source.resumeSectionsMissing),
  }
}

export const deterministicMatches = (resume = {}) => {
  const skillKey = (skill) => skill.toLowerCase().replace(/react\s*\.?\s*js|reactjs/g, 'react').replace(/node\s*\.?\s*js|nodejs/g, 'node').replace(/express\s*\.?\s*js/g, 'express').replace(/mongo\s*db/g, 'mongodb').replace(/[^a-z0-9+#]+/g, ' ').trim()
  const normalizedSkills = stringArray(resumeSource(resume).skills).map(skillKey)
  return jobRoles.map((role) => {
    const required = role.requiredSkills || role.coreSkills || []
    const matched = required.filter((skill) => {
      const target = skillKey(skill)
      return normalizedSkills.some((value) => value === target || value.startsWith(`${target} `) || target.startsWith(`${value} `))
    })
    return { role, matched, score: Number.isFinite(required.length) && required.length > 0 ? Math.round((matched.length / required.length) * 70) : null }
  }).filter((match) => Number.isFinite(match.score) && match.matched.length > 0).sort((left, right) => right.score - left.score).slice(0, 4)
}

export async function contextualAnalysis(resume, matches) {
  const ai = createGeminiClient()
  const professionalProfile = Object.fromEntries(Object.entries(resume).filter(([key]) => !['name', 'email'].includes(key)))
  const response = await withGeminiRetry('contextual analysis', async () => ai.models.generateContent({
    model: model(),
    contents: `Using only the profile ${redactContactInformation(JSON.stringify(professionalProfile))} and roles ${JSON.stringify(matches.map((m) => m.role.title))}, return factual JSON. Each semanticScores item must be a relevance score from 0 to 100 (not 0 to 1), aligned with the role order. Never invent skills. Use [] when no item is useful. Never emit '.', '...', Markdown, or placeholders.`,
    config: { responseMimeType: 'application/json', responseSchema: { type: Type.OBJECT, properties: { semanticScores: { type: Type.ARRAY, items: { type: Type.NUMBER } }, strengths: { type: Type.ARRAY, items: { type: Type.STRING } }, missingSkills: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { skill: { type: Type.STRING }, importance: { type: Type.STRING }, reason: { type: Type.STRING } } } }, missingSections: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { section: { type: Type.STRING }, importance: { type: Type.STRING }, reason: { type: Type.STRING } } } }, improvementSuggestions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, suggestion: { type: Type.STRING } } } }, overallSummary: { type: Type.STRING } } } },
  }))

  try {
    return normalizeContextualAnalysis(JSON.parse(response.text))
  } catch (error) {
    throw geminiServiceUnavailable('Contextual analysis is temporarily unavailable. Please try again in a moment.')
  }
}

export function normalizeContextualAnalysis(value = {}) { const named = (items, key) => objectArray(items).map((item) => ({ [key]: meaningful(item[key]) ? item[key].trim() : '', importance: meaningful(item.importance) ? item.importance.trim().toLowerCase() : 'medium', reason: meaningful(item.reason) ? item.reason.trim() : '' })).filter((item) => item[key]); return { semanticScores: (Array.isArray(value.semanticScores) ? value.semanticScores : []).map(Number).filter((score) => Number.isFinite(score) && score >= 0 && score <= 100), strengths: stringArray(value.strengths), missingSkills: named(value.missingSkills, 'skill'), missingSections: named(value.missingSections, 'section'), improvementSuggestions: objectArray(value.improvementSuggestions).map((item) => ({ category: meaningful(item.category) ? item.category.trim() : '', suggestion: meaningful(item.suggestion) ? item.suggestion.trim() : '' })).filter((item) => item.category && item.suggestion), overallSummary: meaningful(value.overallSummary) ? value.overallSummary.trim() : '' } }
