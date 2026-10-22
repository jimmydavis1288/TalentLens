import { classifyGeminiError, contextualAnalysis, deterministicMatches, extractJobDescriptionText, extractResumeText, isSupportedJobDescription, isSupportedResume, normalizeResume, parseResume, redactContactInformation } from '../services/resumePipelineService.js'
import { scoreCareerRoles } from '../services/careerRoleScoring.js'
import crypto from 'node:crypto'
import RecruitmentAnalysis from '../models/RecruitmentAnalysis.js'
import ResumeProfileCache from '../models/ResumeProfileCache.js'
import RecruitmentResumeSource from '../models/RecruitmentResumeSource.js'
import JobProfileCache from '../models/JobProfileCache.js'
import { blockPendingRecruitmentCandidates, claimRecruitmentCandidate, compareAndSetRecruiterScoring, findOwnedRecruitmentAnalysis } from '../services/recruitmentRepository.js'
import { analysisStatus, classifyShortlist, JOB_PROFILE_VERSION, matchUploadedCandidates, registerCandidates, RESUME_PROFILE_VERSION, rescoreCandidate, runCandidateAgent, skillMentionedInText, suggestJobRequirements, validateJobRequirements, validateWeights } from '../services/recruitmentAgentService.js'

export function handleResumeAnalysisError(res, error, next) {
  if (error?.status === 422) {
    const code = error.code === 'DOCX_EXTRACTION_FAILED' ? 'DOCX_EXTRACTION_FAILED' : error.code || 'UNREADABLE_RESUME'
    console.warn('[Analysis] Request failed', { stage: 'extract', category: code.toLowerCase(), status: 422, fallbackUsed: false })
    return res.status(422).json({ success: false, code, message: error.message })
  }
  const category = error?.failureCategory || (error?.code === 'GEMINI_NOT_CONFIGURED' ? 'gemini_not_configured' : classifyGeminiError(error))
  const geminiMessages = {
    gemini_quota_exhausted: [429, 'GEMINI_QUOTA_EXHAUSTED', 'Gemini quota is exhausted. Try again when quota is available, or contact the administrator.'],
    gemini_rate_limited: [429, 'GEMINI_RATE_LIMITED', 'Gemini is rate limiting requests. Please retry shortly.'],
    gemini_unavailable: [503, 'GEMINI_UNAVAILABLE', 'Gemini is temporarily unavailable. Please retry shortly.'],
    gemini_invalid_key: [503, 'GEMINI_INVALID_KEY', 'Gemini credentials are invalid. Contact the administrator to update the backend API key.'],
    gemini_model_unavailable: [502, 'GEMINI_MODEL_UNAVAILABLE', 'The configured Gemini model is unavailable. Contact the administrator to verify the model configuration.'],
    gemini_not_configured: [503, 'GEMINI_NOT_CONFIGURED', 'Resume analysis requires Gemini configuration. Ask the administrator to configure the backend API key.'],
    gemini_invalid_response: [502, 'GEMINI_INVALID_RESPONSE', 'Gemini returned an unreadable analysis. Please retry.'],
  }
  if (geminiMessages[category]) {
    const [status, code, message] = geminiMessages[category]
    console.warn('[Analysis] Request failed', { stage: error?.code === 'UNREADABLE_RESUME' ? 'extract' : 'profile', category, status, fallbackUsed: false })
    return res.status(status).json({ success: false, code, message })
  }
  if (error?.status) return res.status(error.status).json({ success: false, code: error.code || 'RESUME_ANALYSIS_FAILED', message: error.message })
  return next(error)
}

export async function matchCandidates(req, res, next) {
  try {
    const resumes = Array.isArray(req.files) ? req.files : req.files?.resumes || []
    const jobDescription = typeof req.body.jobDescription === 'string' ? req.body.jobDescription.trim() : ''
    let rawRequirements = req.body.requirements || null
    if (typeof rawRequirements === 'string') {
      try { rawRequirements = JSON.parse(rawRequirements) } catch { throw Object.assign(new Error('The reviewed job requirements are malformed.'), { status: 400 }) }
    }
    if (!rawRequirements) throw Object.assign(new Error('Review and submit the selected job requirements before uploading resumes.'), { status: 400 })
    const requirements = validateJobRequirements(rawRequirements, jobDescription)
    if (!requirements.length) return res.status(400).json({ message: 'No source-supported job requirements were selected.' })
    const requestKey = String(req.body.requestKey || req.get('Idempotency-Key') || crypto.randomUUID()).slice(0, 100)
    const candidates = await registerCandidates(resumes, requestKey)
    if (new Set(candidates.map((candidate) => candidate.fileFingerprint)).size !== candidates.length) return res.status(400).json({ message: 'The upload contains identical resume files. Remove duplicates so each candidate can be retried safely.' })
    const jobTitle = String(req.body.jobTitle || '').slice(0, 200)
    let submittedProfile = req.body.jobProfile
    if (typeof submittedProfile === 'string') {
      try { submittedProfile = JSON.parse(submittedProfile) } catch { throw Object.assign(new Error('The reviewed job profile is malformed.'), { status: 400 }) }
    }
    const jobProfile = validateReviewedJobProfile(submittedProfile, jobDescription, requirements)
    jobProfile.roleTitle = jobProfile.roleTitle || jobTitle
    jobProfile.domain = String(req.body.domain || '').trim().slice(0, 100)
    jobProfile.seniority = String(req.body.seniority || '').trim().slice(0, 80)
    jobProfile.experienceRequirement = String(req.body.experienceRequirement || '').trim().slice(0, 200)
    const shortlistCriteria = validateShortlistCriteria(parseJsonField(req.body.shortlistCriteria, { minimumFitScore: 70, minimumEvidenceCoverage: 50 }))
    if (!req.body.weights) req.body.weights = JSON.stringify({ skills: Object.fromEntries(jobProfile.requirements.map((item) => [item.name, item.importance === 'essential' ? 3 : 1])) })
    const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify({ jobDescription, jobTitle, requirements, jobProfile, shortlistCriteria, fileFingerprints: candidates.map((candidate) => candidate.fileFingerprint).sort() })).digest('hex')
    const existing = await RecruitmentAnalysis.findOne({ ownerId: req.user.id, requestKey })
    if (existing) {
      if (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint) return res.status(409).json({ message: 'This idempotency key was already used for different analysis content. Start a new analysis request.' })
      return res.json({ ...analysisStatus(existing), rankedCandidates: ranked(existing), message: 'This analysis request was already registered.' })
    }
    let weights
    try { weights = validateWeights(req.body.weights ? JSON.parse(req.body.weights) : {}, requirements) } catch (error) { if (!error.status) error.status = 400; throw error }
    let analysis
    try { analysis = await RecruitmentAnalysis.create({
      ownerId: req.user.id, requestKey, requestFingerprint, jobTitle: jobTitle || jobProfile.roleTitle, jobDescription: redactContactInformation(jobDescription), jobProfile,
      requirements, weights, shortlistCriteria,
      candidates: candidates.map(({ candidateId, fileName, fileFingerprint }) => ({ candidateId, fileName, fileFingerprint, status: 'pending' })),
    }) } catch (error) {
      if (error?.code !== 11000) throw error
      const duplicate = await RecruitmentAnalysis.findOne({ ownerId: req.user.id, requestKey })
      if (!duplicate) throw error
      if (duplicate.requestFingerprint && duplicate.requestFingerprint !== requestFingerprint) return res.status(409).json({ message: 'This idempotency key was already used for different analysis content. Start a new analysis request.' })
      return res.json({ ...analysisStatus(duplicate), rankedCandidates: ranked(duplicate), message: 'This analysis request was already registered.' })
    }
    processCandidates(analysis, candidates).catch((error) => console.error('[Recruitment] Background analysis stopped', { analysisId: String(analysis._id), errorName: error?.name || 'Error' }))
    return res.status(202).json({ ...analysisStatus(analysis), rankedCandidates: [], message: 'Analysis started. Progress and completed candidates will appear here.' })
  } catch (error) { return next(error) }
}

export async function reviewRecruitmentRequirements(req, res, next) {
  try {
    const file = req.files?.jobDescriptionFile?.[0]
    if (file && !isSupportedJobDescription(file)) return res.status(400).json({ message: 'Upload a valid PDF or DOCX job description, up to 10MB.' })
    const rawDescription = typeof req.body.jobDescription === 'string' && req.body.jobDescription.trim() ? req.body.jobDescription : file ? await extractJobDescriptionText(file) : ''
    if (rawDescription.length > 20000) throw Object.assign(new Error('The job description is too long. Keep it under 20,000 characters.'), { status: 400 })
    const jobDescription = redactContactInformation(rawDescription).replace(/\s+/g, ' ').trim()
    const fingerprint = crypto.createHash('sha256').update(`${JOB_PROFILE_VERSION}\0${jobDescription}`).digest('hex')
    let result
    const cached = await JobProfileCache.findOne({ fingerprint, schemaVersion: JOB_PROFILE_VERSION, expiresAt: { $gt: new Date() } }).lean()
    if (cached) result = { ...cached.profile, method: 'cache', message: 'Loaded a validated job profile from cache. Review and confirm the requirements before scoring.' }
    else {
      result = await suggestJobRequirements(jobDescription)
      if (result.method === 'structured' && result.jobProfile) await JobProfileCache.updateOne({ fingerprint }, { $set: { profile: result, schemaVersion: JOB_PROFILE_VERSION, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }, { upsert: true })
    }
    result.jobDescription = jobDescription
    if (!result.requirements.length) result.message = 'No requirements were suggested. Add only requirements explicitly supported by the job description.'
    return res.json(result)
  } catch (error) { return next(error) }
}

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { throw Object.assign(new Error('The shortlist criteria are malformed.'), { status: 400 }) }
}

export function validateShortlistCriteria(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Shortlist criteria must be an object.'), { status: 400 })
  const minimumFitScore = Number(value.minimumFitScore ?? 70)
  const minimumEvidenceCoverage = Number(value.minimumEvidenceCoverage ?? 50)
  if (!Number.isFinite(minimumFitScore) || minimumFitScore < 0 || minimumFitScore > 100 || !Number.isFinite(minimumEvidenceCoverage) || minimumEvidenceCoverage < 0 || minimumEvidenceCoverage > 100) throw Object.assign(new Error('Shortlist score and evidence thresholds must be between 0 and 100.'), { status: 400 })
  return { minimumFitScore, minimumEvidenceCoverage }
}

function validateReviewedJobProfile(profile, jobDescription, selectedNames) {
  if (!profile) return { roleTitle: '', purpose: '', responsibilities: [], domainContext: [], requirements: selectedNames.map((name) => ({ name, category: 'skill', importance: 'essential', sourceText: name, confirmed: true })) }
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.requirements)) throw Object.assign(new Error('The reviewed job profile is malformed.'), { status: 400 })
  const source = jobDescription.toLowerCase().replace(/\s+/g, ' ')
  const selected = new Set(selectedNames.map((item) => item.toLowerCase()))
  const requirements = profile.requirements.filter((item) => selected.has(String(item?.name || '').toLowerCase())).map((item) => {
    const name = String(item.name || '').trim().slice(0, 120)
    const sourceText = String(item.sourceText || '').replace(/\s+/g, ' ').trim().slice(0, 400)
    const category = ['skill', 'experience', 'education', 'eligibility', 'project', 'other'].includes(item.category) ? item.category : 'other'
    const importance = item.importance === 'preferred' ? 'preferred' : 'essential'
    if (!name || !sourceText || !source.includes(sourceText.toLowerCase()) || (!sourceText.toLowerCase().includes(name.toLowerCase()) && !skillMentionedInText(sourceText, name))) throw Object.assign(new Error(`Requirement “${name || 'unnamed'}” must cite text that contains the requirement in the job description.`), { status: 400 })
    return { name, sourceText, category, importance, hardConstraint: /\b(?:must(?:-have)?|required|mandatory|minimum|at least)\b/i.test(sourceText), confirmed: true }
  })
  if (requirements.length !== selectedNames.length) throw Object.assign(new Error('Every selected requirement must be part of the reviewed job profile.'), { status: 400 })
  const sourceSupports = (value) => typeof value === 'string' && source.includes(value.toLowerCase().replace(/\s+/g, ' ').trim())
  return {
    roleTitle: sourceSupports(profile.roleTitle) ? profile.roleTitle.slice(0, 200) : '', purpose: sourceSupports(profile.purpose) ? profile.purpose.slice(0, 1000) : '',
    responsibilities: Array.isArray(profile.responsibilities) ? profile.responsibilities.filter(sourceSupports).map((item) => item.slice(0, 400)).slice(0, 30) : [],
    domainContext: Array.isArray(profile.domainContext) ? profile.domainContext.filter(sourceSupports).map((item) => item.slice(0, 200)).slice(0, 30) : [],
    requirements,
  }
}

function ranked(analysis) {
    return [...(analysis?.candidates || [])].filter((candidate) => candidate.status === 'completed').sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((candidate) => ({ candidateId: candidate.candidateId, fileName: candidate.fileName, name: candidate.profile?.name || 'Name not provided', profile: candidate.profile, score: candidate.score, scoreBreakdown: candidate.scoreBreakdown, evidenceCoverage: candidate.evidenceCoverage, evidenceConfidence: candidate.evidenceConfidence, matchedSkills: candidate.matchedSkills, missingRequiredSkills: candidate.missingRequiredSkills, evidence: candidate.evidence, requirementResults: candidate.requirementResults, reviewFlags: candidate.reviewFlags, shortlistStatus: candidate.shortlistStatus, shortlistReasons: candidate.shortlistReasons, jobSpecificExplanation: candidate.jobSpecificExplanation, analysisMethod: candidate.analysisMethod, status: candidate.status }))
}

export function classifyRecruitmentFailure(error) {
  const mongoFailure = /mongo|mongoose|database|connection|serverselection|buffering/i.test(`${error?.name || ''} ${error?.message || ''}`) || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code)
  const message = String(error?.message || '').toLowerCase()
  const failureCode = String(error?.code || '').toLowerCase()
  const quotaExhausted = /quota|resource[_ ]exhausted|daily.?limit/.test(`${message} ${failureCode}`)
  const geminiCategory = error?.failureCategory || classifyGeminiError(error)
  const errorCategory = mongoFailure ? 'database_unavailable' : quotaExhausted ? 'quota_exhausted' : error?.code === 'DOCX_EXTRACTION_FAILED' ? 'docx_extraction_failed' : error?.status === 422 ? 'unreadable_resume' : geminiCategory === 'gemini_invalid_key' ? 'invalid_api_key' : geminiCategory === 'gemini_not_configured' ? 'missing_api_key' : geminiCategory === 'gemini_rate_limited' ? 'rate_limited' : geminiCategory === 'gemini_model_unavailable' ? 'model_unavailable' : geminiCategory === 'gemini_invalid_response' ? 'invalid_ai_response' : geminiCategory === 'gemini_unavailable' ? 'service_unavailable' : 'processing_error'
  return { errorCategory, quotaExhausted, stage: mongoFailure ? 'persist' : error?.status === 422 ? 'extract' : 'profile', status: Number(error?.status ?? error?.statusCode) || null }
}

async function processCandidates(analysis, candidates) {
  let quotaExhausted = false
  let currentAnalysis = analysis
  for (const candidate of candidates) {
    if (quotaExhausted) break
    const leaseId = crypto.randomUUID()
    const now = new Date()
    const claim = await claimRecruitmentCandidate(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: analysis.ownerId, candidateId: candidate.candidateId, leaseId, now })
    if (!claim.modifiedCount) continue
    currentAnalysis = await RecruitmentAnalysis.findOne({ _id: analysis._id, ownerId: analysis.ownerId })
    try {
      const result = await runCandidateAgent(candidate, currentAnalysis.requirements, currentAnalysis.weights, async ({ action, fingerprint, profile, result: score, text }) => {
        if (action === 'save-extracted-text') {
          await RecruitmentResumeSource.updateOne(
            { ownerId: currentAnalysis.ownerId, analysisId: currentAnalysis._id, candidateId: candidate.candidateId },
            { $set: { text, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } },
            { upsert: true },
          )
          return null
        }
        if (action === 'get-cache') {
          const cached = await ResumeProfileCache.findOne({ fingerprint, schemaVersion: RESUME_PROFILE_VERSION, expiresAt: { $gt: new Date() } })
          return cached?.profile || null
        }
        await ResumeProfileCache.updateOne({ fingerprint }, { $set: { profile, schemaVersion: RESUME_PROFILE_VERSION, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }, { upsert: true })
        const saved = await RecruitmentAnalysis.updateOne({
          _id: currentAnalysis._id, ownerId: currentAnalysis.ownerId,
          candidates: { $elemMatch: { candidateId: candidate.candidateId, status: 'processing', leaseId } },
        }, { $set: {
          'candidates.$.profile': profile, 'candidates.$.score': score.score,
          'candidates.$.scoreBreakdown': score.scoreBreakdown, 'candidates.$.matchedSkills': score.matchedSkills,
          'candidates.$.missingRequiredSkills': score.missingRequiredSkills, 'candidates.$.evidence': score.evidence,
          'candidates.$.requirementResults': score.requirementResults, 'candidates.$.evidenceCoverage': score.evidenceCoverage,
          'candidates.$.evidenceConfidence': score.evidenceConfidence, 'candidates.$.reviewFlags': score.reviewFlags,
          'candidates.$.jobSpecificExplanation': score.jobSpecificExplanation, 'candidates.$.shortlistStatus': classifyShortlist(score, currentAnalysis.shortlistCriteria).status,
          'candidates.$.shortlistReasons': classifyShortlist(score, currentAnalysis.shortlistCriteria).reasons,
          'candidates.$.analysisMethod': score.analysisMethod || 'gemini',
          'candidates.$.status': 'completed', 'candidates.$.errorCategory': '', 'candidates.$.updatedAt': new Date(),
          'candidates.$.leaseId': '', 'candidates.$.leaseExpiresAt': null,
        } })
        if (!saved.modifiedCount) throw new Error('Candidate processing lease was lost before saving results.')
        await RecruitmentResumeSource.deleteOne({ ownerId: currentAnalysis.ownerId, analysisId: currentAnalysis._id, candidateId: candidate.candidateId })
      }, currentAnalysis.jobProfile?.requirements || [])
      if (!result) throw new Error('Candidate result was not persisted.')
    } catch (error) {
      const failure = classifyRecruitmentFailure(error)
      quotaExhausted = failure.quotaExhausted
      const errorCategory = failure.errorCategory
      console.error('[Recruitment] Candidate processing failed', { stage: failure.stage, category: errorCategory, status: failure.status, fallbackUsed: false })
      await RecruitmentAnalysis.updateOne({ _id: currentAnalysis._id, ownerId: currentAnalysis.ownerId, candidates: { $elemMatch: { candidateId: candidate.candidateId, status: 'processing', leaseId } } }, { $set: { 'candidates.$.status': quotaExhausted ? 'blocked' : 'failed', 'candidates.$.errorCategory': errorCategory, 'candidates.$.updatedAt': new Date(), 'candidates.$.leaseId': '', 'candidates.$.leaseExpiresAt': null }, $inc: { 'candidates.$.retryCount': 1 } })
    }
  }
  if (quotaExhausted) await blockPendingRecruitmentCandidates(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: analysis.ownerId })
  currentAnalysis = await RecruitmentAnalysis.findOne({ _id: analysis._id, ownerId: analysis.ownerId })
  const statuses = currentAnalysis.candidates.map((candidate) => candidate.status)
  const finalStatus = statuses.every((status) => status === 'completed') ? 'completed' : statuses.some((status) => ['processing', 'pending'].includes(status)) ? 'processing' : statuses.some((status) => status === 'blocked') ? 'blocked' : 'partial'
  await RecruitmentAnalysis.updateOne({ _id: analysis._id, ownerId: analysis.ownerId }, { $set: { status: finalStatus } })
}

export async function getRecruitmentAnalysis(req, res, next) {
  try {
    const analysis = await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, req.params.id, req.user.id)
    if (!analysis) return res.status(404).json({ message: 'Analysis not found.' })
    const storedSources = await RecruitmentResumeSource.find({ ownerId: req.user.id, analysisId: analysis._id, expiresAt: { $gt: new Date() } }, { candidateId: 1 }).lean()
    const sourceIds = new Set(storedSources.map((source) => source.candidateId))
    const status = analysisStatus(analysis)
    status.candidates = status.candidates.map((candidate) => ({ ...candidate, canResume: sourceIds.has(candidate.candidateId) && (['pending', 'failed', 'blocked'].includes(candidate.status) || (candidate.status === 'processing' && Date.now() - new Date(candidate.updatedAt).getTime() > 5 * 60 * 1000)) }))
    return res.json({ ...status, rankedCandidates: ranked(analysis) })
  } catch (error) { return next(error) }
}

export async function updateRecruitmentWeights(req, res, next) {
  try {
    const analysis = await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, req.params.id, req.user.id)
    if (!analysis) return res.status(404).json({ message: 'Analysis not found.' })
    if (analysis.candidates.some((candidate) => ['pending', 'processing'].includes(candidate.status))) return res.status(409).json({ message: 'Wait until the current resume batch finishes before changing scoring priorities.' })
    let weights
    try { weights = validateWeights(req.body.weights, analysis.requirements) } catch (error) { if (!error.status) error.status = 400; throw error }
    analysis.weights = weights
    const shortlistCriteria = validateShortlistCriteria(req.body.shortlistCriteria || analysis.shortlistCriteria || {})
    analysis.shortlistCriteria = shortlistCriteria
    for (const candidate of analysis.candidates) {
      if (candidate.status !== 'completed') continue
      const updated = rescoreCandidate(candidate, analysis.requirements, weights)
      candidate.score = updated.score; candidate.scoreBreakdown = updated.scoreBreakdown
      if (updated.requirementResults) candidate.requirementResults = updated.requirementResults
      const classification = classifyShortlist({ ...candidate.toObject(), score: updated.score }, shortlistCriteria)
      candidate.shortlistStatus = classification.status
      candidate.shortlistReasons = classification.reasons
    }
    const updated = await compareAndSetRecruiterScoring(RecruitmentAnalysis, { analysisId: analysis._id, ownerId: req.user.id, version: analysis.__v, weights: analysis.weights, candidates: analysis.candidates, shortlistCriteria })
    if (!updated.modifiedCount) return res.status(409).json({ message: 'Scoring priorities changed in another request. Refresh the analysis and try again.' })
    const fresh = await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, req.params.id, req.user.id)
    return res.json({ ...analysisStatus(fresh), rankedCandidates: ranked(fresh), message: 'Scores recalculated with the updated recruiter priorities.' })
  } catch (error) { return next(error) }
}

export async function resumeRecruitmentAnalysis(req, res, next) {
  try {
    const analysis = await findOwnedRecruitmentAnalysis(RecruitmentAnalysis, req.params.id, req.user.id)
    if (!analysis) return res.status(404).json({ message: 'Analysis not found.' })
    let eligible
    if (req.files?.length) {
      const uploads = await registerCandidates(req.files, analysis.requestKey)
      const mapped = matchUploadedCandidates(uploads, analysis.candidates)
      const recoverable = (row) => ['failed', 'blocked', 'pending'].includes(row.status) || (row.status === 'processing' && Date.now() - new Date(row.updatedAt).getTime() > 5 * 60 * 1000)
      eligible = mapped.filter(({ candidate }) => recoverable(candidate))
      if (!eligible.length) return res.status(409).json({ message: 'The selected resumes match candidates that are already completed or still processing. No candidate was changed.' })
      const selectedIds = new Set(mapped.map(({ candidateId }) => candidateId))
      const omitted = analysis.candidates.filter((candidate) => recoverable(candidate) && !selectedIds.has(candidate.candidateId)).map((candidate) => candidate.fileName)
      req.retryNotice = omitted.length ? ` Not selected: ${omitted.join(', ')}.` : ''
    } else {
      const recoverableRows = analysis.candidates.filter((candidate) => ['failed', 'blocked', 'pending'].includes(candidate.status) || (candidate.status === 'processing' && Date.now() - new Date(candidate.updatedAt).getTime() > 5 * 60 * 1000))
      if (!recoverableRows.length) return res.status(409).json({ message: 'The current resume batch is still processing.' })
      const sources = await RecruitmentResumeSource.find({ ownerId: req.user.id, analysisId: analysis._id, candidateId: { $in: recoverableRows.map((candidate) => candidate.candidateId) }, expiresAt: { $gt: new Date() } }).select('+text').lean()
      const sourceById = new Map(sources.map((source) => [source.candidateId, source.text]))
      eligible = recoverableRows.filter((candidate) => sourceById.has(candidate.candidateId)).map((candidate) => ({ candidateId: candidate.candidateId, fileName: candidate.fileName, text: sourceById.get(candidate.candidateId) }))
      const missingSources = recoverableRows.filter((candidate) => !sourceById.has(candidate.candidateId))
      for (const row of missingSources) {
        await RecruitmentAnalysis.updateOne({ _id: analysis._id, ownerId: req.user.id, candidates: { $elemMatch: { candidateId: row.candidateId, status: row.status, updatedAt: row.updatedAt } } }, { $set: { 'candidates.$.status': 'failed', 'candidates.$.errorCategory': 'source_not_persisted', 'candidates.$.updatedAt': new Date() } })
      }
      req.retryNotice = missingSources.length ? ` Original files are required for: ${missingSources.map((candidate) => candidate.fileName).join(', ')}.` : ''
    }
    if (!eligible.length) {
      return res.status(409).json({ message: 'No recoverable extracted text is stored for these candidates. Reupload the matching original resume files to resume their work.' })
    }
    processCandidates(analysis, eligible).catch((error) => console.error('[Recruitment] Resume attempt stopped', { analysisId: String(analysis._id), errorName: error?.name || 'Error' }))
    return res.status(202).json({ ...analysisStatus(analysis), rankedCandidates: ranked(analysis), message: `Eligible candidates are being retried. Progress will update here.${req.retryNotice || ''}` })
  } catch (error) { return next(error) }
}

export async function analyzeResume(req, res, next) {
  try {
    if (!req.file || !isSupportedResume(req.file)) return res.status(400).json({ success: false, code: 'UNSUPPORTED_RESUME', message: 'Upload a valid PDF or DOCX resume.' })
    const text = await extractResumeText(req.file)
    const resume = normalizeResume(await parseResume(text))
    const matches = deterministicMatches(resume)
    const ai = await contextualAnalysis(resume, matches)
    const roles = scoreCareerRoles(matches, ai)
    if (!roles.length) throw Object.assign(new Error('We could not identify supported skills or a role match from this resume. Add clearly labeled skills or upload a readable resume.'), { status: 422, code: 'INSUFFICIENT_RESUME_EVIDENCE' })
    return res.json({ success: true, code: 'RESUME_ANALYSIS_COMPLETE', data: { resume, analysisMethod: 'gemini', bestJobRole: roles[0], alternativeRoles: roles.slice(1), strengths: ai.strengths, missingSkills: ai.missingSkills, missingSections: ai.missingSections, improvementSuggestions: ai.improvementSuggestions, overallSummary: ai.overallSummary, contextualAnalysisAvailable: true } })
  } catch (error) { return handleResumeAnalysisError(res, error, next) }
}
