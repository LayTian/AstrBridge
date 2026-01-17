export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  time: string;
  level: LogLevel;
  message: string;
}

export class LogHub {
  private readonly maxEntries: number;
  private readonly entries: LogEntry[] = [];
  private readonly subscribers = new Set<(entry: LogEntry) => void>();

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  public add(level: LogLevel, message: string): LogEntry {
    const ts = Date.now();
    const time = new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
    const entry: LogEntry = { ts, time, level, message };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    for (const cb of this.subscribers) cb(entry);
    return entry;
  }

  public getRecent(limit = 200): LogEntry[] {
    const n = Math.max(0, Math.min(limit, this.entries.length));
    return this.entries.slice(this.entries.length - n);
  }

  public subscribe(cb: (entry: LogEntry) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
}

