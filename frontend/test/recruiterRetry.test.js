import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { postRecruiterResumeRetry, restoreRecruiterAnalysis } from '../src/lib/recruiterRetry.js'

let server
let RetryActions
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true } })
  const component = await server.ssrLoadModule('/src/components/RecruitmentRetryActions.jsx')
  RetryActions = component.default
})
after(async () => server?.close())

test('retry actions expose saved-text and selected-file paths, and reflect loading state', () => {
  const candidates = [{ status: 'failed', canResume: true }]
  const files = [new File(['resume'], 'ada.pdf', { type: 'application/pdf' })]
  const markup = renderToStaticMarkup(React.createElement(RetryActions, { candidates, files, loading: true, onRetry() {} }))
  assert.match(markup, /Retrying saved text…/)
  assert.match(markup, /Retrying with selected files…/)
  assert.equal((markup.match(/disabled=""/g) || []).length, 2)
})

test('completed candidates hide retry actions and source-less retries stay disabled', () => {
  const completed = renderToStaticMarkup(React.createElement(RetryActions, { candidates: [{ status: 'completed', canResume: false }], files: [], loading: false, onRetry() {} }))
  assert.equal(completed, '')
  const sourceUnavailable = renderToStaticMarkup(React.createElement(RetryActions, { candidates: [{ status: 'failed', canResume: false }], files: [], loading: false, onRetry() {} }))
  assert.match(sourceUnavailable, /disabled=""/)
  assert.doesNotMatch(sourceUnavailable, /Retry with selected original files/)
})

test('saved-text retry has no file fields and requests the persisted analysis endpoint', async () => {
  const calls = []
  const response = { id: 'analysis-1', status: 'processing' }
  const api = async (...args) => { calls.push(args); return response }
  assert.equal(await postRecruiterResumeRetry(api, 'analysis-1', [new File(['x'], 'ada.pdf')], false), response)
  assert.equal(calls[0][0], '/analysis/recruiter/analyses/analysis-1/resume')
  assert.equal(calls[0][1].method, 'POST')
  assert.deepEqual([...calls[0][1].body.keys()], [])
})

test('selected-file retry sends only the selected files and surfaces request errors', async () => {
  const ada = new File(['ada'], 'ada.pdf', { type: 'application/pdf' })
  const grace = new File(['grace'], 'grace.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  let body
  await postRecruiterResumeRetry(async (_path, options) => { body = options.body; return { status: 'processing' } }, 'analysis-2', [ada, grace], true)
  assert.deepEqual([...body.getAll('resumes')].map((file) => file.name), ['ada.pdf', 'grace.docx'])
  await assert.rejects(postRecruiterResumeRetry(async () => { throw new Error('File does not match this analysis.') }, 'analysis-2', [ada], true), /does not match/)
})

test('restoring after refresh fetches persisted analysis state and handles a missing saved id', async () => {
  const calls = []
  const saved = { id: 'persisted-analysis', status: 'partial', rankedCandidates: [{ candidateId: 'done' }] }
  const storage = { getItem: (key) => key === 'talentlens_recruitment_analysis_id' ? saved.id : null }
  assert.equal(await restoreRecruiterAnalysis(async (path) => { calls.push(path); return saved }, storage), saved)
  assert.deepEqual(calls, ['/analysis/recruiter/analyses/persisted-analysis'])
  assert.equal(await restoreRecruiterAnalysis(async () => assert.fail('no saved id should not fetch'), { getItem: () => null }), null)
})
