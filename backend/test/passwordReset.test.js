import assert from 'node:assert/strict'
import test from 'node:test'
import { requestPasswordReset } from '../src/controllers/authController.js'

test('password recovery does not issue a token when secure delivery is unavailable', async () => {
  const response = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }

  await requestPasswordReset({}, response, (error) => {
    throw error
  })

  assert.equal(response.statusCode, 503)
  assert.equal('resetToken' in response.payload, false)
  assert.match(response.payload.message, /email delivery is not configured/)
})
