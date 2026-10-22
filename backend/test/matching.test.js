import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { handleResumeAnalysisError } from '../src/controllers/analysisController.js'
import { deterministicMatches, parseResume, resetGeminiClientFactory as resetResumeGeminiClientFactory, setGeminiClientFactory as setResumeGeminiClientFactory } from '../src/services/resumePipelineService.js'
import { contextualOverlapScore, cosineSimilarity, findRecommendedJobs, resetGeminiClientFactory as resetSearchGeminiClientFactory, scoreJob, scoreJobWithContext, setGeminiClientFactory as setSearchGeminiClientFactory } from '../src/services/jobSearchService.js'

const evaluationCases = JSON.parse(await readFile(new URL('./fixtures/matching-evaluation.json', import.meta.url), 'utf8'))

test('deterministicMatches ranks required-skill overlap and returns at most four roles', () => {
  const matches = deterministicMatches({ skills: ['JavaScript', 'React', 'Node.js', 'Express', 'MongoDB', 'Git'] })

  assert.equal(matches.length, 4)
  assert.equal(matches[0].role.title, 'Full Stack Developer')
  assert.equal(matches[0].score, 70)
  assert.deepEqual(matches[0].matched, ['javascript', 'react', 'node.js', 'express', 'mongodb', 'git'])
  assert.ok(matches.every((match, index) => index === 0 || matches[index - 1].score >= match.score))
})

test('deterministicMatches returns zero scores when no required skills overlap', () => {
  const matches = deterministicMatches({ skills: ['ceramics'] })

  assert.equal(matches.length, 0)
})

test('scoreJob retains skill, role, geography, and recency scoring behavior', () => {
  const result = scoreJob({
    id: 1,
    jobTitle: 'Frontend Developer',
    companyName: 'Example Co.',
    jobDescription: 'Build interfaces with React.',
    jobGeo: 'India',
    pubDate: '2026-10-14',
    url: 'https://example.test/job',
  }, { role: 'Frontend Developer', skills: ['React', 'TypeScript'], location: 'india' })

  assert.equal(result.matchScore, 65)
  assert.equal(result.geographicScore, 100)
  assert.deepEqual(result.matchedSkills, ['React'])
  assert.equal(result.source, 'Jobicy')
  const daysOld = Math.max(0, (Date.now() - new Date('2026-10-14')) / 86400000)
  const recencyScore = Math.max(0, 100 - daysOld * 3)
  assert.equal(result.finalScore, Math.round(65 * 0.6 + 100 * 0.25 + recencyScore * 0.15))
})

test('context-aware scores explain the baseline, context, and skill gaps', () => {
  const result = scoreJobWithContext({
    id: 'explainable',
    jobTitle: 'Backend Developer',
    jobDescription: 'Build Node.js REST API services using PostgreSQL and Docker.',
    jobGeo: 'India',
    pubDate: '2026-10-14',
  }, {
    role: 'Backend Developer',
    skills: ['Node.js', 'JavaScript'],
    location: 'india',
    resumeText: 'Built Node.js APIs for financial account services.',
  })

  assert.deepEqual(result.matchedSkills, ['Node.js'])
  assert.deepEqual(result.missingSkills, ['docker', 'rest api'])
  assert.equal(result.matchMethod, 'deterministic-context')
  assert.equal(result.scoreComponents.baselineWeight + result.scoreComponents.contextualWeight, 1)
  assert.ok(Number.isFinite(result.scoreComponents.baselineScore))
  assert.ok(Number.isFinite(result.scoreComponents.contextualScore))
})

test('Gemini retry succeeds after a transient 429 failure', async () => {
  let attempts = 0
  setResumeGeminiClientFactory(() => ({
    models: {
      generateContent: async () => {
        attempts += 1
        if (attempts === 1) {
          const error = new Error('Rate limit exceeded')
          error.status = 429
          throw error
        }
        return { text: JSON.stringify({ name: 'Ada Lovelace', professionalSummary: 'Built analytical systems.', skills: ['JavaScript', 'React'] }) }
      },
    },
  }))

  try {
    process.env.GEMINI_API_KEY = 'test-key'
    const profile = await parseResume('Ada Lovelace built analytical systems with JavaScript and React.')
    assert.equal(profile.name, 'Ada Lovelace')
    assert.equal(attempts, 2)
  } finally {
    resetResumeGeminiClientFactory()
    delete process.env.GEMINI_API_KEY
  }
})

test('Gemini retry exhausts after repeated transient failures', async () => {
  let attempts = 0
  setResumeGeminiClientFactory(() => ({
    models: {
      generateContent: async () => {
        attempts += 1
        const error = new Error('This model is currently experiencing high demand.')
        error.status = 503
        throw error
      },
    },
  }))

  try {
    process.env.GEMINI_API_KEY = 'test-key'
    await assert.rejects(parseResume('Ada Lovelace built analytical systems.'), (error) => error.status === 503 && attempts === 3)
  } finally {
    resetResumeGeminiClientFactory()
    delete process.env.GEMINI_API_KEY
  }
})

test('Gemini retry does not retry non-retryable client errors', async () => {
  let attempts = 0
  setResumeGeminiClientFactory(() => ({
    models: {
      generateContent: async () => {
        attempts += 1
        const error = new Error('Invalid request parameters')
        error.status = 400
        throw error
      },
    },
  }))

  try {
    process.env.GEMINI_API_KEY = 'test-key'
    await assert.rejects(parseResume('Ada Lovelace built analytical systems.'), (error) => error.status === 400 && attempts === 1)
  } finally {
    resetResumeGeminiClientFactory()
    delete process.env.GEMINI_API_KEY
  }
})

test('embedding failures do not fall back to deterministic scores', async () => {
  const originalFetch = globalThis.fetch
  const originalGeminiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ jobs: [{ id: 'fallback-embedding', jobTitle: 'Frontend Developer', jobDescription: 'Build React interfaces.', jobGeo: 'India', pubDate: '2026-10-14' }] }),
  })
  setSearchGeminiClientFactory(() => ({
    models: {
      embedContent: async () => {
        const error = new Error('This model is currently experiencing high demand.')
        error.status = 503
        throw error
      },
    },
  }))

  try {
    await assert.rejects(findRecommendedJobs({ role: 'Frontend Developer', skills: ['React'], location: 'india', resumeText: 'React frontend systems.' }), (error) => error.status === 503 && error.failureCategory === 'gemini_unavailable')
  } finally {
    globalThis.fetch = originalFetch
    resetSearchGeminiClientFactory()
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGeminiKey
  }
})

test('transient Gemini outages produce a clear user-facing analysis response', () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
  const next = () => { throw new Error('next should not be called') }
  const error = new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary.')
  error.status = 503
  error.retryable = true

  handleResumeAnalysisError(res, error, next)

  assert.equal(res.statusCode, 503)
  assert.equal(res.body.code, 'GEMINI_UNAVAILABLE')
  assert.equal(res.body.message, 'Gemini is temporarily unavailable. Please retry shortly.')
})

test('missing Gemini configuration is distinguished from a temporary outage', () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }

  handleResumeAnalysisError(res, Object.assign(new Error('missing key'), { status: 503, code: 'GEMINI_NOT_CONFIGURED' }), () => {})

  assert.equal(res.statusCode, 503)
  assert.match(res.body.message, /requires Gemini configuration/)
})

test('cosine similarity handles vector similarity and invalid embedding shapes', () => {
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([1], [1, 0]), null)
  assert.equal(cosineSimilarity([0, 0], [1, 0]), null)
})

test('embedding similarity contributes to the explainable fit score', () => {
  const job = {
    id: 'embedding-fit',
    jobTitle: 'Data Analyst',
    jobDescription: 'Analyze clinical trial data with Python and SQL.',
    jobGeo: 'India',
    pubDate: '2026-10-14',
  }
  const input = { role: 'Data Analyst', skills: ['Python', 'SQL'], location: 'india', resumeText: 'Analyze clinical trial data.' }
  const baseline = scoreJob(job, input)
  const semantic = scoreJobWithContext(job, { ...input, semanticScore: 0.9 })

  assert.equal(semantic.matchMethod, 'gemini-embedding')
  assert.equal(semantic.scoreComponents.contextualScore, 90)
  assert.equal(baseline.matchScore, 100)
  assert.equal(semantic.matchScore, 94)
})

test('manual evaluation examples improve top-one relevance over the baseline', () => {
  let baselineHits = 0
  let contextualHits = 0

  for (const example of evaluationCases) {
    const baselineRanked = example.jobs.map((job) => ({
      id: job.id,
      score: scoreJob(job, { role: example.role, skills: example.skills, location: 'india' }).finalScore,
    })).sort((a, b) => b.score - a.score)
    const contextualRanked = example.jobs.map((job) => ({
      id: job.id,
      score: scoreJobWithContext(job, {
        role: example.role,
        skills: example.skills,
        location: 'india',
        resumeText: example.resumeText,
      }).finalScore,
    })).sort((a, b) => b.score - a.score)

    if (baselineRanked[0].id === example.relevantJobId) baselineHits += 1
    if (contextualRanked[0].id === example.relevantJobId) contextualHits += 1
  }

  assert.equal(evaluationCases.length, 3)
  assert.equal(baselineHits, 0)
  assert.equal(contextualHits, 3)
})

test('different skill sets do not reuse personalized cached job scores', async () => {
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return {
      ok: true,
      json: async () => ({
        jobs: [{
          id: 'cache-skills',
          jobTitle: 'Product Specialist',
          jobDescription: 'This role requires React.',
          jobGeo: 'India',
          pubDate: '2026-10-14',
        }],
      }),
    }
  }

  try {
    const shared = { role: 'Cache Isolation Check', location: 'india', tag: 'phase1-cache-skills', resumeText: '' }
    const reactResult = await findRecommendedJobs({ ...shared, skills: ['React'] })
    const pythonResult = await findRecommendedJobs({ ...shared, skills: ['Python'] })

    assert.equal(fetchCount, 2)
    assert.equal(reactResult.jobs[0].matchScore, 70)
    assert.deepEqual(reactResult.jobs[0].matchedSkills, ['React'])
    assert.equal(pythonResult.jobs[0].matchScore, null)
    assert.deepEqual(pythonResult.jobs[0].matchedSkills, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('identical job search inputs reuse a consistent cached result', async () => {
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return {
      ok: true,
      json: async () => ({
        jobs: [{
          id: 'cache-identical',
          jobTitle: 'Data Analyst',
          jobDescription: 'Analyze data with SQL.',
          jobGeo: 'India',
          pubDate: '2026-10-14',
        }],
      }),
    }
  }

  try {
    const input = { role: 'Cache Consistency Check', skills: ['SQL'], location: 'india', tag: 'phase1-cache-identical' }
    const first = await findRecommendedJobs(input)
    const second = await findRecommendedJobs(input)

    assert.equal(fetchCount, 1)
    assert.deepEqual(second, first)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('different resume context does not reuse personalized cached recommendations', async () => {
  const originalFetch = globalThis.fetch
  const originalGeminiKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return {
      ok: true,
      json: async () => ({
        jobs: [{
          id: 'cache-context',
          jobTitle: 'Data Analyst',
          jobDescription: 'Analyze patient clinical trial outcomes.',
          jobGeo: 'India',
          pubDate: '2026-10-14',
        }],
      }),
    }
  }
  setSearchGeminiClientFactory(() => ({ models: { embedContent: async ({ contents }) => ({ embeddings: contents.map(({ parts }) => ({ values: parts[0].text.includes('Clinical') ? [1, 0] : [0, 1] })) }) } }))

  try {
    const shared = { role: 'Resume Context Cache Check', skills: ['SQL'], location: 'india', tag: 'phase2-cache-context' }
    const clinical = await findRecommendedJobs({ ...shared, resumeText: 'Clinical patient trial analysis.' })
    const retail = await findRecommendedJobs({ ...shared, resumeText: 'Retail inventory demand forecasting.' })

    assert.equal(fetchCount, 2)
    assert.notEqual(clinical.jobs[0].scoreComponents.contextualScore, retail.jobs[0].scoreComponents.contextualScore)
  } finally {
    globalThis.fetch = originalFetch
    resetSearchGeminiClientFactory()
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGeminiKey
  }
})
