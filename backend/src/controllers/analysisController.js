import { contextualAnalysis, deterministicMatches, extractResumeText, isSupportedResume, normalizeContextualAnalysis, normalizeResume, parseResume } from '../services/resumePipelineService.js'
import { scoreCareerRoles } from '../services/careerRoleScoring.js'

export function handleResumeAnalysisError(res, error, next) {
  if (error?.code === 'GEMINI_NOT_CONFIGURED') {
    return res.status(503).json({ success: false, message: 'Resume analysis requires Gemini configuration. Add GEMINI_API_KEY to the backend environment.' })
  }
  const temporaryAiFailure = error?.status === 429 || error?.status === 503 || error?.status >= 500 || error?.retryable === true
  if (temporaryAiFailure) {
    return res.status(503).json({ success: false, message: 'Resume analysis is temporarily unavailable. Please try again in a moment.' })
  }
  if (error.status) return res.status(error.status).json({ success: false, message: error.message })
  return next(error)
}

export async function matchCandidates(req, res, next) {
  try {
    const resumes = req.files || []
    if (!req.body.jobDescription?.trim()) return res.status(400).json({ message: 'A job description is required.' })
    if (!resumes.length || resumes.some((file) => !isSupportedResume(file))) return res.status(400).json({ message: 'Upload 1 to 50 PDF, DOC, or DOCX resumes.' })
    return res.status(501).json({ message: 'Recruiter matching is not implemented in the current Job Seeker release.' })
  } catch (error) { return next(error) }
}

export async function analyzeResume(req, res, next) {
  try {
    if (!req.file || !isSupportedResume(req.file)) return res.status(400).json({ message: 'Upload a PDF, DOC, or DOCX resume.' })
    const text = await extractResumeText(req.file)
    const resume = normalizeResume(await parseResume(text))
    const matches = deterministicMatches(resume)
    let ai = normalizeContextualAnalysis()
    let contextualAnalysisAvailable = true
    try {
      ai = await contextualAnalysis(resume, matches)
    } catch (error) {
      const transientFailure = error?.status === 429 || error?.status === 503 || Number(error?.status) >= 500 || error?.retryable === true
      if (!transientFailure) throw error
      contextualAnalysisAvailable = false
    }
    const roles = scoreCareerRoles(matches, ai)
    return res.json({ success: true, data: { resume, bestJobRole: roles[0] || { title: 'No matching role found', score: null, matchingMethod: 'structured-skills', reason: 'No supported role skills were extracted from this resume.' }, alternativeRoles: roles.slice(1), strengths: ai.strengths, missingSkills: ai.missingSkills, missingSections: ai.missingSections, improvementSuggestions: ai.improvementSuggestions, overallSummary: contextualAnalysisAvailable ? ai.overallSummary : 'Contextual AI was unavailable; the role result uses structured skill overlap only.', contextualAnalysisAvailable } })
  } catch (error) { return handleResumeAnalysisError(res, error, next) }
}
