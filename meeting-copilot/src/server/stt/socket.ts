import WebSocket from 'ws'

/** A provider that has not answered the WebSocket handshake by then is treated as down. */
export const HANDSHAKE_TIMEOUT_MS = 10_000

/**
 * Audio queued while a stream connects. Generous on purpose: after a dropped client
 * reconnects it replays its buffer (~2.5 min) at up to 8× speed, possibly while a
 * new stream is still connecting, and every frame dropped here is lost speech.
 */
export const MAX_QUEUED_FRAMES = 1_500

/**
 * Provider error statuses (HTTP-style) after which reconnecting cannot help: a bad
 * key, no credit left, a malformed or rejected request. Timeouts (408), the stream
 * duration limit (413) and rate limiting (429) are worth retrying.
 */
export function isFatalStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 413 && status !== 429
}

export function closeDetail(provider: string, code: number, reason: Buffer, errorStatus?: number): string {
  const why = reason.toString().trim().slice(0, 120)
  return `${provider} 断开了连接（${errorStatus ? `错误 ${errorStatus}` : `代码 ${code}`}${why ? `：${why}` : ''}）`
}

/**
 * Detects a connection that died without closing (a Wi-Fi switch, sleep, a NAT
 * timeout): TCP only notices after minutes, and meanwhile that source's captions
 * silently stop. Pings every `intervalMs`; a pong or any message counts as alive.
 * Two silent intervals in a row terminate the socket, which closes it so the
 * session can open a new one. Returns a function that stops watching.
 */
export function watchLiveness(socket: WebSocket, intervalMs = 10_000): () => void {
  let missed = 0
  const alive = () => {
    missed = 0
  }
  socket.on('pong', alive)
  socket.on('message', alive)
  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return
    if (missed >= 2) {
      socket.terminate()
      return
    }
    missed++
    socket.ping()
  }, intervalMs)
  return () => clearInterval(timer)
}
