export interface AdapterClientOptions {
  url?: string;
  userId?: string;
  sessionId?: string;
  heartbeatMs?: number;
  reconnect?: boolean;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export interface SendOverrides {
  userId?: string;
  sessionId?: string;
}

export declare class AdapterClient {
  constructor(options?: AdapterClientOptions);
  isConnected(): boolean;
  connect(): Promise<void>;
  close(): void;
  sendText(text: string, overrides?: SendOverrides): void;
  onOpen(cb: () => void): () => void;
  onClose(cb: () => void): () => void;
  onError(cb: (err: unknown) => void): () => void;
  onRaw(cb: (data: unknown) => void): () => void;
  onReply(cb: (text: string, raw: any) => void): () => void;
  onEvent(event: string, cb: (raw: any) => void): () => void;
}
