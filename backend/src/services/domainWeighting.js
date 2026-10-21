const domainTerms = {
  backend: ['backend', 'server side', 'api', 'rest api', 'microservices'],
  frontend: ['frontend', 'front end', 'user interface', 'web interface', 'react', 'angular', 'vue'],
  'full-stack': ['full stack', 'fullstack', 'end to end'],
  'data-science': ['data science', 'data scientist', 'data analysis', 'analytics', 'statistical'],
  'ai-ml': ['artificial intelligence', 'machine learning', 'deep learning', 'generative ai', 'llm', 'nlp'],
  devops: ['devops', 'site reliability', 'infrastructure', 'cloud platform', 'continuous integration', 'kubernetes', 'terraform', 'docker', 'aws', 'linux'],
}

const skillWeights = {
  backend: { 'node.js': 1.5, express: 1.35, 'rest api': 1.3, database: 1.2, postgresql: 1.2, mongodb: 1.15, docker: 1.1 },
  frontend: { react: 1.5, javascript: 1.25, typescript: 1.2, html: 1.15, css: 1.15, accessibility: 1.2 },
  'full-stack': { javascript: 1.3, react: 1.2, 'node.js': 1.2, express: 1.15, database: 1.1 },
  'data-science': { python: 1.4, sql: 1.3, 'data analysis': 1.35, statistics: 1.3, 'power bi': 1.1, tableau: 1.1 },
  'ai-ml': { python: 1.3, 'machine learning': 1.5, tensorflow: 1.3, pytorch: 1.3, nlp: 1.25 },
  devops: { docker: 1.35, kubernetes: 1.5, aws: 1.3, linux: 1.2, terraform: 1.35, 'ci/cd': 1.3 },
}

const normalize = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()

export function detectJobDomain({ jobTitle = '', jobDescription = '', skills = [] } = {}) {
  const text = normalize([jobTitle, jobDescription, ...skills].join(' '))
  let selected = null
  let highestScore = 0

  for (const [domain, terms] of Object.entries(domainTerms)) {
    const score = terms.reduce((count, term) => count + (text.includes(normalize(term)) ? 1 : 0), 0)
    if (score > highestScore) {
      selected = domain
      highestScore = score
    }
  }

  return selected
}

export function domainSkillWeight(skill, domain) {
  if (!domain || !skillWeights[domain]) return 1
  return skillWeights[domain][normalize(skill)] || 1
}

export function weightedSkillScore(skills, matchedSkills, domain) {
  const weights = skills.map((skill) => domainSkillWeight(skill, domain))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (!totalWeight) return 0
  const matched = new Set(matchedSkills.map(normalize))
  const matchedWeight = skills.reduce((sum, skill, index) => sum + (matched.has(normalize(skill)) ? weights[index] : 0), 0)
  return Math.round((matchedWeight / totalWeight) * 70)
}