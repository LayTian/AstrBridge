type Pending = {
  resolve: (payload: any) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout | null
}

export class ReplyWaiterHub {
  private waitersByRequestId: Map<string, Pending>
  private userQueues: Map<string, string[]>

  constructor() {
    this.waitersByRequestId = new Map()
    this.userQueues = new Map()
  }

  public register(userId: string, requestId: string, timeoutMs: number): Promise<any> {
    const uid = String(userId)
    const rid = String(requestId)
    const ms = Number(timeoutMs)
    const t = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 15000
    if (!rid) return Promise.reject(new Error('missing_request_id'))

    return new Promise((resolve, reject) => {
      const pending: Pending = {
        resolve: (payload) => resolve(payload),
        reject: (err) => reject(err),
        timer: null
      }

      pending.timer = setTimeout(() => {
        this.rejectByRequestId(rid, new Error('timeout'))
      }, t)

      this.waitersByRequestId.set(rid, pending)

      const q = this.userQueues.get(uid) || []
      q.push(rid)
      this.userQueues.set(uid, q)
    })
  }

  public deliver(userId: string, payload: any): string | null {
    const uid = String(userId)
    const q = this.userQueues.get(uid)
    if (!q || q.length === 0) return null
    const rid = q.shift()!
    if (q.length === 0) this.userQueues.delete(uid)
    const pending = this.waitersByRequestId.get(rid)
    if (!pending) return rid
    this.waitersByRequestId.delete(rid)
    if (pending.timer) clearTimeout(pending.timer)
    try {
      if (payload && typeof payload === 'object') {
        const meta = payload?.payload?.metadata
        if (meta && typeof meta === 'object') meta.request_id = rid
      }
    } catch {}
    pending.resolve(payload)
    return rid
  }

  public rejectByRequestId(requestId: string, err: Error): boolean {
    const rid = String(requestId)
    const pending = this.waitersByRequestId.get(rid)
    if (!pending) return false
    this.waitersByRequestId.delete(rid)
    if (pending.timer) clearTimeout(pending.timer)
    pending.reject(err)
    for (const [uid, q] of this.userQueues.entries()) {
      const idx = q.indexOf(rid)
      if (idx >= 0) {
        q.splice(idx, 1)
        if (q.length === 0) this.userQueues.delete(uid)
        break
      }
    }
    return true
  }
}
