# AstrBot WebSocket API Timeout 故障分析与修复计划

**故障现象**：
AstrBot 日志显示 `WebSocket API call timeout`，导致回复消息失败。
这表明 AstrBot (使用 `aiocqhttp`) 向 Adapter 发送了 API 请求（如 `send_private_msg`），但在超时时间内（默认 60s）没有收到 Adapter 返回的 API 响应结果。

**根本原因**：
根据代码分析，当前的 `WebSocketServer.ts` 在处理 API 请求时存在逻辑漏洞：
*   **成功场景**：如果用户在线（Session 存在），Adapter 会转发消息并返回 `status: ok` 的响应。
*   **失败场景**（故障点）：如果用户不在线（Session 不存在或已断开），Adapter 仅仅打印了一条 `console.warn`，然后直接 `return`，**没有向 AstrBot 发送任何响应**。
*   **后果**：AstrBot 的 API 客户端会一直等待回包，直到触发 TimeoutError。

**修复方案**：
无论消息是否成功发送给前端用户，Adapter **必须**始终向 AstrBot 返回 API 响应。

1.  **用户在线时**：返回 `retcode: 0` (成功)。
2.  **用户离线时**：返回 `retcode: -1` (失败)，并附带错误信息。这样 AstrBot 会立即收到失败通知，而不是傻等直到超时。

## 代码修改计划

**文件**: `src/server/WebSocketServer.ts`

**修改逻辑**：

```typescript
// src/server/WebSocketServer.ts

// ... 在 handleAstrBotMessage 中

const ws = this.sessionManager.getSession(String(userId));

if (ws && ws.readyState === WebSocket.OPEN) {
    // ... 发送给前端 ...
    
    // 返回成功响应
    if (message.echo) {
        this.astrBotService.sendResponse({
            status: 'ok',
            retcode: 0,
            data: { message_id: ... },
            echo: message.echo
        });
    }
} else {
    // [新增] 用户离线时的处理逻辑
    console.warn(`User ${userId} not connected...`);
    
    // 必须返回失败响应，防止 AstrBot 超时
    if (message.echo) {
        this.astrBotService.sendResponse({
            status: 'failed',
            retcode: -1, // 非0表示失败
            data: null,
            msg: `User ${userId} not connected`,
            wording: `User ${userId} not connected`,
            echo: message.echo
        });
    }
}
```

**预期效果**：
修复后，即使前端网页关闭了，AstrBot 也不会报错 "Timeout"，而是会收到一个明确的 "调用失败" 响应，从而避免阻塞后续流程。

**请确认是否执行此修复？**
