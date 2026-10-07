import type { MeetingRecord } from './model.ts'

const DB_NAME = 'meeting-copilot'
const STORE = 'meetings'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('startedAt', 'startedAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  // Private windows and blocked storage reject; allow a later retry.
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export const meetingHistory = {
  save: (record: MeetingRecord) => run('readwrite', (s) => s.put(record)).then(() => undefined),
  list: () => run<MeetingRecord[]>('readonly', (s) => s.getAll()),
  remove: (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined),
}
