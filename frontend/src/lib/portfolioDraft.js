const list = (value) => Array.isArray(value) ? value : []
const text = (value) => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : ''
const safeLink = (value) => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

export function normalizePortfolioDraft(input = {}) {
  let source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = source.resume || source.profile || source.data?.resume
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) break
    source = { ...source, ...nested }
  }

  const links = source.links || source.professionalLinks || {}
  return {
    name: text(source.name),
    headline: text(source.headline || source.professionalHeadline || source.currentTitle),
    summary: text(source.summary || source.professionalSummary || source.professional_summary),
    skills: list(source.skills).map((skill) => text(typeof skill === 'object' ? skill.name || skill.skill || skill.value : skill)).filter(Boolean),
    projects: list(source.projects).filter((item) => item && typeof item === 'object').map((item) => ({
      title: text(item.title || item.name),
      description: text(item.description || item.summary || item.contribution),
      technologies: text(item.technologies || item.technology || item.stack),
      github: safeLink(text(item.github || item.githubUrl)),
      demo: safeLink(text(item.demo || item.demoUrl || item.url)),
    })).filter((item) => item.title || item.description),
    experience: list(source.experience).filter((item) => item && typeof item === 'object').map((item) => ({
      title: text(item.title || item.role || item.position),
      company: text(item.company || item.organization),
      duration: text(item.duration || item.dates || item.period),
      description: text(item.description || item.summary),
    })).filter((item) => Object.values(item).some(Boolean)),
    education: list(source.education).filter((item) => item && typeof item === 'object').map((item) => ({
      degree: text(item.degree || item.qualification),
      institution: text(item.institution || item.school || item.university),
      year: text(item.year || item.graduationYear || item.dates),
      description: text(item.description || item.cgpa || item.grade),
    })).filter((item) => Object.values(item).some(Boolean)),
    certifications: list(source.certifications).map((item) => text(typeof item === 'object' ? item.name || item.title || item.certification : item)).filter(Boolean),
    links: Object.fromEntries(['github', 'linkedin', 'website'].map((key) => [key, safeLink(text(source[key] || links[key] || (key === 'website' ? links.portfolio : '')))]).filter(([, value]) => value)),
    contactEmail: '',
    publishEmail: false,
  }
}

export function portfolioStorageKey(userValue) {
  let user = userValue
  if (typeof userValue === 'string') {
    try { user = JSON.parse(userValue) } catch { user = null }
  }
  const identity = user?._id || user?.id || user?.email || 'local'
  return `talentlens_portfolio_v1:${encodeURIComponent(String(identity).toLowerCase())}`
}

export function savePortfolioDraft(storage, key, portfolio) {
  storage.setItem(key, JSON.stringify(portfolio))
}

export function readPortfolioDraft(storage, key) {
  try {
    const value = storage.getItem(key)
    return value ? normalizePortfolioDraft(JSON.parse(value)) : null
  } catch {
    return null
  }
}