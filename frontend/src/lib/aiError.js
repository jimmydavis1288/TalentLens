const messages = {
  GEMINI_NOT_CONFIGURED: 'AI analysis is not configured. Please ask the administrator to configure Gemini and try again.',
  GEMINI_INVALID_KEY: 'Gemini credentials are invalid or lack permission. Please ask the administrator to update them.',
  GEMINI_QUOTA_EXHAUSTED: 'Gemini quota is exhausted. Please try again when quota is available.',
  GEMINI_RATE_LIMITED: 'Gemini is rate limiting requests. Please retry shortly.',
  GEMINI_UNAVAILABLE: 'Gemini is temporarily unavailable. Please try again shortly.',
  GEMINI_MODEL_UNAVAILABLE: 'The configured Gemini model is unavailable. Please ask the administrator to verify it.',
  GEMINI_INVALID_RESPONSE: 'Gemini returned an unreadable analysis. Please try again.',
}

export function aiErrorMessage(error) {
  return messages[error?.code] || error?.message || 'AI analysis is currently unavailable. Gemini could not complete this request. Please try again.'
}
