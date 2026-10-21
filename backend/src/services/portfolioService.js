const meaningful = (value) => typeof value === 'string' && value.trim() && !/^\.+$/.test(value.trim())
const cleanText = (value, limit = 1200) => {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : Array.isArray(value) ? value.filter((item) => typeof item === 'string' || typeof item === 'number').join(', ')
      : ''
  return meaningful(text) ? text.trim().slice(0, limit) : ''
}
const cleanList = (value, limit = 12) => (Array.isArray(value) ? value : []).slice(0, limit)

function portfolioSource(profile) {
  let source = profile
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = source.resume || source.profile || source.data?.resume
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break
    source = { ...source, ...nested }
  }
  return source
}

function cleanRecords(value, fields) {
  return cleanList(value).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = Object.fromEntries(fields.map((field) => [field, cleanText(item[field], 500)]).filter(([, text]) => text))
    return Object.keys(record).length ? [record] : []
  })
}

function safeLink(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function portfolioLinks(profile) {
  const supplied = profile.professionalLinks && typeof profile.professionalLinks === 'object' ? profile.professionalLinks : {}
  const candidates = {
    github: profile.github || profile.githubUrl || supplied.github,
    linkedin: profile.linkedin || profile.linkedinUrl || supplied.linkedin,
    website: profile.website || profile.portfolioUrl || supplied.website || supplied.portfolio,
  }
  return Object.fromEntries(Object.entries(candidates).map(([label, url]) => [label, safeLink(url)]).filter(([, url]) => url))
}

export function buildPortfolio(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw Object.assign(new Error('Portfolio data must be an object.'), { status: 400 })
  }

  const source = portfolioSource(profile)
  const portfolio = {
    name: cleanText(source.name, 100),
    headline: cleanText(source.headline || source.professionalHeadline || source.currentTitle, 160),
    summary: cleanText(source.professionalSummary || source.professional_summary || source.summary),
    skills: cleanList(source.skills, 40).map((skill) => typeof skill === 'object' ? skill.name || skill.skill || skill.value : skill).map((skill) => cleanText(skill, 80)).filter(Boolean),
    projects: cleanRecords(source.projects, ['name', 'title', 'description', 'technologies', 'technology', 'stack', 'github', 'githubUrl', 'demo', 'demoUrl', 'url']),
    experience: cleanRecords(source.experience, ['title', 'role', 'company', 'duration', 'dates', 'description']),
    education: cleanRecords(source.education, ['degree', 'institution', 'school', 'year', 'graduationYear', 'description', 'cgpa']),
    certifications: cleanList(source.certifications, 20).map((item) => typeof item === 'object' ? item.name || item.title || item.certification : item).map((item) => cleanText(item, 160)).filter(Boolean),
    links: portfolioLinks(source),
  }

  return Object.fromEntries(Object.entries(portfolio).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value).length > 0
    return Boolean(value)
  }))
}