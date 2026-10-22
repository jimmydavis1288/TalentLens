import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

let server
let Login

before(async () => {
  server = await createServer({ configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false } })
  Login = (await server.ssrLoadModule('/src/pages/Login.jsx')).default
})

after(async () => server?.close())

test('login page and document metadata use TalentLens branding', async () => {
  const login = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Login)))
  const visibleText = login.replace(/<[^>]*>/g, ' ')
  assert.match(login, /Welcome to TalentLens/)
  assert.match(login, />TalentLens<\/span>/)
  assert.doesNotMatch(visibleText, /Jobekaa/i)

  const document = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(document, /<title>TalentLens \|/)
  assert.match(document, /property="og:site_name" content="TalentLens"/)
  assert.match(document, /href="\/favicon\.svg"/)
  assert.doesNotMatch(document, /Jobekaa/i)
})
