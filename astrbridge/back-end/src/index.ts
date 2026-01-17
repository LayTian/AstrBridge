import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { WebSocketServer } from './server/WebSocketServer';
import { LogHub } from './logging/LogHub';
import { installConsoleCapture } from './logging/installConsoleCapture';
import { config as envConfig } from './config';
import { AuditHub } from './logging/AuditHub';
import { IdempotencyStore } from './server/IdempotencyStore';
import { MetricsHub } from './metrics/MetricsHub';
import { openapiSpec } from './openapi';

const PORT = Number(envConfig.PORT || process.env.PORT || 8080);

try {
    // 1. Initialize Express
    const app = express();

    const logHub = new LogHub(2000);
    installConsoleCapture(logHub);
    const auditHub = new AuditHub(2000);
    const idempotency = new IdempotencyStore();
    const metrics = new MetricsHub();

    const corsAllowedOrigins = String(process.env.CORS_ALLOW_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    app.use((req, res, next) => {
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
        const allowAny = corsAllowedOrigins.includes('*');
        const allowed = allowAny || (origin && corsAllowedOrigins.includes(origin));
        if (allowed && origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Admin-Token, X-Integration-Secret, Idempotency-Key, X-Idempotency-Key'
        );
        if (req.method === 'OPTIONS') return res.status(204).end();
        return next();
    });
    
    // 2. Serve WebUI static files (Dashboard)
    // In production, this would point to web-admin/dist
    const resolveAdminDist = () => {
        const candidates: string[] = [];
        const envRaw = String(process.env.ADMIN_DIST || process.env.ADMIN_UI_DIST || '').trim();
        if (envRaw) {
            candidates.push(path.isAbsolute(envRaw) ? envRaw : path.resolve(process.cwd(), envRaw));
        }
        const baseDir = path.resolve(__dirname, '..');
        candidates.push(path.join(baseDir, '..', 'front-end', 'dist'));
        for (const dir of candidates) {
            const idx = path.join(dir, 'index.html');
            if (fs.existsSync(idx)) return { dir, index: idx };
        }
        return null;
    };
    const admin = resolveAdminDist();
    if (admin) {
        app.use('/admin', express.static(admin.dir));
        app.get('/admin', (_req, res) => res.sendFile(admin.index));
        app.get(/^\/admin\/.*$/, (_req, res) => res.sendFile(admin.index));
    }
    app.use(express.static(path.join(__dirname, '../public')));
    
    // 3. Create HTTP Server
    const server = http.createServer(app);

    // 4. Attach WebSocket Server to HTTP Server
    const wsServer = new WebSocketServer({
        port: PORT 
    }, server);

    const generateRequestId = () => {
        const bytes = crypto.randomBytes(12);
        return bytes
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    };

    const getIdempotencyKey = (req: express.Request) => {
        const headerKey =
            (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : '') ||
            (typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : '');
        const bodyKey = typeof (req.body as any)?.idempotency_key === 'string' ? String((req.body as any).idempotency_key) : '';
        const key = (headerKey || bodyKey || '').trim();
        return key ? key.slice(0, 200) : '';
    };

    // --- Admin API Routes ---
    app.use(express.json());

    const base64UrlEncode = (input: string | Buffer) => {
        return Buffer.from(input)
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    };

    const base64UrlDecodeToString = (input: string) => {
        const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
        return Buffer.from(padded, 'base64').toString('utf8');
    };

    const base64UrlDecodeToBuffer = (input: string) => {
        const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
        return Buffer.from(padded, 'base64');
    };

    type Role = 'admin' | 'super_admin';
    type TokenKind = 'access' | 'refresh';

    type TokenPayload = {
        sub: string;
        iat: number;
        exp: number;
        kind: TokenKind;
        role: Role;
    };

    const signToken = (payload: TokenPayload, secret: string) => {
        const header = { alg: 'HS256', typ: 'JWT' };
        const headerPart = base64UrlEncode(JSON.stringify(header));
        const payloadPart = base64UrlEncode(JSON.stringify(payload));
        const data = `${headerPart}.${payloadPart}`;
        const sig = crypto.createHmac('sha256', secret).update(data).digest();
        const sigPart = base64UrlEncode(sig);
        return `${data}.${sigPart}`;
    };

    const verifyToken = (token: string, secret: string): { ok: true; payload: TokenPayload } | { ok: false; reason: string } => {
        const parts = token.split('.');
        if (parts.length !== 3) return { ok: false, reason: 'invalid_format' };
        const [headerPart, payloadPart, sigPart] = parts;
        if (!headerPart || !payloadPart || !sigPart) return { ok: false, reason: 'invalid_format' };

        let header: any;
        let payload: any;
        try {
            header = JSON.parse(base64UrlDecodeToString(headerPart));
            payload = JSON.parse(base64UrlDecodeToString(payloadPart));
        } catch {
            return { ok: false, reason: 'invalid_json' };
        }
        if (!header || header.alg !== 'HS256') return { ok: false, reason: 'unsupported_alg' };

        const data = `${headerPart}.${payloadPart}`;
        const expectedSig = crypto.createHmac('sha256', secret).update(data).digest();
        const gotSig = base64UrlDecodeToBuffer(sigPart);
        if (gotSig.length !== expectedSig.length || !crypto.timingSafeEqual(gotSig, expectedSig)) {
            return { ok: false, reason: 'bad_signature' };
        }

        const exp = Number(payload?.exp);
        const sub = String(payload?.sub || '');
        const iat = Number(payload?.iat);
        const kind = payload?.kind as TokenKind | undefined;
        const role = payload?.role as Role | undefined;
        if (!sub || !Number.isFinite(exp) || !Number.isFinite(iat)) return { ok: false, reason: 'invalid_payload' };
        if (kind !== 'access' && kind !== 'refresh') return { ok: false, reason: 'invalid_payload' };
        if (role !== 'admin' && role !== 'super_admin') return { ok: false, reason: 'invalid_payload' };
        const now = Math.floor(Date.now() / 1000);
        if (exp <= now) return { ok: false, reason: 'expired' };

        return { ok: true, payload: { sub, iat, exp, kind, role } };
    };

    const getBearerToken = (req: express.Request) => {
        const auth = req.headers['authorization'];
        const tokenHeader = req.headers['x-admin-token'];
        const tokenFromAuth =
            typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
                ? auth.slice(7).trim()
                : null;
        return tokenFromAuth || (typeof tokenHeader === 'string' ? tokenHeader : null);
    };

    const parseCookies = (cookieHeader: string | undefined) => {
        const cookies: Record<string, string> = {};
        if (!cookieHeader) return cookies;
        const parts = cookieHeader.split(';');
        for (const part of parts) {
            const idx = part.indexOf('=');
            if (idx <= 0) continue;
            const key = part.slice(0, idx).trim();
            const value = part.slice(idx + 1).trim();
            if (!key) continue;
            cookies[key] = value;
        }
        return cookies;
    };

    const isHttps = (req: express.Request) => {
        const proto = req.headers['x-forwarded-proto'];
        if (typeof proto === 'string') return proto.split(',')[0].trim() === 'https';
        return (req as any).secure === true;
    };

    const setRefreshCookie = (req: express.Request, res: express.Response, token: string, maxAgeSeconds: number) => {
        const pieces = [
            `refresh_token=${token}`,
            `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
            'Path=/api/auth',
            'HttpOnly',
            'SameSite=Lax'
        ];
        if (isHttps(req)) pieces.push('Secure');
        res.setHeader('Set-Cookie', pieces.join('; '));
    };

    const clearRefreshCookie = (req: express.Request, res: express.Response) => {
        setRefreshCookie(req, res, '', 0);
    };

    app.post('/api/auth/login', (req, res) => {
        const adminUser = process.env.ADMIN_USERNAME;
        const adminPass = process.env.ADMIN_PASSWORD;
        const tokenSecret = process.env.ADMIN_TOKEN_SECRET;
        const superKey = process.env.SUPER_ADMIN_KEY;
        const accessTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || process.env.ADMIN_TOKEN_TTL_SECONDS || 900);
        const refreshTtl = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 604800);

        const ip = req.ip || (req.socket as any)?.remoteAddress;
        if (!adminUser || !adminPass || !tokenSecret) {
            auditHub.add({ actor: 'unknown', role: 'unknown', action: 'login', result: 'failed', ip: String(ip || ''), detail: 'auth_not_configured' });
            return res.status(503).json({ status: 'failed', error: 'auth_not_configured' });
        }
        const username = String(req.body?.username || '');
        const password = String(req.body?.password || '');
        const superKeyInput = String(req.body?.super_key || '').trim();
        if (!username || !password) {
            auditHub.add({ actor: username || 'unknown', role: 'unknown', action: 'login', result: 'failed', ip: String(ip || ''), detail: 'invalid_params' });
            return res.status(400).json({ status: 'failed', error: 'invalid_params' });
        }
        if (username !== adminUser || password !== adminPass) {
            auditHub.add({ actor: username, role: 'unknown', action: 'login', result: 'failed', ip: String(ip || ''), detail: 'invalid_credentials' });
            return res.status(401).json({ status: 'failed', error: 'invalid_credentials' });
        }
        const role: Role =
            superKey && superKeyInput && superKeyInput === superKey
                ? 'super_admin'
                : 'admin';
        const now = Math.floor(Date.now() / 1000);
        const accessExp = now + (Number.isFinite(accessTtl) && accessTtl > 0 ? Math.floor(accessTtl) : 900);
        const refreshExp = now + (Number.isFinite(refreshTtl) && refreshTtl > 0 ? Math.floor(refreshTtl) : 604800);

        const accessToken = signToken({ sub: username, iat: now, exp: accessExp, kind: 'access', role }, tokenSecret);
        const refreshToken = signToken({ sub: username, iat: now, exp: refreshExp, kind: 'refresh', role }, tokenSecret);
        setRefreshCookie(req, res, refreshToken, refreshExp - now);
        auditHub.add({ actor: username, role, action: 'login', result: 'ok', ip: String(ip || '') });
        return res.json({ status: 'ok', access_token: accessToken, expires_at: accessExp, role });
    });

    app.post('/api/auth/refresh', (req, res) => {
        const tokenSecret = process.env.ADMIN_TOKEN_SECRET;
        const accessTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || process.env.ADMIN_TOKEN_TTL_SECONDS || 900);
        const refreshTtl = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 604800);
        const ip = req.ip || (req.socket as any)?.remoteAddress;
        if (!tokenSecret) {
            auditHub.add({ actor: 'unknown', role: 'unknown', action: 'refresh', result: 'failed', ip: String(ip || ''), detail: 'auth_not_configured' });
            return res.status(503).json({ status: 'failed', error: 'auth_not_configured' });
        }
        const cookies = parseCookies(req.headers.cookie);
        const refreshToken = cookies['refresh_token'];
        if (!refreshToken) {
            auditHub.add({ actor: 'unknown', role: 'unknown', action: 'refresh', result: 'failed', ip: String(ip || ''), detail: 'missing_cookie' });
            return res.status(401).json({ status: 'failed', error: 'unauthorized' });
        }
        const verified = verifyToken(refreshToken, tokenSecret);
        if (!verified.ok || verified.payload.kind !== 'refresh') {
            clearRefreshCookie(req, res);
            const detail = !verified.ok ? verified.reason : 'invalid_kind';
            auditHub.add({ actor: 'unknown', role: 'unknown', action: 'refresh', result: 'failed', ip: String(ip || ''), detail });
            return res.status(401).json({ status: 'failed', error: 'unauthorized' });
        }
        const now = Math.floor(Date.now() / 1000);
        const accessExp = now + (Number.isFinite(accessTtl) && accessTtl > 0 ? Math.floor(accessTtl) : 900);
        const refreshExp = now + (Number.isFinite(refreshTtl) && refreshTtl > 0 ? Math.floor(refreshTtl) : 604800);
        const role = verified.payload.role;
        const sub = verified.payload.sub;

        const accessToken = signToken({ sub, iat: now, exp: accessExp, kind: 'access', role }, tokenSecret);
        const nextRefresh = signToken({ sub, iat: now, exp: refreshExp, kind: 'refresh', role }, tokenSecret);
        setRefreshCookie(req, res, nextRefresh, refreshExp - now);
        auditHub.add({ actor: sub, role, action: 'refresh', result: 'ok', ip: String(ip || '') });
        return res.json({ status: 'ok', access_token: accessToken, expires_at: accessExp, role });
    });

    app.post('/api/auth/logout', (req, res) => {
        const admin = (req as any).admin as TokenPayload | undefined;
        const ip = req.ip || (req.socket as any)?.remoteAddress;
        if (admin) {
            auditHub.add({ actor: admin.sub, role: admin.role, action: 'logout', result: 'ok', ip: String(ip || '') });
        } else {
            auditHub.add({ actor: 'unknown', role: 'unknown', action: 'logout', result: 'ok', ip: String(ip || '') });
        }
        clearRefreshCookie(req, res);
        return res.json({ status: 'ok' });
    });

    app.get('/api/openapi.json', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(openapiSpec);
    });

    app.get('/openapi.json', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(openapiSpec);
    });

    app.get('/api/public/status', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const sessions = wsServer.getSessionManager().getAllSessions();
        const onlineCount = sessions.filter((s) => s.online).length;
        const queuedCount = sessions.reduce((acc, s) => acc + s.queueSize, 0);
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            online_users: onlineCount,
            total_sessions: sessions.length,
            queued_messages: queuedCount,
            astrbot_connected: wsServer.getAstrBotStatus().connected
        });
    });

    app.use('/api', (req, res, next) => {
        if (req.path === '/auth/login') return next();
        if (req.path === '/auth/refresh') return next();
        if (req.path === '/auth/logout') return next();
        if (req.path === '/metrics') return next();
        if (req.path === '/metrics/health') return next();
        if (req.path.startsWith('/integrations/')) return next();

        const tokenSecret = process.env.ADMIN_TOKEN_SECRET;
        const jwtEnabled = !!tokenSecret;

        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }

        const token = getBearerToken(req);
        if (!jwtEnabled) {
            return next();
        }

        if (!token) {
            return res.status(401).json({ status: 'failed', error: 'unauthorized' });
        }

        const verified = verifyToken(token, tokenSecret!);
        if (verified.ok && verified.payload.kind === 'access') {
            (req as any).admin = verified.payload;
            return next();
        }

        return res.status(401).json({ status: 'failed', error: 'unauthorized' });
    });

    app.post('/api/integrations/:id/events', async (req, res) => {
        const integrationId = req.params.id;
        metrics.inc('integrations_events_total');
        const secretHeader = req.headers['x-integration-secret'] as string | undefined;
        const requiredSecret = process.env.INTEGRATION_SECRET;
        if (requiredSecret && secretHeader !== requiredSecret) {
            metrics.inc('integrations_events_unauthorized_total');
            return res.status(401).json({ status: 'failed', error: 'unauthorized' });
        }
        const { user_id, text } = req.body || {};
        if (!text || !user_id) {
            metrics.inc('integrations_events_invalid_params_total');
            return res.status(400).json({ status: 'failed', error: 'invalid_params' });
        }
        const idem = getIdempotencyKey(req);
        if (idem) metrics.inc('idempotency_used_total');
        const ttlSeconds = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 300);
        const ttlMs = (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : 300) * 1000;
        const scopeKey = idem ? `integrations:${integrationId}:events:${idem}` : '';
        const idemResult = await idempotency.run(scopeKey, ttlMs, async () => {
            const requestId = generateRequestId();
            try {
                await wsServer.sendFromIntegration(String(user_id), String(text), String(integrationId || ''));
                return { httpStatus: 200, body: { status: 'ok', integration: integrationId, request_id: requestId } };
            } catch (e: any) {
                return { httpStatus: 503, body: { status: 'failed', error: e?.message || 'service_unavailable' } };
            }
        });
        if (idemResult.cache === 'hit') metrics.inc('idempotency_hit_total');
        if (idemResult.cache === 'inflight') metrics.inc('idempotency_inflight_total');
        const stored = idemResult.response;
        if (stored.httpStatus >= 200 && stored.httpStatus < 300) metrics.inc('integrations_events_ok_total');
        else metrics.inc('integrations_events_failed_total');
        return res.status(stored.httpStatus).json(stored.body);
    });

    app.post('/api/integrations/:id/request-reply', async (req, res) => {
        const integrationId = req.params.id;
        metrics.inc('integrations_request_reply_total');
        const secretHeader = req.headers['x-integration-secret'] as string | undefined;
        const requiredSecret = process.env.INTEGRATION_SECRET;
        if (requiredSecret && secretHeader !== requiredSecret) {
            metrics.inc('integrations_request_reply_unauthorized_total');
            return res.status(401).json({ status: 'failed', error: 'unauthorized' });
        }
        const { user_id, text, timeout_ms } = req.body || {};
        if (!text || !user_id) {
            metrics.inc('integrations_request_reply_invalid_params_total');
            return res.status(400).json({ status: 'failed', error: 'invalid_params' });
        }
        const timeoutMs = Number(timeout_ms);
        const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000;
        const idem = getIdempotencyKey(req);
        if (idem) metrics.inc('idempotency_used_total');
        const ttlSeconds = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 300);
        const ttlMs = (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : 300) * 1000;
        const scopeKey = idem ? `integrations:${integrationId}:request-reply:${idem}` : '';
        const startedAt = Date.now();
        const idemResult = await idempotency.run(scopeKey, ttlMs, async () => {
            const requestId = generateRequestId();
            try {
                const reply = await wsServer.requestReplyFromIntegration(String(user_id), requestId, String(text), waitMs, String(integrationId || ''));
                return { httpStatus: 200, body: { status: 'ok', integration: integrationId, request_id: requestId, reply } };
            } catch (e: any) {
                if (e?.message === 'timeout') {
                    return { httpStatus: 504, body: { status: 'failed', error: 'timeout', request_id: requestId } };
                }
                return { httpStatus: 503, body: { status: 'failed', error: e?.message || 'service_unavailable', request_id: requestId } };
            }
        });
        metrics.observe('request_reply_latency_ms', Date.now() - startedAt);
        if (idemResult.cache === 'hit') metrics.inc('idempotency_hit_total');
        if (idemResult.cache === 'inflight') metrics.inc('idempotency_inflight_total');
        const stored = idemResult.response;
        if (stored.httpStatus === 200) metrics.inc('integrations_request_reply_ok_total');
        else if (stored.httpStatus === 504) metrics.inc('integrations_request_reply_timeout_total');
        else metrics.inc('integrations_request_reply_failed_total');
        return res.status(stored.httpStatus).json(stored.body);
    });

    app.get('/api/metrics', (_req, res) => {
        const snap = metrics.snapshot();
        const sessions = wsServer.getSessionManager().getAllSessions();
        const onlineCount = sessions.filter((s) => s.online).length;
        const queuedCount = sessions.reduce((acc, s) => acc + s.queueSize, 0);
        const astrbot = wsServer.getAstrBotStatus();
        const astrbotStats = wsServer.getAstrBotStats();
        const sessionStats = wsServer.getSessionManager().getStats();

        snap.gauges.sessions_total = sessions.length;
        snap.gauges.sessions_online = onlineCount;
        snap.gauges.offline_queue_messages = queuedCount;
        snap.gauges.astrbot_connected = astrbot.connected ? 1 : 0;
        snap.counters.astrbot_disconnect_total = astrbotStats.disconnects_total;
        snap.counters.astrbot_reconnect_attempt_total = astrbotStats.reconnect_attempts_total;
        snap.counters.offline_drop_total = sessionStats.dropped_offline_messages;

        res.json({ status: 'ok', at: Date.now(), ...snap });
    });

    app.get('/metrics', (_req, res) => {
        const snap = metrics.snapshot();
        const lines: string[] = [];
        for (const [k, v] of Object.entries(snap.counters)) lines.push(`${k} ${v}`);
        for (const [k, v] of Object.entries(snap.gauges)) lines.push(`${k} ${v}`);
        for (const [k, h] of Object.entries(snap.histograms)) {
            lines.push(`${k}_count ${h.count}`);
            lines.push(`${k}_p50 ${h.p50}`);
            lines.push(`${k}_p95 ${h.p95}`);
            lines.push(`${k}_p99 ${h.p99}`);
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(lines.join('\n') + '\n');
    });

    app.get('/api/logs/recent', (req, res) => {
        const limitRaw = req.query.limit;
        const limit = typeof limitRaw === 'string' ? Number(limitRaw) : 200;
        res.json({
            status: 'ok',
            data: logHub.getRecent(Number.isFinite(limit) ? limit : 200)
        });
    });

    app.get('/api/audit/recent', (req, res) => {
        const limitRaw = req.query.limit;
        const limit = typeof limitRaw === 'string' ? Number(limitRaw) : 200;
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
        const actor = typeof req.query.actor === 'string' ? req.query.actor.trim() : '';
        let items = auditHub.getRecent(Number.isFinite(limit) ? limit : 200);
        if (action) items = items.filter((x) => x.action === action);
        if (actor) items = items.filter((x) => x.actor === actor);
        if (q) {
            const needle = q.toLowerCase();
            items = items.filter((x) =>
                (x.actor || '').toLowerCase().includes(needle) ||
                (x.role || '').toLowerCase().includes(needle) ||
                (x.action || '').toLowerCase().includes(needle) ||
                (x.target || '').toLowerCase().includes(needle) ||
                (x.detail || '').toLowerCase().includes(needle)
            );
        }
        res.json({ status: 'ok', data: items });
    });

    app.get('/api/logs/stream', (_req, res) => {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        (res as any).flushHeaders?.();

        const send = (data: unknown) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        const unsubscribe = logHub.subscribe((entry) => {
            send(entry);
        });

        const keepAlive = setInterval(() => {
            res.write(`: ping ${Date.now()}\n\n`);
        }, 20000);

        res.on('close', () => {
            clearInterval(keepAlive);
            unsubscribe();
        });
    });

    // GET /api/status - System Health
    app.get('/api/status', (_req, res) => {
        const sessions = wsServer.getSessionManager().getAllSessions();
        const onlineCount = sessions.filter(s => s.online).length;
        const queuedCount = sessions.reduce((acc, s) => acc + s.queueSize, 0);
        
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            online_users: onlineCount,
            total_sessions: sessions.length,
            queued_messages: queuedCount,
            astrbot_connected: wsServer.getAstrBotStatus().connected
        });
    });

    app.get('/api/metrics/health', (_req, res) => {
        const sessions = wsServer.getSessionManager().getAllSessions();
        const onlineCount = sessions.filter(s => s.online).length;
        const queuedCount = sessions.reduce((acc, s) => acc + s.queueSize, 0);
        const astrbotConnected = wsServer.getAstrBotStatus().connected;

        const baseScore = 100;
        const offline = Math.max(0, sessions.length - onlineCount);

        const deductAstrbot = astrbotConnected ? 0 : 70;
        const deductQueue = queuedCount > 0 ? Math.min(30, queuedCount) : 0;
        const deductOffline = offline > 0 ? Math.min(10, offline) : 0;
        const totalDeduct = deductAstrbot + deductQueue + deductOffline;

        const score = Math.max(0, Math.min(100, baseScore - totalDeduct));
        const reasons: string[] = [];
        if (deductAstrbot > 0) reasons.push('AstrBot 未连接（-70）');
        if (deductQueue > 0) reasons.push(`队列积压 ${queuedCount}（-${deductQueue}）`);
        if (deductOffline > 0) reasons.push(`离线会话 ${offline}（-${deductOffline}）`);

        const level = score >= 90 ? 'ok' : score >= 60 ? 'degraded' : 'down';

        res.json({
            status: 'ok',
            data: {
                score,
                level,
                reasons,
                model: {
                    base: baseScore,
                    formula: 'score = clamp(0, 100, base - deduct_astrbot - deduct_queue - deduct_offline)',
                    deductions: {
                        astrbot: {
                            value: deductAstrbot,
                            rule: 'AstrBot 未连接则扣 70 分，否则扣 0 分'
                        },
                        queue: {
                            value: deductQueue,
                            rule: '队列积压扣 min(30, queued_messages)'
                        },
                        offline_sessions: {
                            value: deductOffline,
                            rule: '离线会话扣 min(10, total_sessions - online_users)'
                        }
                    },
                    total_deduct: totalDeduct
                },
                signals: {
                    astrbot_connected: astrbotConnected,
                    online_users: onlineCount,
                    total_sessions: sessions.length,
                    queued_messages: queuedCount
                },
                thresholds: {
                    queued_warn: 20,
                    queued_bad: 50,
                    score_degraded: 60,
                    score_ok: 90
                }
            }
        });
    });

    app.get('/api/admin/config', (_req, res) => {
        res.json({
            status: 'ok',
            data: {
                ASTRBOT_URL: envConfig.ASTRBOT_URL,
                ASTRBOT_ID: envConfig.ASTRBOT_ID,
                WS_PATH: envConfig.WS_PATH,
                has_ASTRBOT_TOKEN: !!envConfig.ASTRBOT_TOKEN
            }
        });
    });

    app.post('/api/admin/config', (req, res) => {
        const admin = (req as any).admin as TokenPayload | undefined;
        if (admin && admin.role !== 'super_admin') {
            auditHub.add({ actor: admin.sub, role: admin.role, action: 'config_update', result: 'failed', ip: String(req.ip || ''), detail: 'forbidden' });
            return res.status(403).json({ status: 'failed', error: 'forbidden' });
        }
        const nextUrl = typeof req.body?.ASTRBOT_URL === 'string' ? req.body.ASTRBOT_URL.trim() : null;
        const nextId = typeof req.body?.ASTRBOT_ID === 'string' ? req.body.ASTRBOT_ID.trim() : null;
        const nextToken = typeof req.body?.ASTRBOT_TOKEN === 'string' ? req.body.ASTRBOT_TOKEN.trim() : null;

        if (!nextUrl && !nextId && !nextToken) {
            return res.status(400).json({ status: 'failed', error: 'invalid_params' });
        }
        if (nextUrl) envConfig.ASTRBOT_URL = nextUrl;
        if (nextId) envConfig.ASTRBOT_ID = nextId;
        if (nextToken != null) envConfig.ASTRBOT_TOKEN = nextToken;

        wsServer.reconnectAstrBot();
        if (admin) auditHub.add({ actor: admin.sub, role: admin.role, action: 'config_update', result: 'ok', ip: String(req.ip || '') });
        res.json({ status: 'ok' });
    });

    // GET /api/sessions - User List
    app.get('/api/sessions', (_req, res) => {
        const sessions = wsServer.getSessionManager().getAllSessions();
        res.json({
            status: 'ok',
            data: sessions
        });
    });

    app.post('/api/sessions/offline/clear', (req, res) => {
        const admin = (req as any).admin as TokenPayload | undefined;
        if (admin && admin.role !== 'super_admin') {
            auditHub.add({ actor: admin.sub, role: admin.role, action: 'clear_offline_sessions', result: 'failed', ip: String(req.ip || ''), detail: 'forbidden' });
            return res.status(403).json({ status: 'failed', error: 'forbidden' });
        }
        const sessions = wsServer.getSessionManager().getAllSessions();
        const offlineIds = sessions.filter((s) => !s.online).map((s) => String(s.userId));
        for (const id of offlineIds) {
            wsServer.getSessionManager().destroySession(id);
        }
        wsServer.getSessionManager().saveSessions();
        if (admin) auditHub.add({ actor: admin.sub, role: admin.role, action: 'clear_offline_sessions', result: 'ok', ip: String(req.ip || ''), detail: `count=${offlineIds.length}` });
        res.json({ status: 'ok', cleared: offlineIds.length });
    });

    // POST /api/sessions/:id/kick - Kick User
    app.post('/api/sessions/:id/kick', (req, res) => {
        const admin = (req as any).admin as TokenPayload | undefined;
        if (admin && admin.role !== 'super_admin') {
            auditHub.add({ actor: admin.sub, role: admin.role, action: 'kick', target: req.params.id, result: 'failed', ip: String(req.ip || ''), detail: 'forbidden' });
            return res.status(403).json({ status: 'failed', error: 'forbidden' });
        }
        const userId = req.params.id;
        console.log(`[Admin] Kicking user ${userId}...`);
        wsServer.getSessionManager().removeSession(userId);
        if (admin) auditHub.add({ actor: admin.sub, role: admin.role, action: 'kick', target: userId, result: 'ok', ip: String(req.ip || '') });
        res.json({ status: 'ok', message: `User ${userId} kicked` });
    });
    // ------------------------

    // 5. Start Server
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on http://0.0.0.0:${PORT}`);
        console.log(`WebSocket is accessible at ws://0.0.0.0:${PORT}`);
    });

    // Handle process termination to close server gracefully
    process.on('SIGINT', () => {
        console.log('Shutting down server...');
        // Save sessions before exit
        wsServer.getSessionManager().saveSessions();
        server.close(() => {
            process.exit(0);
        });
    });

} catch (error) {
    console.error('Failed to start server:', error);
}
