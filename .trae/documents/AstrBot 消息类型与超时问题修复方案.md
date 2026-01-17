# AstrBot 日志错误分析与修复计划

**日志分析**:
1.  **`aiocqhttp: 无法识别的消息类型: 111`**:
    *   **原因**: AstrBot 使用 `aiocqhttp` 库，该库在接收到 `post_type: message` 的事件时，**默认期望 `message` 字段是 Array 格式（消息段数组）**，或者至少是符合 CQ 码规范的字符串。
    *   **现状**: 我们的 Adapter 发送的是纯字符串（例如 "111" 或 "能看到我吗"）。虽然 OneBot V11 允许字符串格式，但 AstrBot 似乎配置为（或硬编码为）优先解析 Array 格式，或者将收到的内容误判为无法识别的对象。
    *   **关键提示**: 日志中明确建议 *“将 message.post-format 更改为 array”*，这暗示了 AstrBot 期望数组格式，或者我们的数据结构触发了它的类型检查失败。

2.  **`回复消息失败: WebSocket API call timeout`**:
    *   **原因**: AstrBot 收到消息后尝试调用 API 回复（例如 `send_private_msg`），但因为我们的 Adapter 没有正确处理 API 响应的回执（Response Echo），或者之前的 API 调用根本没有被正确路由。
    *   **现状**: 我们实现了 `sendMessage` 但没有实现通用的 API 处理逻辑，也没有对 AstrBot 的 API 调用返回 `status: ok` 的回执。虽然 OneBot V11 对于 WebSocket API 调用通常不需要显式回执，但如果 AstrBot 期待一个 JSON 响应来确认“调用已发送”，我们未回复可能导致它等待超时。

**修复计划**:

我们将分两步解决这两个问题。

## Step 1: 解决“无法识别的消息类型” (Message Format)
将发送给 AstrBot 的消息从 **纯字符串** 改为 **OneBot 消息段数组 (Array Message Segments)**。这是最兼容的做法。

*   **文件**: `src/services/AstrBotService.ts`
*   **修改**:
    ```typescript
    // 旧代码
    message: message.payload.text,
    
    // 新代码
    message: [
        {
            type: "text",
            data: {
                text: message.payload.text
            }
        }
    ]
    ```

## Step 2: 解决“API call timeout” (API Echo)
AstrBot 作为客户端调用 Adapter 的 API（如回复消息时），它期望 Adapter 返回一个 API 响应结果。

*   **文件**: `src/server/WebSocketServer.ts`
*   **修改**: 在处理 `handleAstrBotMessage` 中的 API 调用（`send_private_msg` 等）后，**必须**向 AstrBot 发送一个 API 响应包。
    ```typescript
    // 构造响应包
    const apiResponse = {
        status: 'ok',
        retcode: 0,
        data: {
            message_id: Math.floor(Math.random() * 1000000) // 模拟一个消息ID
        },
        echo: message.echo // 关键：必须带上请求中的 echo
    };
    
    // 通过 AstrBotService 发回给 AstrBot
    this.astrBotService.sendResponse(apiResponse);
    ```

为此，我们需要在 `AstrBotService` 中新增一个 `sendResponse` 方法，专门用于回传 API 结果。

**总结**:
1.  **AstrBotService.ts**: `sendMessage` 改用 Array 格式；新增 `sendResponse` 方法。
2.  **WebSocketServer.ts**: 处理完 API 调用后，调用 `sendResponse` 返回成功回执。

**请确认是否执行此修复计划？**
