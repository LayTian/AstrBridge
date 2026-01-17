# 排查与修复：WebSocket 连接不稳定 (Code 1006)

**问题分析**：
日志显示 `[AstrBotService] Disconnected from AstrBot (Code: 1006)` 循环出现。Code 1006 表示异常断开，最常见的原因是**连接空闲超时**。
AstrBot 服务端（或中间的网络设备/Nginx）很可能设置了空闲超时检测。由于当前的 `AstrBotService` 在连接建立后如果没有用户消息转发，就完全不发送任何数据，导致被服务端判定为“死连接”并强制断开。

**修复方案**：
我们需要在 `AstrBotService` 中实现**主动心跳保活机制**。

## 1. 实现心跳逻辑
在 `src/services/AstrBotService.ts` 中进行以下修改：

1.  **增加心跳定时器**：在 `ws.on('open')` 时，启动一个定时器（建议 30秒一次）。
2.  **发送 Ping 帧**：定时调用 `ws.ping()`。这是 WebSocket 协议层最标准的保活方式，不会干扰业务层的 JSON 消息处理。
3.  **清理资源**：在 `ws.on('close')` 和 `ws.on('error')` 时，务必清除该心跳定时器，防止内存泄漏或对已关闭的连接操作。

## 2. 代码变更预览

```typescript
// src/services/AstrBotService.ts

export class AstrBotService {
    private heartbeatInterval: NodeJS.Timeout | null = null; // 新增

    private connect(): void {
        // ...
        this.ws.on('open', () => {
            console.log('[AstrBotService] Connected to AstrBot');
            this.isConnected = true;
            this.startHeartbeat(); // 启动心跳
            // ...
        });

        this.ws.on('close', () => {
            this.stopHeartbeat(); // 停止心跳
            // ...
        });
        
        this.ws.on('error', () => {
            this.stopHeartbeat(); // 停止心跳
            // ...
        });
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        // 每 30 秒发送一次 Ping
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                console.log('[AstrBotService] Sending heartbeat ping...'); // Debug日志
                this.ws.ping();
            }
        }, 30000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}
```

## 3. 验证计划
修改完成后，重启服务并观察控制台日志。如果看到周期性的 `Sending heartbeat ping...` 且不再出现频繁的 `Disconnected (Code: 1006)`，即表示问题解决。
