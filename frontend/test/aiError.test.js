import assert from 'node:assert/strict'
import test from 'node:test'
import { aiErrorMessage } from '../src/lib/aiError.js'

test('AI failures map to safe user-facing messages without provider details', () => {
  assert.match(aiErrorMessage({ code: 'GEMINI_NOT_CONFIGURED', message: 'secret key value' }), /not configured/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_INVALID_KEY', message: 'provider stack trace' }), /invalid|permission/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_QUOTA_EXHAUSTED' }), /quota/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_RATE_LIMITED' }), /rate limiting/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_UNAVAILABLE' }), /temporarily unavailable/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_MODEL_UNAVAILABLE' }), /model.*unavailable/i)
  assert.match(aiErrorMessage({ code: 'GEMINI_INVALID_RESPONSE' }), /unreadable/i)
  assert.doesNotMatch(aiErrorMessage({ code: 'GEMINI_INVALID_KEY', message: 'provider stack trace' }), /provider stack trace|secret key/i)
  assert.match(aiErrorMessage(new Error('AI analysis is currently unavailable. Gemini could not complete this request. Please try again.')), /Retry|try again/i)
})
