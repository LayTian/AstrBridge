type Snapshot = {
  counters: Record<string, number>
  gauges: Record<string, number>
  histograms: Record<string, { count: number; p50: number; p95: number; p99: number }>
}

class RollingHistogram {
  private values: number[]
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.values = []
    this.maxSize = Math.max(10, Math.floor(maxSize))
  }

  observe(v: number): void {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    this.values.push(n)
    if (this.values.length > this.maxSize) this.values.splice(0, this.values.length - this.maxSize)
  }

  count(): number {
    return this.values.length
  }

  quantile(q: number): number {
    if (this.values.length === 0) return 0
    const qq = Math.min(1, Math.max(0, q))
    const sorted = [...this.values].sort((a, b) => a - b)
    const idx = Math.floor((sorted.length - 1) * qq)
    return sorted[idx] ?? 0
  }
}

export class MetricsHub {
  private counters: Map<string, number>
  private gauges: Map<string, number>
  private histograms: Map<string, RollingHistogram>

  constructor() {
    this.counters = new Map()
    this.gauges = new Map()
    this.histograms = new Map()
  }

  public inc(name: string, by?: number): void {
    const key = String(name || '')
    if (!key) return
    const delta = Number(by ?? 1)
    const next = (this.counters.get(key) || 0) + (Number.isFinite(delta) ? delta : 1)
    this.counters.set(key, next)
  }

  public setGauge(name: string, value: number): void {
    const key = String(name || '')
    if (!key) return
    const v = Number(value)
    if (!Number.isFinite(v)) return
    this.gauges.set(key, v)
  }

  public observe(name: string, value: number): void {
    const key = String(name || '')
    if (!key) return
    const h = this.histograms.get(key) || new RollingHistogram(2000)
    h.observe(value)
    this.histograms.set(key, h)
  }

  public snapshot(): Snapshot {
    const counters: Record<string, number> = {}
    const gauges: Record<string, number> = {}
    const histograms: Record<string, { count: number; p50: number; p95: number; p99: number }> = {}

    for (const [k, v] of this.counters.entries()) counters[k] = v
    for (const [k, v] of this.gauges.entries()) gauges[k] = v
    for (const [k, h] of this.histograms.entries()) {
      histograms[k] = { count: h.count(), p50: h.quantile(0.5), p95: h.quantile(0.95), p99: h.quantile(0.99) }
    }
    return { counters, gauges, histograms }
  }
}

