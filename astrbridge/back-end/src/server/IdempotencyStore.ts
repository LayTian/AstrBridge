export type StoredResponse = {
  httpStatus: number
  body: any
}

export type IdempotencyRunResult = {
  cache: 'miss' | 'hit' | 'inflight'
  response: StoredResponse
}

type Entry =
  | { state: 'pending'; promise: Promise<StoredResponse>; expiresAt: number }
  | { state: 'done'; value: StoredResponse; expiresAt: number }

export class IdempotencyStore {
  private entries: Map<string, Entry>

  constructor() {
    this.entries = new Map()
  }

  public async run(key: string, ttlMs: number, fn: () => Promise<StoredResponse>): Promise<IdempotencyRunResult> {
    const k = String(key || '')
    if (!k) return { cache: 'miss', response: await fn() }
    this.prune()

    const existing = this.entries.get(k)
    if (existing) {
      if (existing.state === 'done') return { cache: 'hit', response: existing.value }
      return { cache: 'inflight', response: await existing.promise }
    }

    const expiresAt = Date.now() + Math.max(1, Math.floor(ttlMs))
    const promise = (async () => {
      try {
        const value = await fn()
        this.entries.set(k, { state: 'done', value, expiresAt })
        return value
      } catch (e: any) {
        const value: StoredResponse = { httpStatus: 503, body: { status: 'failed', error: e?.message || 'service_unavailable' } }
        this.entries.set(k, { state: 'done', value, expiresAt })
        return value
      }
    })()

    this.entries.set(k, { state: 'pending', promise, expiresAt })
    return { cache: 'miss', response: await promise }
  }

  private prune(): void {
    const now = Date.now()
    for (const [k, v] of this.entries.entries()) {
      if (v.expiresAt <= now) this.entries.delete(k)
    }
  }
}
