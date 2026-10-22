import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

let server
let RecruiterDashboard
before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false } })
  RecruiterDashboard = (await server.ssrLoadModule('/src/pages/RecruiterDashboard.jsx')).default
})
after(async () => server?.close())

test('recruiter workflow exposes job document/text, explicit requirement review, and resume upload', () => {
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RecruiterDashboard)))
  assert.match(markup, /Step 1 · Job description/)
  assert.match(markup, /Paste the role description/)
  assert.match(markup, /\.pdf,\.docx/)
  assert.match(markup, /Analyze job description/)
  assert.match(markup, /Step 2 · Student resumes/)
  assert.match(markup, /Upload student resumes/)
  assert.match(markup, /Build an evidence-backed shortlist/)
})

test('recruiter result view renders requirement priorities, candidate evidence, and cautious score language', async () => {
  const source = await readFile(new URL('../src/components/RecruitmentResults.jsx', import.meta.url), 'utf8')
  assert.match(source, /Requirement priorities/)
  assert.match(source, /candidate\.requirementResults/)
  assert.match(source, /Resume evidence:/)
  assert.match(source, /not a hiring probability/)
  assert.match(source, /shortlistStatus/)
  assert.match(source, /evidenceCoverage/)
})
