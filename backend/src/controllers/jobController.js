import { findRecommendedJobs } from '../services/jobSearchService.js'
import { normalizeResume } from '../services/resumePipelineService.js'

function profileText(profile = {}) {
  const values = []
  const appendText = (value, depth = 0, key = '') => {
    if (/email|phone|mobile|address|linkedin|portfolio|url|website/i.test(key)) return
    if (typeof value === 'string' || typeof value === 'number') values.push(String(value))
    else if (Array.isArray(value) && depth < 3) value.forEach((item) => appendText(item, depth + 1))
    else if (value && typeof value === 'object' && depth < 3) Object.entries(value).forEach(([field, item]) => appendText(item, depth + 1, field))
  }

  for (const field of ['professionalSummary', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications']) {
    appendText(profile[field])
  }
  return values.join('\n').replace(/\s+/g, ' ').trim().slice(0, 24000)
}

export async function recommendedJobs(req, res, next) {
  try {
    const input = req.method === 'GET' ? req.query : req.body || {}
    const profile = normalizeResume(input.resume && typeof input.resume === 'object' ? input.resume : {})
    const skills = Array.isArray(profile.skills)
      ? profile.skills.filter((skill) => typeof skill === 'string')
      : String(input.skills || '').split(',').filter(Boolean)
    const result = await findRecommendedJobs({
      role: input.role || 'Software Engineer',
      skills,
      location: input.location || 'india',
      tag: input.tag,
      resumeText: profileText(profile),
    })
    res.json({ success: true, ...result })
  } catch (error) { next(error) }
}
