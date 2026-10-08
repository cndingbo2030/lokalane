const KEY = 'meeting-copilot:access-token'

/**
 * The server's ACCESS_TOKEN, from the page URL (?token=…) or, for an app
 * installed to the home screen (which opens without the query string), from the
 * last visit that had it.
 */
export function accessToken(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('token')
  try {
    if (fromUrl) localStorage.setItem(KEY, fromUrl)
    return fromUrl ?? localStorage.getItem(KEY)
  } catch {
    return fromUrl
  }
}
