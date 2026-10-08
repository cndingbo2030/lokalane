import { describe, expect, it } from 'vitest'
import { DocumentError, documentKind, MemoryDocumentStore, sanitizeDocuments } from './documents.ts'
import { sanitizeSpeakerNames } from './transcript.ts'

describe('documentKind', () => {
  it('accepts PDFs and text, inferring from the extension when the type is generic', () => {
    expect(documentKind('application/pdf', 'a.pdf').kind).toBe('pdf')
    expect(documentKind('', '报价单.PDF')).toEqual({ kind: 'pdf', mimeType: 'application/pdf' })
    expect(documentKind('application/octet-stream', 'faq.md')).toEqual({ kind: 'text', mimeType: 'text/plain' })
    expect(documentKind('text/csv; charset=utf-8', 'prices.csv').kind).toBe('text')
  })

  it('rejects unsupported formats with a 415', () => {
    expect(() => documentKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toThrow(DocumentError)
  })
})

describe('MemoryDocumentStore', () => {
  it('stores refs and enforces size limits', async () => {
    const store = new MemoryDocumentStore()
    const ref = await store.upload('a.txt', 'text/plain', new TextEncoder().encode('hello'))
    expect(ref).toMatchObject({ name: 'a.txt', kind: 'text', sizeBytes: 5 })
    await store.delete(ref.id)
    expect(store.documents.size).toBe(0)
    await expect(store.upload('e.txt', 'text/plain', new Uint8Array())).rejects.toThrow('文件为空')
  })
})

describe('sanitizers', () => {
  it('keeps only well-formed document refs', () => {
    const ok = { id: 'file_1', name: 'a.pdf', kind: 'pdf', sizeBytes: 3 }
    expect(sanitizeDocuments([ok, { id: 'bad id!', name: 'x', kind: 'pdf' }, { id: 'f', name: 1, kind: 'pdf' }, null])).toEqual([ok])
    expect(sanitizeDocuments('nope')).toEqual([])
  })

  it('keeps only S<n> speaker ids with short printable names', () => {
    expect(sanitizeSpeakerNames({ S1: ' 王总 ', S2: '', admin: 'x', S3: '<b>Li</b>\u0000' })).toEqual({ S1: '王总', S3: 'bLi/b' })
    expect(sanitizeSpeakerNames(null)).toEqual({})
  })
})
