export interface ClientMetadata {
    user_id: string;
    session_id: string;
    request_id?: string;
}

export interface ClientPayload {
    text: string;
    metadata: ClientMetadata;
}

export interface ClientMessage {
    event: 'message_new';
    payload: ClientPayload;
}

export interface AstrBotMessage {
    // Placeholder for AstrBot message structure
    type: string;
    data: any;
}

export interface WebSocketConfig {
    port: number;
    path?: string;
}

export interface EnvConfig {
    PORT: number;
    ASTRBOT_URL: string;
    ASTRBOT_TOKEN: string;
    ASTRBOT_ID: string;
    WS_PATH: string;
}
