import crypto from 'node:crypto'
import { classifyGeminiError, containsProtectedQualification, extractResumeText, extractStructuredJobProfile, isSupportedResume, normalizeResume, parseResume, redactContactInformation } from './resumePipelineService.js'

export const AGENT_STATES = Object.freeze(['validate', 'extract', 'profile', 'match', 'persist', 'done'])
const skillsCatalog = ['javascript', 'typescript', 'react', 'node.js', 'express', 'mongodb', 'sql', 'python', 'java', 'c++', 'c#', 'aws', 'azure', 'docker', 'kubernetes', 'git', 'html', 'css', 'rest api', 'machine learning', 'data analysis', 'project management', 'communication']
export const RESUME_PROFILE_VERSION = `resume-profile-v1:${process.env.GEMINI_MODEL || 'gemini-3.6-flash'}`
export const JOB_PROFILE_VERSION = `job-profile-v1:${process.env.GEMINI_MODEL || 'gemini-3.6-flash'}`
const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out.`), { status: 503, retryable: true })), ms)
  Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer))
})

export function requirementsFromJob(jobDescription) {
  if (typeof jobDescription !== 'string' || jobDescription.trim().length < 30 || jobDescription.length > 20000) {
    throw Object.assign(new Error('Enter a job description between 30 and 20,000 characters.'), { status: 400 })
  }
  return skillsCatalog.filter((skill) => skillMentionedInText(jobDescription, skill))
}

const skillAliases = new Map([
  ['react.js', 'react'], ['reactjs', 'react'], ['nodejs', 'node.js'], ['node js', 'node.js'],
  ['js', 'javascript'], ['ts', 'typescript'], ['mongo db', 'mongodb'], ['postgres', 'postgresql'],
  ['amazon web services', 'aws'], ['microsoft azure', 'azure'], ['k8s', 'kubernetes'],
])

export function normalizeSkillName(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/g, '')
  return skillAliases.get(normalized) || normalized
}

function skillTerms(skill) {
  const normalized = normalizeSkillName(skill)
  const aliases = [...skillAliases.entries()].filter(([, canonical]) => canonical === normalized).map(([alias]) => alias)
  return [...new Set([normalized, ...aliases])]
}

export function skillMentionIndex(text, skill) {
  for (const term of skillTerms(skill)) {
    const leftBoundary = ['js', 'ts'].includes(term) ? '(^|[^a-z0-9+#.])' : '(^|[^a-z0-9+#])'
    const pattern = `${leftBoundary}${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#]|$)`
    const matches = new RegExp(pattern, 'ig')
    let match
    while ((match = matches.exec(text))) {
      const index = match.index + match[1].length
      const prior = text.slice(Math.max(0, index - 100), index)
      if (!/(?:\bno\b|\bnot\b|\bnever\b|\bwithout\b|\black(?:s|ed|ing)?\b)\s+(?:(?:any|prior|professional|hands-on|work|practical|direct|have|yet|experience|experiences|familiarity|knowledge|proficiency|background|skills?|familiar|experienced|working|with|in|of)\s+){0,6}$/i.test(prior)) return index
    }
  }
  return -1
}

export function skillMentionedInText(text, skill) { return skillMentionIndex(text, skill) !== -1 }

export async function suggestJobRequirements(jobDescription) {
  if (typeof jobDescription !== 'string' || jobDescription.trim().length < 30 || jobDescription.length > 20000) throw Object.assign(new Error('Enter a job description between 30 and 20,000 characters.'), { status: 400 })
  const jobProfile = await extractStructuredJobProfile(jobDescription)
  jobProfile.requirements = jobProfile.requirements.map((item) => ({ ...item, name: item.category === 'skill' ? normalizeSkillName(item.name) : item.name }))
  const seen = new Set()
  jobProfile.requirements = jobProfile.requirements.filter((requirement) => {
    const key = normalizeSkillName(requirement.name)
    if (!key || key.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}+#./ &-]*$/u.test(key) || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 60)
  return { requirements: jobProfile.requirements.slice(0, 30).map((item) => item.name), jobProfile, method: 'structured', message: jobProfile.message }
}

export function validateJobRequirements(value, jobDescription) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw Object.assign(new Error('Select between 1 and 30 job requirements for recruiter review.'), { status: 400 })
  const requirements = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 80) throw Object.assign(new Error('A selected job skill is invalid.'), { status: 400 })
    const skill = normalizeSkillName(item)
    if (containsProtectedQualification(skill)) throw Object.assign(new Error('Protected personal characteristics cannot be used as recruiter scoring requirements.'), { status: 400 })
    if (!/^[\p{L}\p{N}][\p{L}\p{N}+#./ &-]*$/u.test(skill) || !skillMentionedInText(jobDescription, skill)) throw Object.assign(new Error(`The selected skill “${item}” is not explicitly present in the job description.`), { status: 400 })
    if (!requirements.includes(skill)) requirements.push(skill)
  }
  return requirements
}

export function validateWeights(value = {}, requirements = []) {
  if (value.skills != null && (typeof value.skills !== 'object' || Array.isArray(value.skills))) throw Object.assign(new Error('Requirement priorities must be an object keyed by confirmed job requirements.'), { status: 400 })
  const configured = value.skills && typeof value.skills === 'object' && !Array.isArray(value.skills) ? value.skills : {}
  const normalized = Object.fromEntries(requirements.map((skill) => {
    const entry = Object.entries(configured).find(([name]) => name.toLowerCase() === skill.toLowerCase())
    const weight = entry ? Number(entry[1]) : 1
    if (!Number.isFinite(weight) || weight < 0 || weight > 5) throw Object.assign(new Error('Each requirement priority must be between 0 and 5.'), { status: 400 })
    return [skill, weight]
  }))
  if (requirements.length && Object.values(normalized).every((weight) => weight === 0)) throw Object.assign(new Error('At least one required skill must have a priority above zero.'), { status: 400 })
  if (Object.keys(configured).some((skill) => !requirements.some((requirement) => requirement.toLowerCase() === skill.toLowerCase()))) throw Object.assign(new Error('Scoring weights may only reference confirmed job requirements.'), { status: 400 })
  return { skills: normalized }
}

export function profileFingerprint(text) {
  return crypto.createHash('sha256').update(`${RESUME_PROFILE_VERSION}\0${text}`).digest('hex')
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('The parsed resume profile is invalid.')
  const normalized = normalizeResume(profile)
  if (!Array.isArray(normalized.skills) || normalized.skills.some((skill) => typeof skill !== 'string')) throw new Error('The parsed resume profile has invalid skills.')
  return normalized
}

export function sourceGroundedProfile(profile, text) {
  const normalized = validateProfile(profile)
  const mentions = (value) => value && skillMentionedInText(text, value)
  const quoted = (value) => {
    if (typeof value !== 'string') return false
    const source = text.toLowerCase().replace(/\s+/g, ' ')
    const fact = value.toLowerCase().replace(/\s+/g, ' ').trim()
    return Boolean(fact && source.includes(fact))
  }
  const groundedRecords = (records) => records.map((record) => Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === 'string' && quoted(value)).map(([key, value]) => [key, value.slice(0, 1200)]))).filter((record) => Object.keys(record).length > 0)
  return {
    name: mentions(normalized.name) ? normalized.name : '',
    skills: [...new Set(normalized.skills.filter(mentions).map(normalizeSkillName))],
    education: groundedRecords(normalized.education),
    experience: groundedRecords(normalized.experience),
    projects: groundedRecords(normalized.projects),
    certifications: normalized.certifications.filter(quoted).slice(0, 30),
    achievements: normalized.achievements.filter(quoted).slice(0, 30),
  }
}

export function createRecruitmentToolRegistry(dependencies = {}) {
  const tools = {
    getJobRequirements: async ({ jobDescription }) => requirementsFromJob(jobDescription),
    extractResumeText: async ({ file }) => { if (!file || !isSupportedResume(file)) throw new Error('Unsupported resume file.'); return extractResumeText(file) },
    getCachedResumeProfile: async ({ fingerprint }) => dependencies.getCachedResumeProfile?.(fingerprint) || null,
    parseResumeProfile: async ({ text }) => validateProfile(await parseResume(text)),
    validateResumeProfile: async ({ profile }) => validateProfile(profile),
    matchCandidate: async ({ profile, text, requirements, weights }) => scoreCandidate(profile, text, requirements, weights, dependencies.requirementDefinitions),
    scoreCandidate: async ({ profile, text, requirements, weights }) => scoreCandidate(profile, text, requirements, weights, dependencies.requirementDefinitions),
    saveCandidateResult: async ({ fingerprint, profile, result }) => dependencies.saveCandidateResult?.({ fingerprint, profile, result }),
    getAnalysisStatus: async ({ analysis }) => analysis ? analysisStatus(analysis) : null,
  }
  const schemas = {
    getJobRequirements: ['jobDescription'], extractResumeText: ['file'], getCachedResumeProfile: ['fingerprint'],
    parseResumeProfile: ['text'], validateResumeProfile: ['profile'], matchCandidate: ['profile', 'text', 'requirements', 'weights'],
    scoreCandidate: ['profile', 'text', 'requirements', 'weights'], saveCandidateResult: ['fingerprint', 'profile', 'result'], getAnalysisStatus: ['analysis'],
  }
  return Object.freeze({
    names: Object.freeze(Object.keys(tools)),
    async execute(name, args) {
      if (!Object.hasOwn(tools, name)) throw new Error('Recruitment tool is not allowed.')
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Recruitment tool arguments must be an object.')
      const allowed = schemas[name]
      if (Object.keys(args).some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(args, key))) throw new Error('Recruitment tool arguments do not match the tool schema.')
      if (name === 'getJobRequirements' && typeof args.jobDescription !== 'string') throw new Error('Job description must be text.')
      if (name === 'extractResumeText' && (!args.file || !Buffer.isBuffer(args.file.buffer))) throw new Error('Resume file must be a validated upload.')
      if (name === 'getCachedResumeProfile' && typeof args.fingerprint !== 'string') throw new Error('Resume fingerprint must be text.')
      if (name === 'parseResumeProfile' && typeof args.text !== 'string') throw new Error('Resume text must be text.')
      if (['matchCandidate', 'scoreCandidate'].includes(name) && (!Array.isArray(args.requirements) || typeof args.text !== 'string')) throw new Error('Candidate match inputs are invalid.')
      return tools[name](args)
    },
  })
}

export function scoreCandidate(profile, text, requirements, weights = {}, requirementDefinitions = []) {
  const validatedWeights = validateWeights(weights, requirements)
  const findEvidence = (name) => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim().replace(/\s+/g, '\\s+')
    return new RegExp(escaped, 'i').exec(text)?.index ?? -1
  }
  const results = requirements.map((name) => {
    const definition = requirementDefinitions.find((item) => item.name.toLowerCase() === name.toLowerCase()) || { name, category: 'skill', importance: 'essential' }
    const skillIndex = definition.category === 'skill' ? skillMentionIndex(text, name) : -1
    const index = definition.category === 'skill' && skillIndex >= 0 ? skillIndex : findEvidence(name)
    const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const negativePattern = new RegExp(`(?:\\bno\\b|\\bnot\\b|\\bnever\\b|\\bwithout\\b|\\black(?:s|ed|ing)?\\b)(?:\\s+\\w+){0,6}\\s+${escapedName}`, 'i')
    const contradicted = negativePattern.test(text)
    const parsedSkill = definition.category !== 'skill' || profile.skills.some((candidateSkill) => normalizeSkillName(candidateSkill) === normalizeSkillName(name))
    const status = contradicted ? 'contradicted' : index < 0 ? 'not_evidenced' : parsedSkill ? 'supported' : 'partial'
    const excerpt = index < 0 ? '' : text.slice(Math.max(0, index - 80), Math.min(text.length, index + String(name).length + 100)).replace(/\s+/g, ' ').trim()
    const weight = validatedWeights.skills[name] || 0
    return { name, category: definition.category, importance: definition.importance, hardConstraint: Boolean(definition.hardConstraint), status, excerpt, weight, contribution: status === 'supported' ? weight : 0 }
  })
  const matchedSkills = results.filter((item) => item.status === 'supported').map((item) => item.name)
  const missingRequiredSkills = requirements.filter((skill) => !matchedSkills.includes(skill))
  const totalPriority = Object.values(validatedWeights.skills).reduce((total, weight) => total + weight, 0)
  const earnedPriority = matchedSkills.reduce((total, skill) => total + (validatedWeights.skills[skill] || 0), 0)
  const skillScore = requirements.length && totalPriority ? Math.round(earnedPriority / totalPriority * 100) : null
  const evidence = results.filter((item) => item.status === 'supported' && item.excerpt).map(({ name: skill, excerpt }) => ({ skill, excerpt }))
  const dimensionScores = Object.fromEntries(['skill', 'experience', 'project', 'education', 'eligibility', 'other'].map((category) => {
    const rows = results.filter((item) => item.category === category)
    const available = rows.reduce((sum, item) => sum + item.weight, 0)
    const earned = rows.filter((item) => item.status === 'supported').reduce((sum, item) => sum + item.weight, 0)
    return [category, available ? Math.round(earned / available * 100) : null]
  }))
  const evidenceCoverage = results.length ? Math.round(results.filter((item) => item.status !== 'not_evidenced').length / results.length * 100) : 0
  const evidenceConfidence = evidenceCoverage >= 75 ? 'high' : evidenceCoverage >= 40 ? 'moderate' : 'limited'
  const reviewFlags = results.filter((item) => item.hardConstraint && ['contradicted', 'not_evidenced'].includes(item.status)).map((item) => ({ requirement: item.name, reason: item.status === 'contradicted' ? 'Resume text contains contrary evidence.' : 'A mandatory requirement is not evidenced; review manually.' }))
  const essentialRows = results.filter((item) => item.importance === 'essential')
  const preferredRows = results.filter((item) => item.importance === 'preferred')
  const weightedScore = (rows) => {
    const available = rows.reduce((sum, item) => sum + item.weight, 0)
    return available ? Math.round(rows.filter((item) => item.status === 'supported').reduce((sum, item) => sum + item.weight, 0) / available * 100) : null
  }
  const jobSpecificExplanation = `${matchedSkills.length} of ${requirements.length} confirmed requirements have direct resume evidence. ${reviewFlags.length ? `${reviewFlags.length} mandatory item(s) need recruiter review.` : 'No explicit mandatory contradiction was found.'} Evidence coverage is ${evidenceCoverage}%; this is a fit estimate, not a hiring probability.`
  return { score: skillScore, matchedSkills, missingRequiredSkills, evidence, requirementResults: results, evidenceCoverage, evidenceConfidence, reviewFlags, jobSpecificExplanation, scoreBreakdown: { skills: skillScore, essential: weightedScore(essentialRows), preferred: weightedScore(preferredRows), dimensions: dimensionScores, priorityEarned: earnedPriority, priorityAvailable: totalPriority, matched: matchedSkills.length, required: requirements.length } }
}

export function classifyShortlist(candidate, criteria = {}) {
  const minimumFitScore = Number.isFinite(criteria.minimumFitScore) ? criteria.minimumFitScore : 70
  const minimumEvidenceCoverage = Number.isFinite(criteria.minimumEvidenceCoverage) ? criteria.minimumEvidenceCoverage : 50
  const reviewFlags = Array.isArray(candidate.reviewFlags) ? candidate.reviewFlags : []
  if (reviewFlags.length || (candidate.evidenceCoverage ?? 0) < minimumEvidenceCoverage) return { status: 'manual_review', reasons: [...reviewFlags.map((flag) => flag.reason), ...((candidate.evidenceCoverage ?? 0) < minimumEvidenceCoverage ? [`Evidence coverage is below ${minimumEvidenceCoverage}%.`] : [])] }
  if (Number.isFinite(candidate.score) && candidate.score >= minimumFitScore) return { status: 'shortlisted', reasons: [`Fit score meets the ${minimumFitScore}% threshold.`, `Evidence coverage is ${candidate.evidenceCoverage}%.`] }
  return { status: 'not_shortlisted', reasons: [`Fit score is below the ${minimumFitScore}% threshold.`] }
}

export function rescoreCandidate(candidate, requirements, weights) {
  const configured = validateWeights(weights, requirements)
  const total = Object.values(configured.skills).reduce((sum, weight) => sum + weight, 0)
  const supported = new Set((candidate.requirementResults || []).filter((item) => item.status === 'supported').map((item) => item.name))
  const earned = requirements.reduce((sum, skill) => sum + (supported.has(skill) || (!candidate.requirementResults && (candidate.matchedSkills || []).includes(skill)) ? (configured.skills[skill] || 0) : 0), 0)
  const requirementResults = (candidate.requirementResults || []).map((item) => ({ ...item, weight: configured.skills[item.name] || 0, contribution: item.status === 'supported' ? configured.skills[item.name] || 0 : 0 }))
  return { score: total ? Math.round(earned / total * 100) : null, requirementResults, scoreBreakdown: { skills: total ? Math.round(earned / total * 100) : null, priorityEarned: earned, priorityAvailable: total, matched: supported.size || (candidate.matchedSkills || []).length, required: requirements.length } }
}

function candidateIdFor(file, index, requestKey) {
  return crypto.createHash('sha256').update(requestKey).update('\0').update(String(index)).update('\0').update(file.originalname).update('\0').update(file.buffer).digest('hex').slice(0, 32)
}

export function resumeFileFingerprint(file) {
  return crypto.createHash('sha256').update(file.buffer).digest('hex')
}

export function matchUploadedCandidates(uploads, storedCandidates) {
  const byFingerprint = new Map()
  for (const candidate of storedCandidates) {
    if (!candidate.fileFingerprint) continue
    const matches = byFingerprint.get(candidate.fileFingerprint) || []
    matches.push(candidate)
    byFingerprint.set(candidate.fileFingerprint, matches)
  }
  const seenUploads = new Set()
  const matched = []
  const unmatched = []
  for (const upload of uploads) {
    if (seenUploads.has(upload.fileFingerprint)) throw Object.assign(new Error(`The selected file “${upload.fileName}” is duplicated, so it cannot be mapped to one candidate.`), { status: 400 })
    seenUploads.add(upload.fileFingerprint)
    let rows = byFingerprint.get(upload.fileFingerprint) || []
    if (!rows.length) {
      // Analyses created before fingerprints were stored can only be mapped safely
      // when the exact original position, name, and content reproduce the old ID.
      rows = storedCandidates.filter((candidate) => !candidate.fileFingerprint && candidate.candidateId === upload.legacyCandidateId)
    }
    if (rows.length > 1) throw Object.assign(new Error(`The selected file “${upload.fileName}” matches multiple candidates. Reupload a uniquely identifiable original file.`), { status: 409 })
    if (!rows.length) { unmatched.push(upload.fileName); continue }
    matched.push({ ...upload, candidateId: rows[0].candidateId, candidate: rows[0] })
  }
  if (unmatched.length) throw Object.assign(new Error(`These files do not match any resume in this analysis: ${unmatched.join(', ')}. Select the original files for this analysis.`), { status: 400 })
  return matched
}

export async function registerCandidates(files, requestKey) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 50 || files.some((file) => !isSupportedResume(file))) {
    throw Object.assign(new Error('Upload 1 to 50 valid text-based PDF or DOCX resumes (up to 10MB each).'), { status: 400 })
  }
  return files.map((file, index) => {
    const legacyCandidateId = candidateIdFor(file, index, requestKey)
    return { candidateId: legacyCandidateId, legacyCandidateId, fileFingerprint: resumeFileFingerprint(file), fileName: file.originalname, file }
  })
}

export async function runCandidateAgent(candidate, requirements, weights, saveProgress, requirementDefinitions = []) {
  let stateIndex = 0
  const advance = (expected, next) => {
    if (AGENT_STATES[stateIndex] !== expected || AGENT_STATES[stateIndex + 1] !== next) throw new Error('Invalid recruitment agent state transition.')
    stateIndex += 1
  }
  advance('validate', 'extract')
  const tools = createRecruitmentToolRegistry({ requirementDefinitions, getCachedResumeProfile: (fingerprint) => saveProgress({ action: 'get-cache', fingerprint }), saveCandidateResult: saveProgress })
  const extractedText = candidate.text || await withTimeout(tools.execute('extractResumeText', { file: candidate.file }), 20000, 'Resume text extraction')
  const text = redactContactInformation(extractedText)
  if (!candidate.text) await saveProgress({ action: 'save-extracted-text', candidateId: candidate.candidateId, text })
  advance('extract', 'profile')
  const fingerprint = profileFingerprint(text)
  let profile = await tools.execute('getCachedResumeProfile', { fingerprint })
  if (!profile) {
    profile = await withTimeout(tools.execute('parseResumeProfile', { text }), 65000, 'Resume profile parsing')
  }
  else profile = await tools.execute('validateResumeProfile', { profile })
  profile = sourceGroundedProfile(profile, text)
  advance('profile', 'match')
  const result = await tools.execute('matchCandidate', { profile, text, requirements, weights })
  result.analysisMethod = 'gemini'
  advance('match', 'persist')
  await tools.execute('saveCandidateResult', { fingerprint, profile, result })
  advance('persist', 'done')
  return result
}

export function analysisStatus(analysis) {
  const candidates = analysis.candidates || []
  const counts = Object.fromEntries(['completed', 'failed', 'pending', 'processing', 'blocked'].map((status) => [status, candidates.filter((candidate) => candidate.status === status).length]))
  return { id: String(analysis._id), status: analysis.status, jobTitle: analysis.jobTitle, jobProfile: analysis.jobProfile, requirements: analysis.requirements, weights: analysis.weights, shortlistCriteria: analysis.shortlistCriteria || { minimumFitScore: 70, minimumEvidenceCoverage: 50 }, counts, candidates: candidates.map(({ candidateId, fileName, status, profile, score, scoreBreakdown, evidenceCoverage, evidenceConfidence, matchedSkills, missingRequiredSkills, evidence, requirementResults, reviewFlags, shortlistStatus, shortlistReasons, jobSpecificExplanation, errorCategory, analysisMethod, retryCount, updatedAt }) => ({ candidateId, fileName, status, profile, score, scoreBreakdown, evidenceCoverage, evidenceConfidence, matchedSkills, missingRequiredSkills, evidence, requirementResults, reviewFlags, shortlistStatus, shortlistReasons, jobSpecificExplanation, errorCategory, analysisMethod, retryCount, updatedAt })) }
}
