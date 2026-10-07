import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import type { DocumentRef } from '../shared/protocol.ts'

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024

const KINDS: Record<string, DocumentRef['kind']> = {
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
}

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function documentKind(mimeType: string, filename: string): { kind: DocumentRef['kind']; mimeType: string } {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  if (KINDS[base]) return { kind: KINDS[base], mimeType: base }
  // Browsers often send an empty or generic type for .md / .csv.
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'pdf') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === 'csv') return { kind: 'text', mimeType: 'text/plain' }
  throw new DocumentError('只支持 PDF、TXT、Markdown、CSV 文件（Word/PPT 请先导出为 PDF）', 415)
}

export interface DocumentStore {
  readonly name: string
  upload(filename: string, mimeType: string, bytes: Uint8Array): Promise<DocumentRef>
  delete(id: string): Promise<void>
}

/**
 * Uploads documents once to the Anthropic Files API; every later request in
 * every meeting references them by `file_id` instead of re-sending bytes.
 * Files persist until the user deletes them in the UI.
 */
export class AnthropicDocumentStore implements DocumentStore {
  readonly name = 'anthropic-files'

  constructor(private readonly client = new Anthropic()) {}

  async upload(filename: string, mimeType: string, bytes: Uint8Array): Promise<DocumentRef> {
    const { kind, mimeType: type } = documentKind(mimeType, filename)
    validateSize(bytes)
    const file = await this.client.files.upload({ file: await toFile(bytes, filename, { type }) })
    return { id: file.id, name: filename, kind, sizeBytes: bytes.byteLength }
  }

  async delete(id: string): Promise<void> {
    await this.client.files.delete(id)
  }
}

/** Offline stand-in (mock LLM mode): keeps metadata only. */
export class MemoryDocumentStore implements DocumentStore {
  readonly name = 'memory'
  readonly documents = new Map<string, DocumentRef>()

  async upload(filename: string, mimeType: string, bytes: Uint8Array): Promise<DocumentRef> {
    const { kind } = documentKind(mimeType, filename)
    validateSize(bytes)
    const ref: DocumentRef = { id: `local_${randomUUID()}`, name: filename, kind, sizeBytes: bytes.byteLength }
    this.documents.set(ref.id, ref)
    return ref
  }

  async delete(id: string): Promise<void> {
    this.documents.delete(id)
  }
}

function validateSize(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new DocumentError('文件为空', 400)
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentError('文件超过 32 MB', 413)
}

/** Keeps only well-formed refs from client input. */
export function sanitizeDocuments(input: unknown): DocumentRef[] {
  if (!Array.isArray(input)) return []
  return input
    .filter(
      (d): d is DocumentRef =>
        typeof d === 'object' &&
        d !== null &&
        typeof d.id === 'string' &&
        /^[\w-]{1,128}$/.test(d.id) &&
        typeof d.name === 'string' &&
        (d.kind === 'pdf' || d.kind === 'text'),
    )
    .slice(0, 20)
    .map((d) => ({ id: d.id, name: d.name.slice(0, 200), kind: d.kind, sizeBytes: Number(d.sizeBytes) || 0 }))
}
