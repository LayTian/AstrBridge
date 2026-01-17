export class AdapterClient {
  constructor(options) {
    this.options = {
      url: undefined,
      userId: undefined,
      sessionId: undefined,
      heartbeatMs: 30000,
      reconnect: true,
      reconnectMinMs: 500,
      reconnectMaxMs: 8000,
      ...options,
    };

    this._userId = this.options.userId ?? this._getOrCreateUserId();
    this._sessionId = this.options.sessionId ?? this._getOrCreateTabSessionId();

    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    this._onOpenCbs = new Set();
    this._onCloseCbs = new Set();
    this._onErrorCbs = new Set();
    this._onRawCbs = new Set();
    this._onReplyCbs = new Set();
    this._onEventCbs = new Map();
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  onOpen(cb) {
    this._onOpenCbs.add(cb);
    return () => this._onOpenCbs.delete(cb);
  }

  onClose(cb) {
    this._onCloseCbs.add(cb);
    return () => this._onCloseCbs.delete(cb);
  }

  onError(cb) {
    this._onErrorCbs.add(cb);
    return () => this._onErrorCbs.delete(cb);
  }

  onRaw(cb) {
    this._onRawCbs.add(cb);
    return () => this._onRawCbs.delete(cb);
  }

  onReply(cb) {
    this._onReplyCbs.add(cb);
    return () => this._onReplyCbs.delete(cb);
  }

  onEvent(event, cb) {
    if (!this._onEventCbs.has(event)) this._onEventCbs.set(event, new Set());
    this._onEventCbs.get(event).add(cb);
    return () => this._onEventCbs.get(event)?.delete(cb);
  }

  async connect() {
    this._clearReconnect();
    this._clearHeartbeat();

    const url = this._buildUrl();
    this.ws = new WebSocket(url);

    const timeoutMs = Number(this.options.connectTimeoutMs ?? 8000);
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      let opened = false;
      let settled = false;

      const settle = (kind, arg) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (kind === 'resolve') resolve(arg);
        else reject(arg);
      };

      const timer =
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? setTimeout(() => {
              try {
                ws.close();
              } catch {}
              settle('reject', new Error('connect_timeout'));
            }, timeoutMs)
          : null;

      ws.addEventListener('open', () => {
        opened = true;
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        for (const cb of this._onOpenCbs) cb();
        settle('resolve');
      });

      ws.addEventListener('message', (evt) => {
        const data = evt.data;
        for (const cb of this._onRawCbs) cb(data);
        if (typeof data === 'string' && (data === 'PONG' || data === 'PING')) return;
        if (typeof data !== 'string') return;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        this._dispatchParsed(parsed);
      });

      ws.addEventListener('close', () => {
        this._clearHeartbeat();
        for (const cb of this._onCloseCbs) cb();
        if (this.options.reconnect) this._scheduleReconnect();
        if (!opened) settle('reject', new Error('connect_closed'));
      });

      ws.addEventListener('error', (err) => {
        for (const cb of this._onErrorCbs) cb(err);
        if (!opened) settle('reject', new Error('connect_error'));
      });
    });
  }

  close() {
    this.options.reconnect = false;
    this._clearReconnect();
    this._clearHeartbeat();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
  }

  sendText(text, overrides) {
    if (!this.isConnected()) throw new Error('not_connected');
    const userId = String(overrides?.userId ?? this._userId ?? '');
    if (!userId) throw new Error('missing_user_id');
    const sessionId = String(overrides?.sessionId ?? this._sessionId ?? 'web');

    const payload = {
      event: 'message_new',
      payload: {
        text: String(text),
        metadata: {
          user_id: userId,
          session_id: sessionId,
        },
      },
    };
    this.ws.send(JSON.stringify(payload));
  }

  _dispatchParsed(parsed) {
    if (parsed && typeof parsed === 'object') {
      const event = parsed.event;
      if (event === 'message_reply') {
        const text = parsed?.payload?.text;
        for (const cb of this._onReplyCbs) cb(text, parsed);
      }
      if (typeof event === 'string') {
        const cbs = this._onEventCbs.get(event);
        if (cbs) for (const cb of cbs) cb(parsed);
      }
    }
  }

  _buildUrl() {
    const raw = this.options.url || this._defaultBaseUrl();
    const base = raw.includes('://') ? raw : `${this._defaultWsProtocol()}://${raw}`;
    const url = new URL(base);
    const userId = this._userId;
    if (userId != null && String(userId) !== '') {
      url.searchParams.set('user_id', String(userId));
    }
    return url.toString();
  }

  _getOrCreateUserId() {
    const key = 'adapter_user_id';
    try {
      const existing = globalThis?.localStorage?.getItem(key);
      if (existing && /^\d+$/.test(existing)) return existing;
    } catch {}

    const created = this._generateNumericIdString();
    try {
      globalThis?.localStorage?.setItem(key, created);
    } catch {}
    return created;
  }

  _getOrCreateTabSessionId() {
    const key = 'adapter_session_id';
    try {
      const existing = globalThis?.sessionStorage?.getItem(key);
      if (existing) return existing;
    } catch {}

    const created = `tab_${this._generateRandomToken()}`;
    try {
      globalThis?.sessionStorage?.setItem(key, created);
    } catch {}
    return created;
  }

  _generateRandomToken() {
    try {
      const bytes = new Uint8Array(8);
      globalThis.crypto?.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    }
  }

  _generateNumericIdString() {
    try {
      const bytes = new Uint8Array(6);
      globalThis.crypto?.getRandomValues(bytes);
      let n = 0;
      for (const b of bytes) n = (n * 256 + b) % 9000000000;
      return String(1000000000 + n);
    } catch {
      return String(1000000000 + Math.floor(Math.random() * 9000000000));
    }
  }

  _defaultWsProtocol() {
    if (typeof location !== 'undefined' && location.protocol === 'https:') return 'wss';
    return 'ws';
  }

  _defaultBaseUrl() {
    if (typeof location !== 'undefined') {
      const proto = this._defaultWsProtocol();
      const host = location.hostname || 'localhost';
      const port = location.port ? Number(location.port) : 8080;
      return `${proto}://${host}:${port}`;
    }
    return 'ws://localhost:8080';
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    const ms = Number(this.options.heartbeatMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, ms);
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  _scheduleReconnect() {
    this._clearReconnect();
    const attempt = this.reconnectAttempts++;
    const min = Number(this.options.reconnectMinMs);
    const max = Number(this.options.reconnectMaxMs);
    const base = Math.min(max, min * Math.pow(2, attempt));
    const delay = Math.max(min, Math.floor(base + Math.random() * 250));
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
