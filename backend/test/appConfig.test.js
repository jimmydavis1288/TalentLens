import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'

test('production CORS only reflects configured frontend origins', async (t) => {
  const previousMode = process.env.NODE_ENV
  const previousOrigins = process.env.CORS_ORIGINS
  process.env.NODE_ENV = 'production'
  process.env.CORS_ORIGINS = 'https://talentlens.example, https://admin.talentlens.example'
  const { default: app } = await import('../src/app.js')
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = previousOrigins
  })
  const url = `http://127.0.0.1:${server.address().port}/api/health`
  const allowed = await fetch(url, { headers: { Origin: 'https://talentlens.example' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://talentlens.example')
  assert.equal(allowed.status, 503, 'health must report unavailable while MongoDB is disconnected')
  assert.deepEqual(await allowed.json(), { status: 'unavailable' })
  const rejected = await fetch(url, { headers: { Origin: 'https://attacker.example' } })
  assert.equal(rejected.headers.get('access-control-allow-origin'), null)
  const previousReadyState = mongoose.connection.readyState
  mongoose.connection.readyState = 1
  const ready = await fetch(url)
  assert.equal(ready.status, 200)
  assert.deepEqual(await ready.json(), { status: 'ok' })
  mongoose.connection.readyState = previousReadyState
})
