export type AuditResult = 'ok' | 'failed'

export interface AuditEntry {
  ts: number
  time: string
  actor: string
  role: string
  action: string
  target?: string
  ip?: string
  result: AuditResult
  detail?: string
}

export class AuditHub {
  private readonly maxEntries: number
  private readonly entries: AuditEntry[] = []

  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries
  }

  public add(entry: Omit<AuditEntry, 'ts' | 'time'>): AuditEntry {
    const ts = Date.now()
    const time = new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
    const full: AuditEntry = { ts, time, ...entry }
    this.entries.push(full)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
    return full
  }

  public getRecent(limit = 200): AuditEntry[] {
    const n = Math.max(0, Math.min(limit, this.entries.length))
    return this.entries.slice(this.entries.length - n)
  }
}

