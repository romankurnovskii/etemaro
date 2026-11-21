/** localStorage key for the console daemon bearer token. Per-agent tokens are never stored. */
export const TOKEN_STORAGE_KEY = 'etemaro.token'

/** Token from `?token=` (persisted) or localStorage. */
export function readInitialToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    storeToken(fromUrl)
    return fromUrl
  }
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storeToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* storage unavailable (private mode) — token stays in memory */
  }
}
