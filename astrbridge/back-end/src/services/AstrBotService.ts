import WebSocket from 'ws';
import { ClientMessage, AstrBotMessage } from '../types';
import { config } from '../config';
const { v4: uuidv4 } = require('uuid');

type MessageHandler = (message: AstrBotMessage) => void;

/**
 * AstrBotService (WebSocket Client Version)
 * Responsibilities:
 * - Connect to AstrBot (Provider) via WebSocket as a Client
 * - Maintain connection (Heartbeat/Reconnect)
 * - Forward messages from Web Client to AstrBot
 * - Receive messages from AstrBot and pass them to WebSocketServer
 */
export class AstrBotService {
    private ws: WebSocket | null = null;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private isConnected: boolean = false;
    private messageHandler: MessageHandler | null = null;
    private disconnectsTotal: number = 0;
    private reconnectAttemptsTotal: number = 0;

    constructor() {
        this.connect();
    }

    public getStatus(): { connected: boolean; readyState: number | null } {
        return { connected: this.isConnected, readyState: this.ws ? this.ws.readyState : null };
    }

    public getStats(): { disconnects_total: number; reconnect_attempts_total: number } {
        return { disconnects_total: this.disconnectsTotal, reconnect_attempts_total: this.reconnectAttemptsTotal };
    }

    public reconnect(): void {
        this.connect();
    }

    /**
     * Send API response (Echo) back to AstrBot
     * @param response Response payload
     */
    public async sendResponse(response: any): Promise<void> {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[AstrBotService] Cannot send response, connection closed');
            return;
        }

        console.log(`[AstrBotService] Sending API Response:`, JSON.stringify(response));
        
        return new Promise((resolve, reject) => {
            this.ws!.send(JSON.stringify(response), (error) => {
                if (error) {
                    console.error('[AstrBotService] Send response error:', error);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Register a callback to handle messages coming from AstrBot
     */
    public onMessage(handler: MessageHandler): void {
        this.messageHandler = handler;
    }

    /**
     * Establish WebSocket connection to AstrBot
     */
    private connect(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
        }

        const url = config.ASTRBOT_URL.replace(/^http/, 'ws'); // Ensure WS protocol
        console.log(`[AstrBotService] Connecting to AstrBot at ${url}...`);

        this.ws = new WebSocket(url, {
            headers: {
                'Authorization': `Bearer ${config.ASTRBOT_TOKEN}`,
                'X-Self-ID': config.ASTRBOT_ID,
                'X-Client-Role': 'Universal',
                'User-Agent': 'OneBot/11 (Adapter)'
            }
        });

        this.ws.on('open', () => {
            console.log('[AstrBotService] Connected to AstrBot');
            this.isConnected = true;
            this.startHeartbeat();
            if (this.reconnectInterval) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const messageString = data.toString();
                // Log raw message for debugging
                console.log(`[AstrBotService] Received RAW: ${messageString}`);
                
                const parsedMessage = JSON.parse(messageString) as AstrBotMessage;
                
                if (this.messageHandler) {
                    this.messageHandler(parsedMessage);
                }
            } catch (error) {
                console.error('[AstrBotService] Failed to parse message from AstrBot:', error);
            }
        });

        this.ws.on('close', (code, reason) => {
            console.warn(`[AstrBotService] Disconnected from AstrBot (Code: ${code}, Reason: ${reason})`);
            this.isConnected = false;
            this.disconnectsTotal += 1;
            this.stopHeartbeat();
            this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
            console.error(`[AstrBotService] WebSocket error: ${error.message}`);
            // Check for 4xx errors which might indicate handshake failure
            if (error.message.includes('Unexpected server response')) {
                 console.error('[AstrBotService] Handshake failed. Please check your Token, Bot ID, and configuration.');
            }
            this.stopHeartbeat();
            this.ws?.close();
        });
    }

    /**
     * Start heartbeat ping interval
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();
        // Send ping every 5 seconds to keep connection alive
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log('[AstrBotService] Sending heartbeat ping...');
                this.ws.ping();
            }
        }, 5000);
    }

    /**
     * Stop heartbeat interval
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect(): void {
        if (!this.reconnectInterval) {
            console.log('[AstrBotService] Scheduling reconnection in 5s...');
            this.reconnectInterval = setInterval(() => {
                this.reconnectAttemptsTotal += 1;
                console.log('[AstrBotService] Attempting to reconnect...');
                this.connect();
            }, 5000);
        }
    }

    /**
     * Send message to AstrBot using OneBot V11 Event format
     * @param message Message payload from client
     */
    public async sendMessage(message: ClientMessage): Promise<void> {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('service_unavailable');
        }

        const userId = parseInt(message.payload.metadata.user_id, 10);
        if (!Number.isFinite(userId)) {
            throw new Error('invalid_user_id');
        }

        // Wrap message in OneBot V11 Event format (post_type: message)
        // This simulates a user sending a message to the bot
        const eventPayload = {
            post_type: 'message',
            message_type: 'private',
            time: Math.floor(Date.now() / 1000),
            self_id: parseInt(config.ASTRBOT_ID),
            sub_type: 'friend',
            user_id: userId,
            message: [
                {
                    type: "text",
                    data: {
                        text: message.payload.text
                    }
                }
            ],
            raw_message: message.payload.text,
            font: 0,
            sender: {
                user_id: userId,
                nickname: `User ${userId}`,
                sex: 'unknown',
                age: 0
            },
            message_id: Math.floor(Math.random() * 1000000) // Mock message ID
        };

        console.log(`[AstrBotService] Sending Event to AstrBot:`, JSON.stringify(eventPayload));

        return new Promise((resolve, reject) => {
            this.ws!.send(JSON.stringify(eventPayload), (error) => {
                if (error) {
                    console.error('[AstrBotService] Send error:', error);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
}
