export async function api(path, options = {}) {
  const token = localStorage.getItem('jobekaa_token')
  const headers = { ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || 'Something went wrong. Please try again.')
    error.code = payload.code || 'REQUEST_FAILED'
    error.failureCategory = payload.failureCategory || payload.code?.toLowerCase()
    error.status = response.status
    throw error
  }
  return payload
}
