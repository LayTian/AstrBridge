import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { IncomingMessage } from 'http';
import { ClientMessage, WebSocketConfig, AstrBotMessage } from '../types';
import { SessionManager } from '../session/SessionManager';
import { AstrBotService } from '../services/AstrBotService';
import { ReplyWaiterHub } from './ReplyWaiterHub';

export class WebSocketServer {
    private wss: WSServer;
    private config: WebSocketConfig;
    private sessionManager: SessionManager;
    private astrBotService: AstrBotService;
    private replyWaiters: ReplyWaiterHub;

    constructor(config: WebSocketConfig, server?: any) {
        this.config = config;
        this.sessionManager = new SessionManager();
        this.astrBotService = new AstrBotService();
        this.replyWaiters = new ReplyWaiterHub();
        
        if (server) {
            console.log('Attaching WebSocket server to existing HTTP server...');
            this.wss = new WSServer({ server });
        } else {
            this.wss = new WSServer({ port: config.port, path: config.path });
        }

        this.init();
    }

    public getSessionManager(): SessionManager {
        return this.sessionManager;
    }

    public getAstrBotStatus(): { connected: boolean; readyState: number | null } {
        return this.astrBotService.getStatus();
    }

    public getAstrBotStats(): { disconnects_total: number; reconnect_attempts_total: number } {
        return this.astrBotService.getStats();
    }

    public reconnectAstrBot(): void {
        this.astrBotService.reconnect();
    }

    public async sendFromIntegration(userId: string, text: string, integrationId?: string): Promise<void> {
        const sessionId = integrationId ? `integration:${integrationId}` : 'integration';
        this.sessionManager.recordInboundMessage(String(userId), String(text || ''), sessionId);
        const message: ClientMessage = {
            event: 'message_new',
            payload: {
                text,
                metadata: {
                    user_id: String(userId),
                    session_id: sessionId
                }
            }
        };
        await this.astrBotService.sendMessage(message);
    }

    public async requestReplyFromIntegration(userId: string, requestId: string, text: string, timeoutMs: number, integrationId?: string): Promise<any> {
        const id = String(userId);
        const rid = String(requestId);
        const waitPromise = this.replyWaiters.register(id, rid, timeoutMs);
        try {
            await this.sendFromIntegration(id, text, integrationId);
        } catch (e: any) {
            this.replyWaiters.rejectByRequestId(rid, e instanceof Error ? e : new Error(String(e?.message || e || 'service_unavailable')));
            throw e;
        }
        return await waitPromise;
    }

    private init(): void {
        console.log(`WebSocket server starting on port ${this.config.port}...`);

        // Register AstrBot message handler
        this.astrBotService.onMessage((message) => {
            this.handleAstrBotMessage(message);
        });

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            const ip = req.socket.remoteAddress;
            console.log(`New client connected from ${ip}`);

            // Parse URL parameters to identify user (e.g., ws://localhost:8080?user_id=10001)
            let userId: string | null = null;
            if (req.url) {
                try {
                    const url = new URL(req.url, `http://${req.headers.host}`);
                    userId = url.searchParams.get('user_id');
                    
                    if (userId) {
                        console.log(`[WebSocketServer] Identified user ${userId} from URL params`);
                        (ws as any).__userId = userId;
                        this.sessionManager.registerSession(userId, ws);
                        
                        // Check for pending messages immediately upon connection
                        const pendingMessages = this.sessionManager.flushQueue(userId);
                        if (pendingMessages.length > 0) {
                            console.log(`[WebSocketServer] Sending ${pendingMessages.length} pending messages to user ${userId}`);
                            pendingMessages.forEach(msg => {
                                ws.send(JSON.stringify(msg));
                            });
                        }
                    }
                } catch (e) {
                    console.error('Error parsing WebSocket URL:', e);
                }
            }

            ws.on('message', (message: WebSocket.RawData) => {
                this.handleMessage(ws, message);
            });

            ws.on('close', () => {
                console.log(`Client disconnected: ${ip}`);
                // Don't remove session completely, just mark as offline (handled by registerSession logic update)
                this.sessionManager.removeSession(ws);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error: ${error.message}`);
                this.sessionManager.removeSession(ws);
            });
        });

        this.wss.on('listening', () => {
            console.log(`WebSocket server is listening on port ${this.config.port}`);
        });
    }

    private handleMessage(ws: WebSocket, message: WebSocket.RawData): void {
        try {
            const messageString = message.toString();

            // Heartbeat: PING -> PONG
            if (messageString === 'PING') {
                ws.send('PONG');
                return;
            }

            // Parse JSON
            let parsedMessage: ClientMessage;
            try {
                parsedMessage = JSON.parse(messageString);
            } catch (e) {
                console.error('Invalid JSON received');
                ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
                return;
            }

            // Validate structure (basic check)
            if (!parsedMessage.event || !parsedMessage.payload) {
                console.warn('Received message missing event or payload');
                return;
            }

            switch (parsedMessage.event) {
                case 'message_new':
                    this.processUserMessage(ws, parsedMessage);
                    break;
                default:
                    console.warn(`Unknown event type: ${(parsedMessage as any).event}`);
            }

        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    private async processUserMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
        const { payload } = message;
        const userId = payload.metadata?.user_id || (ws as any).__userId;
        if (!userId) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ event: 'error', error: 'Missing user_id' }));
            }
            return;
        }
        if (!payload.metadata) {
            (payload as any).metadata = { user_id: String(userId), session_id: 'web' };
        } else {
            payload.metadata.user_id = String(userId);
            payload.metadata.session_id = payload.metadata.session_id || 'web';
        }
        
        // Register/Update session
        this.sessionManager.registerSession(userId, ws);

        // Check for pending messages (Offline Queue)
        const pendingMessages = this.sessionManager.flushQueue(userId);
        if (pendingMessages.length > 0) {
            console.log(`[WebSocketServer] Sending ${pendingMessages.length} pending messages to user ${userId}`);
            pendingMessages.forEach(msg => {
                ws.send(JSON.stringify(msg));
            });
        }

        console.log(`Received message from user ${userId}: ${payload.text}`);
        this.sessionManager.recordInboundMessage(String(userId), String(payload.text || ''), String(payload.metadata?.session_id || ''));

        try {
            // Forward to AstrBot (Provider)
            await this.astrBotService.sendMessage(message);
        } catch (error: any) {
            console.error('Failed to forward message to AstrBot:', error);
            
            // Send error feedback to client
            if (ws.readyState === WebSocket.OPEN) {
                const errorMessage = error.message === 'service_unavailable' 
                    ? { event: 'service_unavailable', error: 'AstrBot is offline' }
                    : error.message === 'invalid_user_id'
                        ? { event: 'error', error: 'Invalid user_id' }
                        : { event: 'error', error: 'Failed to process message' };
                
                ws.send(JSON.stringify(errorMessage));
            }
        }
    }

    /**
     * Reserved method for handling messages coming FROM AstrBot (Backend)
     * This will be used to push responses back to the Web Client.
     * @param message The message received from AstrBot
     */
    public handleAstrBotMessage(message: any): void {
        console.log('Received message from AstrBot:', message);
        
        // Handle API calls from AstrBot (e.g. send_msg, send_private_msg)
        if (message.action === 'send_private_msg' || message.action === 'send_msg') {
            try {
                const params = message.params || {};
                const userId = params.user_id;
                let replyText = '';

                // Extract text from message segments if it's an array
                if (Array.isArray(params.message)) {
                    replyText = params.message
                        .filter((seg: any) => seg.type === 'text' || seg.type === 'Plain')
                        .map((seg: any) => seg.data?.text || '')
                        .join('');
                } else if (typeof params.message === 'string') {
                    replyText = params.message;
                } else if (params.message && typeof params.message === 'object') {
                     // Handle single object segment case
                     if (params.message.type === 'text' || params.message.type === 'Plain') {
                         replyText = params.message.data?.text || '';
                     }
                }

                if (!userId) {
                    console.warn('Received AstrBot API call without user_id, cannot route to client.');
                    // Must still respond to echo even if we can't process it
                    if (message.echo) {
                        this.astrBotService.sendResponse({
                            status: 'failed',
                            retcode: 100, // Invalid params
                            data: null,
                            msg: 'Missing user_id param',
                            echo: message.echo
                        });
                    }
                    return;
                }

                const ws = this.sessionManager.getSocket(String(userId));
                let delivered = false;

                const clientPayload = {
                    event: 'message_reply',
                    payload: {
                        text: replyText,
                        metadata: {
                            user_id: String(userId),
                            session_id: 'astrbot-reply'
                        }
                    }
                };

                if (ws && ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify(clientPayload));
                     console.log(`Forwarded AstrBot reply to user ${userId}`);
                     delivered = true;
                } else {
                    // User offline: Enqueue message
                    console.warn(`User ${userId} not connected. Enqueuing message...`);
                    this.sessionManager.enqueueMessage(String(userId), clientPayload);
                    delivered = true; 
                }

                this.replyWaiters.deliver(String(userId), clientPayload);

                // Send API response (Echo) back to AstrBot
                // Always return success to prevent AstrBot from reporting API errors,
                // even if the user is offline (which is a downstream state, not an API failure).
                if (message.echo) {
                    this.astrBotService.sendResponse({
                        status: 'ok',
                        retcode: 0,
                        data: {
                            message_id: Math.floor(Math.random() * 1000000),
                            delivered: delivered
                        },
                        echo: message.echo
                    });
                }
            } catch (error: any) {
                console.error('Error processing AstrBot message:', error);
                if (message.echo) {
                    this.astrBotService.sendResponse({
                        status: 'failed',
                        retcode: -1,
                        data: null,
                        msg: `Adapter error: ${error.message}`,
                        wording: `Adapter error: ${error.message}`,
                        echo: message.echo
                    });
                }
            }
            return;
        }
        
        // Fallback for other message types (if any)
        // ...
    }
}
