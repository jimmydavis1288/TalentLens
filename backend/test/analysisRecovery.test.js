import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyRecruitmentFailure, handleResumeAnalysisError } from '../src/controllers/analysisController.js'
import { runCandidateAgent } from '../src/services/recruitmentAgentService.js'
import { classifyGeminiError, deterministicMatches, deterministicResumeProfile, extractResumeText, isRetryableGeminiError, resetGeminiClientFactory, setGeminiClientFactory } from '../src/services/resumePipelineService.js'

test('Gemini outages and transient rate limits retry, while quota exhaustion and credentials do not', () => {
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Quota exceeded'), { status: 429 })), false)
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Rate limit exceeded'), { status: 429 })), true)
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Service unavailable'), { status: 503 })), true)
  assert.equal(isRetryableGeminiError(Object.assign(new Error('Unauthorized'), { status: 401 })), false)
  assert.equal(classifyGeminiError(Object.assign(new Error('Quota exceeded'), { status: 429 })), 'gemini_quota_exhausted')
  assert.equal(classifyGeminiError(Object.assign(new Error('Rate limit exceeded'), { status: 429 })), 'gemini_rate_limited')
  assert.equal(classifyGeminiError(Object.assign(new Error('Invalid API key'), { status: 403 })), 'gemini_invalid_key')
  assert.equal(classifyGeminiError(Object.assign(new Error('upstream unavailable'), { status: 503 })), 'gemini_unavailable')
})

test('missing Gemini key is distinguished and safe for the client', () => {
  const previous = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  try {
    const error = Object.assign(new Error('secret provider detail and key material'), { status: 503, code: 'GEMINI_NOT_CONFIGURED' })
    assert.equal(classifyGeminiError(error), 'gemini_not_configured')
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
    handleResumeAnalysisError(response, error, () => assert.fail('expected stable response'))
    assert.equal(response.body.code, 'GEMINI_NOT_CONFIGURED')
    assert.doesNotMatch(JSON.stringify(response.body), /secret provider detail|key material/i)
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previous
  }
})

test('recruiter resumes fail explicitly when Gemini is unavailable', async () => {
  const previous = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  const saved = []
  try {
    await assert.rejects(runCandidateAgent({ candidateId: 'candidate-1', text: 'Ada Lovelace developed applications using React and Python. Built web projects and tested software with a small engineering team.' }, ['react', 'python'], { skills: { react: 1, python: 1 } }, async (progress) => {
      if (progress.action === 'get-cache') return null
      saved.push(progress)
      return null
    })
    , { code: 'GEMINI_NOT_CONFIGURED' })
    assert.equal(saved.some((entry) => entry.action === undefined), false)
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previous
  }
})

test('Gemini 503 outage fails after bounded retries when source evidence is sufficient', async () => {
  const previousKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'mock-key'
  let calls = 0
  setGeminiClientFactory(() => ({ models: { generateContent: async () => { calls += 1; throw Object.assign(new Error('temporary upstream failure'), { status: 503 }) } } }))
  try {
    await assert.rejects(runCandidateAgent({ text: 'A developer who built production interfaces using React and worked on testing and release processes.' }, ['react'], { skills: { react: 1 } }, async ({ action }) => action === 'get-cache' ? null : null), (error) => error.status === 503 && error.failureCategory === 'gemini_unavailable')
    assert.equal(calls, 3, 'only the bounded transient retries are sent')
  } finally {
    resetGeminiClientFactory()
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
  }
})

test('job seeker deterministic role fallback only uses skills explicitly found in extracted resume text', () => {
  const profile = deterministicResumeProfile('Experienced developer. Skills: React, JavaScript, and SQL. No Python experience.')
  assert.deepEqual(profile.skills.sort(), ['javascript', 'react', 'sql'])
  assert.ok(deterministicMatches(profile).length > 0)
  assert.equal(profile.skills.includes('python'), false)
})

test('unsupported Gemini models and malformed responses are classified without exposing provider details', () => {
  assert.equal(classifyGeminiError(Object.assign(new Error('model not found'), { status: 404 })), 'gemini_model_unavailable')
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  handleResumeAnalysisError(response, Object.assign(new Error('provider payload contains secret details'), { status: 502, code: 'GEMINI_INVALID_RESPONSE', failureCategory: 'gemini_invalid_response' }), () => assert.fail('expected stable response'))
  assert.equal(response.body.code, 'GEMINI_INVALID_RESPONSE')
  assert.doesNotMatch(JSON.stringify(response.body), /secret details/i)
})

test('no candidate success is reported when Gemini and source-supported fallback are both unavailable', async () => {
  const previous = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  try {
    await assert.rejects(runCandidateAgent({ candidateId: 'candidate-2', text: 'Readable resume text without either requested qualification. A graduate with project coordination and communication experience.' }, ['react'], { skills: { react: 1 } }, async ({ action }) => action === 'get-cache' ? null : null), { code: 'GEMINI_NOT_CONFIGURED' })
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previous
  }
})

test('database persistence errors remain failures and completed candidate rows are outside the failed write', async () => {
  const previousKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'mock-key'
  setGeminiClientFactory(() => ({ models: { generateContent: async () => ({ text: JSON.stringify({ name: 'Ada', skills: ['React'] }) }) } }))
  try {
    const failure = Object.assign(new Error('connection refused'), { name: 'MongoNetworkError', code: 'ECONNREFUSED' })
    await assert.rejects(runCandidateAgent({ text: 'Ada built software with React and wrote project documentation for the team.' }, ['react'], { skills: { react: 1 } }, async ({ action }) => {
      if (action === 'get-cache') return null
      throw failure
    }), /connection refused/)
    assert.deepEqual(classifyRecruitmentFailure(failure), { errorCategory: 'database_unavailable', quotaExhausted: false, stage: 'persist', status: null })
  } finally {
    resetGeminiClientFactory()
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
  }
})

test('unreadable PDFs and invalid DOCX extraction return actionable file errors', async () => {
  await assert.rejects(extractResumeText({ originalname: 'scan.pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') }), (error) => error.status === 422 && error.code === 'UNREADABLE_RESUME' && /scanned|text-based/i.test(error.message))
  await assert.rejects(extractResumeText({ originalname: 'broken.docx', buffer: Buffer.from('not a zip file') }), (error) => error.status === 422 && error.code === 'DOCX_EXTRACTION_FAILED' && /valid DOCX/i.test(error.message))
})
