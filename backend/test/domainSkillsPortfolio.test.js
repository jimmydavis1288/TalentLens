import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { detectJobDomain, domainSkillWeight, weightedSkillScore } from '../src/services/domainWeighting.js'
import { canonicalSkillName, getSkillCatalog, registerAcceptedSkill, validateSkillName } from '../src/services/skillCatalogService.js'
import { buildPortfolio } from '../src/services/portfolioService.js'
import { deterministicMatches, isSupportedResume, normalizeResume, parseResume, resetGeminiClientFactory, setGeminiClientFactory } from '../src/services/resumePipelineService.js'
import { scoreJob, scoreJobWithContext } from '../src/services/jobSearchService.js'
import { boundedScore } from '../src/services/scoreContract.js'
import { scoreCareerRoles } from '../src/services/careerRoleScoring.js'
import { generatePortfolio } from '../src/controllers/portfolioController.js'
import { formatScore } from '../../frontend/src/lib/score.js'
import { normalizePortfolioDraft, portfolioStorageKey, readPortfolioDraft, savePortfolioDraft } from '../../frontend/src/lib/portfolioDraft.js'

const printStyles = await readFile(new URL('../../frontend/src/index.css', import.meta.url), 'utf8')

test('domain detection reads role, description, and supported skill domains', () => {
  assert.equal(detectJobDomain({ jobTitle: 'API Engineer' }), 'backend')
  assert.equal(detectJobDomain({ jobDescription: 'Create accessible web interfaces with React' }), 'frontend')
  assert.equal(detectJobDomain({ skills: ['Kubernetes', 'Terraform'] }), 'devops')
  assert.equal(detectJobDomain({ jobTitle: 'Researcher', jobDescription: 'Novel work' }), null)
})

test('domain weights prioritize relevant skills and use neutral unknown-domain weights', () => {
  assert.ok(domainSkillWeight('React', 'frontend') > domainSkillWeight('React', 'backend'))
  assert.equal(domainSkillWeight('React', null), 1)
  assert.equal(weightedSkillScore(['React', 'SQL'], ['React'], 'frontend'), 42)
})

test('weighted skill scores remain bounded for repeated and empty inputs', () => {
  assert.equal(weightedSkillScore([], [], 'frontend'), 0)
  assert.ok(weightedSkillScore(['React', 'React'], ['React'], 'frontend') <= 70)
  assert.ok(weightedSkillScore(['React', 'TypeScript'], ['React', 'TypeScript'], 'frontend') <= 70)
})

test('skill names normalize aliases, reject invalid values, and prevent duplicate catalog entries', () => {
  assert.equal(canonicalSkillName('ReactJS'), 'react')
  assert.equal(canonicalSkillName('Node.js'), 'node.js')
  assert.equal(validateSkillName(''), false)
  assert.equal(validateSkillName('<script>'), false)

  const before = getSkillCatalog().length
  const accepted = registerAcceptedSkill('GraphQL Federation')
  assert.deepEqual(accepted, { accepted: true, skill: 'GraphQL Federation' })
  assert.deepEqual(registerAcceptedSkill('  graphql   federation '), { accepted: false, reason: 'duplicate', skill: 'GraphQL Federation' })
  assert.equal(getSkillCatalog().length, before + 1)
})

test('portfolio includes available sections while omitting private and missing information', () => {
  const portfolio = buildPortfolio({
    name: 'Private Name',
    email: 'private@example.test',
    professionalSummary: 'Experienced engineer',
    skills: ['React'],
    projects: [{ title: 'Dashboard', description: 'Built a reporting dashboard', email: 'private@example.test' }],
    education: [],
  })

  assert.equal(portfolio.summary, 'Experienced engineer')
  assert.deepEqual(portfolio.skills, ['React'])
  assert.deepEqual(portfolio.projects, [{ title: 'Dashboard', description: 'Built a reporting dashboard' }])
  assert.equal('education' in portfolio, false)
  assert.equal(JSON.stringify(portfolio).includes('private@example.test'), false)
  assert.equal(portfolio.name, 'Private Name')
  assert.equal('email' in portfolio, false)
})

test('portfolio rejects malformed profile payloads', () => {
  assert.throws(() => buildPortfolio([]), (error) => error.status === 400)
})

test('nested and flat synthetic resumes normalize to consistent professional sections', () => {
  const flat = normalizeResume({
    summary: 'Builds reliable web products.',
    skills: [{ name: 'Node.js' }, 'React'],
    projects: [{ title: 'Inventory Portal', description: 'Tracks stock changes.' }],
    education: [{ degree: 'BSc Computing', institution: 'Example Institute' }],
    experience: [{ title: 'Developer Intern', company: 'Example Labs' }],
    certifications: ['Cloud Fundamentals'],
  })
  const nested = normalizeResume({ data: { resume: flat } })

  assert.deepEqual(nested, flat)
  assert.equal(nested.professionalSummary, 'Builds reliable web products.')
  assert.equal(nested.skills.includes('Node.js'), true)
  assert.equal(nested.projects[0].title, 'Inventory Portal')
  assert.equal(nested.education[0].degree, 'BSc Computing')
  assert.equal(nested.experience[0].title, 'Developer Intern')
  assert.deepEqual(nested.certifications, ['Cloud Fundamentals'])
})

test('structured role matching returns meaningful bounded scores from extracted skills', () => {
  const matches = deterministicMatches(normalizeResume({ resume: { skills: ['NodeJS', 'Express.js', 'MongoDB', 'Git', 'React', 'JavaScript'] } }))

  assert.ok(matches.length > 0)
  assert.equal(matches[0].role.title, 'Full Stack Developer')
  assert.ok(matches[0].score > 0 && matches[0].score <= 70)
  assert.ok(matches.every(({ score }) => Number.isFinite(score) && score >= 0 && score <= 70))
})

test('portfolio generation supports API nested payloads, populated, partial, and empty resumes', () => {
  const populated = buildPortfolio({ data: { resume: {
    summary: 'Designs useful systems.', skills: ['TypeScript', 'SQL'],
    projects: [{ title: 'Inventory Portal', technologies: ['React', 'SQL'] }],
    education: [{ degree: 'BSc Computing', year: 2027 }],
    experience: [{ role: 'Developer', company: 'Example Labs' }],
    certifications: ['Cloud Fundamentals'],
  } } })
  const partial = buildPortfolio({ skills: ['TypeScript'] })
  const empty = buildPortfolio({})

  assert.deepEqual(Object.keys(populated), ['summary', 'skills', 'projects', 'experience', 'education', 'certifications'])
  assert.equal(populated.projects[0].technologies, 'React, SQL')
  assert.deepEqual(partial, { skills: ['TypeScript'] })
  assert.deepEqual(empty, {})

  const response = { statusCode: 200, payload: null, json(value) { this.payload = value; return this }, status(code) { this.statusCode = code; return this } }
  generatePortfolio({ body: { resume: { profile: { skills: ['Go'] } } } }, response, (error) => { throw error })
  assert.deepEqual(response.payload, { success: true, portfolio: { skills: ['Go'] }, message: '' })
})

test('score contract rejects null, undefined, NaN, infinity, and out-of-range values', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, -1, 101, '72']) {
    assert.equal(boundedScore(value), null)
    assert.equal(formatScore(value), 'Match unavailable')
  }
  assert.equal(formatScore(0), '0%')
  assert.equal(formatScore(72.4), '72%')
  assert.equal(boundedScore(72.4), 72)
  assert.equal(boundedScore(120), null)
})

test('domain weighting affects a separate bounded score without changing keyword baseline', () => {
  const job = { jobTitle: 'Frontend Developer', jobDescription: 'Build web interfaces with React.', jobGeo: 'India', pubDate: '2026-10-19' }
  const input = { role: 'Frontend Developer', skills: ['React', 'SQL'], location: 'india', resumeText: 'Develop user interfaces' }
  const baseline = scoreJob(job, input)
  const contextual = scoreJobWithContext(job, input)

  assert.equal(baseline.matchScore, 65)
  assert.ok(contextual.scoreComponents.domainWeightedScore >= contextual.scoreComponents.baselineScore)
  assert.ok(contextual.matchScore <= 100)
})

test('candidate skills do not override the job domain', () => {
  const result = scoreJob({ jobTitle: 'API Developer', jobDescription: 'Build backend services with PostgreSQL.', jobGeo: 'India' }, {
    role: 'API Developer', skills: ['React'], location: 'india',
  })

  assert.equal(result.domain, 'backend')
})

test('recommendation explanations include skills from an accepted catalogue', () => {
  const result = scoreJobWithContext({ jobTitle: 'Backend Developer', jobDescription: 'Build services using GraphQL Federation.', jobGeo: 'India' }, {
    role: 'Backend Developer', skills: ['Node.js'], location: 'india', resumeText: 'Node.js backend work', skillCatalog: ['GraphQL Federation'],
  })

  assert.deepEqual(result.missingSkills, ['GraphQL Federation'])
})

test('resume file validation checks extension and file signature', () => {
  assert.equal(isSupportedResume({ originalname: 'resume.pdf', buffer: Buffer.from('%PDF-1.7') }), true)
  assert.equal(isSupportedResume({ originalname: 'resume.pdf', buffer: Buffer.from('not a pdf') }), false)
  assert.equal(isSupportedResume({ originalname: 'resume.docx', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }), true)
  assert.equal(isSupportedResume({ originalname: 'resume.doc', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }), false)
})

test('Gemini resume parsing redacts contact information from its prompt', async () => {
  const originalKey = process.env.GEMINI_API_KEY
  let prompt = ''
  const originalLinks = { github: 'https://github.com/example/profile' }
  process.env.GEMINI_API_KEY = 'test-key'
  setGeminiClientFactory(() => ({ models: { generateContent: async ({ contents }) => {
    prompt = contents
    return { text: JSON.stringify({ skills: ['React'], professionalLinks: originalLinks }) }
  } } }))

  try {
    const parsed = await parseResume('Jane Doe\njane@example.test\n+1 (555) 123-4567\nAddress: 14 Example Road\nhttps://github.com/example/profile\nExperienced engineer with React and Node.js.'.padEnd(100, ' '))
    assert.equal(prompt.includes('jane@example.test'), false)
    assert.equal(prompt.includes('555) 123-4567'), false)
    assert.equal(prompt.includes('14 Example Road'), false)
    assert.equal(prompt.includes('https://github.com/example/profile'), false)
    assert.equal(parsed.professionalLinks.github, 'https://github.com/example/profile')
  } finally {
    resetGeminiClientFactory()
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalKey
  }
})

test('job scores remain serializable when publication dates are invalid', () => {
  const result = scoreJob({ jobTitle: 'Engineer', jobDescription: 'Build systems.', jobGeo: 'India', pubDate: 'not-a-date' }, { role: 'Engineer', skills: [] })
  assert.equal(Number.isFinite(result.finalScore), true)
  assert.equal(result.matchScore, null)
  assert.equal(JSON.parse(JSON.stringify(result)).finalScore, result.finalScore)
})

test('job skill matching recognizes common supported spelling variants', () => {
  const node = scoreJob({ jobTitle: 'Backend Developer', jobDescription: 'Build APIs with Node.js.', jobGeo: 'India' }, { role: 'Backend Developer', skills: ['NodeJS'] })
  const react = scoreJob({ jobTitle: 'Frontend Developer', jobDescription: 'Create React.js interfaces.', jobGeo: 'India' }, { role: 'Frontend Developer', skills: ['React'] })

  assert.deepEqual(node.matchedSkills, ['NodeJS'])
  assert.deepEqual(react.matchedSkills, ['React'])
})

test('print stylesheet isolates the portfolio and configures compact portrait pages', () => {
  assert.match(printStyles, /@page\s*\{\s*size:\s*A4 portrait;/)
  assert.match(printStyles, /body > \*:not\(#portfolio-print-root\)\s*\{\s*display:\s*none !important/)
  assert.match(printStyles, /#portfolio-print-root section\s*\{\s*break-inside:\s*auto/)
  assert.match(printStyles, /#portfolio-print-root article\s*\{\s*break-inside:\s*avoid-page/)
})

test('career role score combination uses structured fallback and bounded contextual score', () => {
  const matches = [{ role: { title: 'Full Stack Developer' }, score: 70 }, { role: { title: 'Backend Developer' }, score: 55 }]
  const combined = scoreCareerRoles(matches, { semanticScores: [90, null] })

  assert.deepEqual(combined.map(({ score }) => score), [97, 55])
  assert.deepEqual(combined.map(({ matchingMethod }) => matchingMethod), ['structured-plus-contextual', 'structured-skills'])
  assert.deepEqual(scoreCareerRoles([{ role: { title: 'Invalid' }, score: NaN }], {}), [])
  assert.deepEqual(scoreCareerRoles([{ role: { title: 'Invalid AI' }, score: 70 }], { semanticScores: [Infinity] })[0].score, 70)
})

test('frontend portfolio mapping supports nested project links and does not publish email by default', () => {
  const draft = normalizePortfolioDraft({ data: { resume: {
    name: 'Sample Developer', headline: 'Software Developer', summary: 'Builds practical software.',
    skills: [{ name: 'Go' }, 'PostgreSQL'],
    projects: [{ name: 'Sample Tool', contribution: 'Built the API.', stack: ['Go', 'PostgreSQL'], githubUrl: 'https://github.com/example/tool', demoUrl: 'javascript:alert(1)' }],
    professionalLinks: { github: 'https://github.com/example', linkedin: 'https://linkedin.com/in/example' },
    email: 'private@example.test',
  } } })

  assert.equal(draft.name, 'Sample Developer')
  assert.equal(draft.projects[0].title, 'Sample Tool')
  assert.equal(draft.projects[0].description, 'Built the API.')
  assert.equal(draft.projects[0].technologies, 'Go, PostgreSQL')
  assert.equal(draft.projects[0].github, 'https://github.com/example/tool')
  assert.equal(draft.projects[0].demo, '')
  assert.deepEqual(draft.links, { github: 'https://github.com/example', linkedin: 'https://linkedin.com/in/example' })
  assert.equal(draft.publishEmail, false)
  assert.equal(draft.contactEmail, '')
  assert.equal(JSON.stringify(draft).includes('private@example.test'), false)
})

test('portfolio drafts persist and are isolated by account for refreshes', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  const user = JSON.stringify({ email: 'person@example.test', role: 'job-seeker' })
  const key = portfolioStorageKey(user)
  const draft = normalizePortfolioDraft({ name: 'Sample Developer', skills: ['Go'] })

  savePortfolioDraft(storage, key, draft)
  assert.deepEqual(readPortfolioDraft(storage, key), draft)
  assert.notEqual(key, portfolioStorageKey(JSON.stringify({ email: 'other@example.test', role: 'job-seeker' })))
  assert.equal(readPortfolioDraft(storage, 'missing'), null)
})