import jobRoles from '../data/jobRoles.js'

const aliases = new Map([
  ['reactjs', 'react'], ['nodejs', 'node.js'], ['mongodb', 'mongodb'], ['postgres', 'postgresql'],
  ['js', 'javascript'], ['ts', 'typescript'], ['k8s', 'kubernetes'], ['ml', 'machine learning'],
])
const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim().replace(/\s+/g, ' ')
const catalog = new Map()

for (const role of jobRoles) {
  for (const skill of [...(role.requiredSkills || []), ...(role.preferredSkills || [])]) {
    const normalized = canonicalSkillName(skill)
    if (normalized && !catalog.has(normalized)) catalog.set(normalized, skill)
  }
}

export function canonicalSkillName(value) {
  const normalized = normalize(value).replace(/^node js$/, 'node.js')
  if (!normalized) return ''
  const firstWord = normalized.split(' ')[0]
  const canonical = aliases.get(firstWord)
  return canonical && normalized === firstWord ? canonical : normalized
}

export function validateSkillName(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.length <= 50 && /^[a-zA-Z0-9][a-zA-Z0-9 .+#/&-]*$/.test(trimmed) && /[a-zA-Z]/.test(trimmed)
}

export function registerAcceptedSkill(value) {
  if (!validateSkillName(value)) return { accepted: false, reason: 'invalid' }
  const canonical = canonicalSkillName(value)
  if (!canonical) return { accepted: false, reason: 'invalid' }
  if (catalog.has(canonical)) return { accepted: false, reason: 'duplicate', skill: catalog.get(canonical) }
  const displayName = value.trim().replace(/\s+/g, ' ')
  catalog.set(canonical, displayName)
  return { accepted: true, skill: displayName }
}

export function getSkillCatalog() {
  return [...catalog.values()].sort((left, right) => left.localeCompare(right))
}

export function normalizeSkillKey(value) {
  return canonicalSkillName(value)
}

export function loadAcceptedSkills(skills = []) {
  for (const skill of skills) registerAcceptedSkill(skill)
}