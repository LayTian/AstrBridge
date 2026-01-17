(function (global) {
  function AdapterClient(options) {
    this.options = Object.assign(
      {
        url: undefined,
        userId: undefined,
        sessionId: undefined,
        heartbeatMs: 30000,
        reconnect: true,
        reconnectMinMs: 500,
        reconnectMaxMs: 8000,
      },
      options || {}
    );

    this._userId = this.options.userId != null ? String(this.options.userId) : this._getOrCreateUserId();
    this._sessionId =
      this.options.sessionId != null ? String(this.options.sessionId) : this._getOrCreateTabSessionId();

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

  AdapterClient.prototype.isConnected = function () {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  };

  AdapterClient.prototype.onOpen = function (cb) {
    this._onOpenCbs.add(cb);
    return () => this._onOpenCbs.delete(cb);
  };

  AdapterClient.prototype.onClose = function (cb) {
    this._onCloseCbs.add(cb);
    return () => this._onCloseCbs.delete(cb);
  };

  AdapterClient.prototype.onError = function (cb) {
    this._onErrorCbs.add(cb);
    return () => this._onErrorCbs.delete(cb);
  };

  AdapterClient.prototype.onRaw = function (cb) {
    this._onRawCbs.add(cb);
    return () => this._onRawCbs.delete(cb);
  };

  AdapterClient.prototype.onReply = function (cb) {
    this._onReplyCbs.add(cb);
    return () => this._onReplyCbs.delete(cb);
  };

  AdapterClient.prototype.onEvent = function (event, cb) {
    if (!this._onEventCbs.has(event)) this._onEventCbs.set(event, new Set());
    this._onEventCbs.get(event).add(cb);
    return () => this._onEventCbs.get(event) && this._onEventCbs.get(event).delete(cb);
  };

  AdapterClient.prototype.connect = function () {
    this._clearReconnect();
    this._clearHeartbeat();

    const url = this._buildUrl();
    this.ws = new WebSocket(url);

    return new Promise((resolve) => {
      const ws = this.ws;
      ws.addEventListener('open', () => {
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        for (const cb of this._onOpenCbs) cb();
        resolve();
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
      });

      ws.addEventListener('error', (err) => {
        for (const cb of this._onErrorCbs) cb(err);
      });
    });
  };

  AdapterClient.prototype.close = function () {
    this.options.reconnect = false;
    this._clearReconnect();
    this._clearHeartbeat();
    try {
      this.ws && this.ws.close();
    } catch {}
    this.ws = null;
  };

  AdapterClient.prototype.sendText = function (text, overrides) {
    if (!this.isConnected()) throw new Error('not_connected');
    const userId = String((overrides && overrides.userId) || this._userId || '');
    if (!userId) throw new Error('missing_user_id');
    const sessionId = String((overrides && overrides.sessionId) || this._sessionId || 'web');
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
  };

  AdapterClient.prototype._dispatchParsed = function (parsed) {
    if (parsed && typeof parsed === 'object') {
      const event = parsed.event;
      if (event === 'message_reply') {
        const text = parsed && parsed.payload && parsed.payload.text;
        for (const cb of this._onReplyCbs) cb(text, parsed);
      }
      if (typeof event === 'string') {
        const cbs = this._onEventCbs.get(event);
        if (cbs) for (const cb of cbs) cb(parsed);
      }
    }
  };

  AdapterClient.prototype._buildUrl = function () {
    const raw = this.options.url || this._defaultBaseUrl();
    const base = raw.indexOf('://') >= 0 ? raw : `${this._defaultWsProtocol()}://${raw}`;
    const url = new URL(base);
    const userId = this._userId;
    if (userId != null && String(userId) !== '') {
      url.searchParams.set('user_id', String(userId));
    }
    return url.toString();
  };

  AdapterClient.prototype._getOrCreateUserId = function () {
    const key = 'adapter_user_id';
    try {
      const existing = globalThis && globalThis.localStorage && globalThis.localStorage.getItem(key);
      if (existing && /^\d+$/.test(existing)) return existing;
    } catch {}
    const created = this._generateNumericIdString();
    try {
      globalThis && globalThis.localStorage && globalThis.localStorage.setItem(key, created);
    } catch {}
    return created;
  };

  AdapterClient.prototype._getOrCreateTabSessionId = function () {
    const key = 'adapter_session_id';
    try {
      const existing = globalThis && globalThis.sessionStorage && globalThis.sessionStorage.getItem(key);
      if (existing) return existing;
    } catch {}
    const created = `tab_${this._generateRandomToken()}`;
    try {
      globalThis && globalThis.sessionStorage && globalThis.sessionStorage.setItem(key, created);
    } catch {}
    return created;
  };

  AdapterClient.prototype._generateRandomToken = function () {
    try {
      const bytes = new Uint8Array(8);
      globalThis.crypto && globalThis.crypto.getRandomValues && globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    }
  };

  AdapterClient.prototype._generateNumericIdString = function () {
    try {
      const bytes = new Uint8Array(6);
      globalThis.crypto && globalThis.crypto.getRandomValues && globalThis.crypto.getRandomValues(bytes);
      let n = 0;
      for (const b of bytes) n = (n * 256 + b) % 9000000000;
      return String(1000000000 + n);
    } catch {
      return String(1000000000 + Math.floor(Math.random() * 9000000000));
    }
  };

  AdapterClient.prototype._defaultWsProtocol = function () {
    if (typeof location !== 'undefined' && location.protocol === 'https:') return 'wss';
    return 'ws';
  };

  AdapterClient.prototype._defaultBaseUrl = function () {
    if (typeof location !== 'undefined') {
      const proto = this._defaultWsProtocol();
      return `${proto}://${location.hostname}:8080`;
    }
    return 'ws://localhost:8080';
  };

  AdapterClient.prototype._startHeartbeat = function () {
    this._clearHeartbeat();
    const ms = Number(this.options.heartbeatMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, ms);
  };

  AdapterClient.prototype._clearHeartbeat = function () {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  };

  AdapterClient.prototype._scheduleReconnect = function () {
    this._clearReconnect();
    const attempt = this.reconnectAttempts++;
    const min = Number(this.options.reconnectMinMs);
    const max = Number(this.options.reconnectMaxMs);
    const base = Math.min(max, min * Math.pow(2, attempt));
    const delay = Math.max(min, Math.floor(base + Math.random() * 250));
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  };

  AdapterClient.prototype._clearReconnect = function () {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  };

  global.AdapterClient = AdapterClient;
})(typeof window !== 'undefined' ? window : globalThis);
