import type { DocumentRef } from '../../shared/protocol.ts'

function apiUrl(path: string): string {
  const token = new URLSearchParams(location.search).get('token')
  return `${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // not JSON
  }
  return `上传失败（HTTP ${response.status}）`
}

export async function uploadDocument(file: File): Promise<DocumentRef> {
  const response = await fetch(apiUrl('/api/documents'), {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
    body: file,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return (await response.json()) as DocumentRef
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/documents/${encodeURIComponent(id)}`), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error(await errorMessage(response))
}
