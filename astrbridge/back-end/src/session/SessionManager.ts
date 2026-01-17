import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

export interface UserSession {
    ws?: WebSocket;
    queue: any[];
    lastActive: number;
    userId: string;
    lastMessageText?: string;
    lastMessageAt?: number;
    lastSessionId?: string;
}

/**
 * SessionManager
 * Responsibilities:
 * - Maintain mapping between UserID and UserSession (Context)
 * - Handle connection storage and retrieval
 * - Manage offline message queue
 * - Persist sessions to file
 */
export class SessionManager {
    // Map UserID -> UserSession
    private sessions: Map<string, UserSession>;
    // Map WebSocket -> UserID (for quick reverse lookup on disconnect)
    private socketToUser: Map<WebSocket, string>;
    private readonly DATA_FILE = path.join(process.cwd(), 'data', 'sessions.json');
    private readonly MAX_QUEUE_PER_USER = Math.max(1, Number(process.env.SESSION_MAX_QUEUE_PER_USER || 200));
    private readonly MAX_SESSIONS = Math.max(1, Number(process.env.SESSION_MAX_SESSIONS || 5000));
    private readonly OFFLINE_TTL_MS = Math.max(60_000, Number(process.env.SESSION_OFFLINE_TTL_SECONDS || 604800) * 1000);
    private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
    private droppedOfflineMessages = 0;

    constructor() {
        this.sessions = new Map();
        this.socketToUser = new Map();
        this.loadSessions();
        this.startMaintenance();
    }

    /**
     * Register a new session or update an existing one
     * @param userId Unique identifier for the user
     * @param ws WebSocket connection instance
     */
    public registerSession(userId: string, ws: WebSocket): void {
        let session = this.sessions.get(userId);
        
        if (!session) {
            this.ensureCapacity();
            // New user session
            session = {
                userId,
                queue: [],
                lastActive: Date.now()
            };
            console.log(`[SessionManager] Created new session context for user: ${userId}`);
        } else {
             console.log(`[SessionManager] Updating session for user: ${userId}`);
             // If there was an old socket, clean up the reverse map
             if (session.ws && session.ws !== ws) {
                 this.socketToUser.delete(session.ws);
             }
        }

        // Update session with new connection
        session.ws = ws;
        session.lastActive = Date.now();
        
        this.sessions.set(userId, session);
        this.socketToUser.set(ws, userId);
    }

    public recordInboundMessage(userId: string, text: string, sessionId: string): void {
        let session = this.sessions.get(userId);
        if (!session) {
            this.ensureCapacity();
            session = {
                userId,
                queue: [],
                lastActive: Date.now()
            };
            this.sessions.set(userId, session);
        }
        session.lastMessageText = String(text || '').slice(0, 200);
        session.lastMessageAt = Date.now();
        session.lastSessionId = String(sessionId || '');
        session.lastActive = Date.now();
    }

    /**
     * Retrieve a session by UserID
     * @param userId Unique identifier for the user
     */
    public getSession(userId: string): UserSession | undefined {
        return this.sessions.get(userId);
    }

    /**
     * Get WebSocket connection for a user
     */
    public getSocket(userId: string): WebSocket | undefined {
        return this.sessions.get(userId)?.ws;
    }

    /**
     * Mark a session as disconnected (but keep context/queue)
     * Supports manual kick via userId
     */
    public removeSession(wsOrUserId: WebSocket | string): void {
        let userId: string | undefined;

        if (typeof wsOrUserId === 'string') {
            userId = wsOrUserId;
            const session = this.sessions.get(userId);
            if (session?.ws) {
                // Close connection if it's still open
                try {
                    session.ws.close(4000, 'Kicked by admin');
                } catch (e) { /* ignore */ }
                this.socketToUser.delete(session.ws);
            }
        } else {
            userId = this.socketToUser.get(wsOrUserId);
            this.socketToUser.delete(wsOrUserId);
        }

        if (userId) {
            const session = this.sessions.get(userId);
            if (session) {
                console.log(`[SessionManager] User ${userId} disconnected/removed`);
                session.ws = undefined; // Mark as offline
                session.lastActive = Date.now();
            }
        }
    }

    /**
     * Kick a user offline
     */
    public closeSession(userId: string): void {
        this.removeSession(userId);
    }

    /**
     * Add a message to the user's offline queue
     */
    public enqueueMessage(userId: string, message: any): void {
        let session = this.sessions.get(userId);
        if (!session) {
            this.ensureCapacity();
            // Create a "ghost" session for unknown user
            session = {
                userId,
                queue: [],
                lastActive: Date.now()
            };
            this.sessions.set(userId, session);
        }
        
        session.queue.push(message);
        if (session.queue.length > this.MAX_QUEUE_PER_USER) {
            const overflow = session.queue.length - this.MAX_QUEUE_PER_USER;
            session.queue.splice(0, overflow);
            this.droppedOfflineMessages += overflow;
        }
        console.log(`[SessionManager] Queued message for user ${userId}. Queue size: ${session.queue.length}`);
    }

    /**
     * Retrieve and clear pending messages for a user
     */
    public flushQueue(userId: string): any[] {
        const session = this.sessions.get(userId);
        if (session && session.queue.length > 0) {
            const pending = [...session.queue];
            session.queue = [];
            console.log(`[SessionManager] Flushed ${pending.length} messages for user ${userId}`);
            return pending;
        }
        return [];
    }

    /**
     * Get all session data (for Admin Dashboard)
     */
    public getAllSessions(): any[] {
        const list: any[] = [];
        this.sessions.forEach((session, userId) => {
            list.push({
                userId,
                online: !!session.ws, // true if connected
                queueSize: session.queue.length,
                lastActive: session.lastActive,
                lastActiveTime: new Date(session.lastActive).toLocaleString(),
                lastMessageText: session.lastMessageText || '',
                lastMessageAt: session.lastMessageAt || 0,
                lastMessageTime: session.lastMessageAt ? new Date(session.lastMessageAt).toLocaleString() : '',
                lastSessionId: session.lastSessionId || ''
            });
        });
        return list;
    }

    /**
     * Save sessions to JSON file
     */
    public saveSessions(): void {
        try {
            const dataDir = path.dirname(this.DATA_FILE);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const serialized: any[] = [];
            this.sessions.forEach((session) => {
                // Only save sessions that have data worth saving (e.g. queue not empty or recently active)
                if (session.queue.length > 0 || (Date.now() - session.lastActive < 24 * 60 * 60 * 1000)) {
                     serialized.push({
                         userId: session.userId,
                         queue: session.queue,
                         lastActive: session.lastActive,
                         lastMessageText: session.lastMessageText || '',
                         lastMessageAt: session.lastMessageAt || 0,
                         lastSessionId: session.lastSessionId || ''
                     });
                }
            });

            const payload = {
                schema_version: 1,
                saved_at: Date.now(),
                sessions: serialized
            };
            const tempFile = this.DATA_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2));
            try {
                if (fs.existsSync(this.DATA_FILE)) fs.unlinkSync(this.DATA_FILE);
            } catch {}
            fs.renameSync(tempFile, this.DATA_FILE);
            console.log(`[SessionManager] Saved ${serialized.length} sessions to ${this.DATA_FILE} (dropped_offline_messages=${this.droppedOfflineMessages})`);
        } catch (error) {
            console.error('[SessionManager] Failed to save sessions:', error);
        }
    }

    /**
     * Load sessions from JSON file
     */
    private loadSessions(): void {
        try {
            if (fs.existsSync(this.DATA_FILE)) {
                const data = fs.readFileSync(this.DATA_FILE, 'utf-8');
                let parsed: any;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    const badName = this.DATA_FILE.replace(/\.json$/i, '') + `.bad.${Date.now()}.json`;
                    try { fs.renameSync(this.DATA_FILE, badName); } catch {}
                    console.error('[SessionManager] sessions.json invalid, moved aside:', badName);
                    return;
                }

                const sessions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessions) ? parsed.sessions : [];

                sessions.forEach((s: any) => {
                    if (!s || typeof s.userId !== 'string') return;
                    this.sessions.set(s.userId, {
                        userId: s.userId,
                        queue: Array.isArray(s.queue) ? s.queue : [],
                        lastActive: Number.isFinite(Number(s.lastActive)) ? Number(s.lastActive) : Date.now(),
                        ws: undefined, // WebSocket cannot be persisted
                        lastMessageText: typeof s.lastMessageText === 'string' ? s.lastMessageText : '',
                        lastMessageAt: Number.isFinite(Number(s.lastMessageAt)) ? Number(s.lastMessageAt) : 0,
                        lastSessionId: typeof s.lastSessionId === 'string' ? s.lastSessionId : ''
                    });
                });
                console.log(`[SessionManager] Loaded ${sessions.length} sessions from disk`);
            }
        } catch (error) {
            console.error('[SessionManager] Failed to load sessions:', error);
        }
    }

    /**
     * Remove a session completely (e.g. timeout or manual cleanup)
     */
    public destroySession(userId: string): void {
        const session = this.sessions.get(userId);
        if (session) {
            if (session.ws) {
                this.socketToUser.delete(session.ws);
            }
            this.sessions.delete(userId);
            console.log(`[SessionManager] Destroyed session for user: ${userId}`);
        }
    }

    /**
     * Get count of active sessions
     */
    public getActiveSessionCount(): number {
        return this.sessions.size;
    }

    public getStats(): { dropped_offline_messages: number } {
        return { dropped_offline_messages: this.droppedOfflineMessages };
    }

    private startMaintenance(): void {
        if (this.maintenanceTimer) return;
        this.maintenanceTimer = setInterval(() => {
            this.cleanupExpired();
            this.saveSessions();
        }, 120_000);
    }

    private cleanupExpired(): void {
        const now = Date.now();
        for (const [userId, session] of this.sessions.entries()) {
            const offline = !session.ws;
            const idle = now - session.lastActive;
            if (offline && session.queue.length === 0 && idle > this.OFFLINE_TTL_MS) {
                this.sessions.delete(userId);
            }
        }
    }

    private ensureCapacity(): void {
        if (this.sessions.size < this.MAX_SESSIONS) return;
        const candidates: { userId: string; lastActive: number; queueSize: number; online: boolean }[] = [];
        for (const [userId, session] of this.sessions.entries()) {
            candidates.push({ userId, lastActive: session.lastActive, queueSize: session.queue.length, online: !!session.ws });
        }
        candidates.sort((a, b) => {
            if (a.online !== b.online) return a.online ? 1 : -1;
            if (a.queueSize !== b.queueSize) return a.queueSize - b.queueSize;
            return a.lastActive - b.lastActive;
        });
        while (this.sessions.size >= this.MAX_SESSIONS && candidates.length > 0) {
            const victim = candidates.shift()!;
            this.destroySession(victim.userId);
        }
    }
}
