## 现状定位
- user_id 并不是完全写死：浏览器侧（test.html/SDK）会把 user_id 通过 WS URL 参数与消息 payload.metadata.user_id 传给后端。[test.html](file:///e:/adpater/test/test.html#L54-L112) / [WebSocketServer.ts](file:///e:/adpater/src/server/WebSocketServer.ts#L44-L67)
- 真正“看起来写死”的点在后端转发到 AstrBot 时：如果解析不到数字，会 fallback 到 `10001`。[AstrBotService.sendMessage](file:///e:/adpater/src/services/AstrBotService.ts#L164-L197)

## 目标
- 让 userId “动起来”：不同浏览器/不同网站无需手填固定 10001，也能生成稳定且不冲突的 user_id。
- 保持兼容：仍支持手动指定 user_id（比如你要用 10001 做固定测试）。

## 方案（浏览器直连优先）
### 1) 前端 SDK 自动生成稳定 userId（推荐）
- 在浏览器 SDK 中：当调用方不传 `userId` 时，自动生成并持久化到 `localStorage`（同一网站/同一浏览器保持不变）。
- 生成策略：优先生成“数字字符串”（比如 9~10 位），确保 AstrBot/OneBot `user_id` 能按数值处理。
- 同时生成 `sessionId`（每个 tab 一份）用于区分会话来源。

### 2) 后端移除 `|| 10001` 回退，改为严格校验
- 修改 [AstrBotService.ts](file:///e:/adpater/src/services/AstrBotService.ts)：
  - 如果 `metadata.user_id` 缺失或不是数字：直接返回可读错误（不再偷偷变成 10001）。
- 修改 [WebSocketServer.ts](file:///e:/adpater/src/server/WebSocketServer.ts)：
  - 在收到客户端消息时，若 payload.metadata.user_id 缺失：尝试使用连接时 URL 里的 `user_id` 作为兜底；再不行就回 `event:error`。

### 3) Demo / 文档补齐
- 更新 [test.html](file:///e:/adpater/test/test.html) ：默认自动填充随机 user_id，并提供“重置 userId”按钮。
- 增加一份最短接入文档：告诉其他网站只需引入 SDK 并调用 `sendText()`。

## 验证方式
- 同一台电脑开两个浏览器/无痕窗口：应自动得到不同 user_id，互不串消息。
- 不传 user_id 时：SDK 自动生成；后端不再出现 10001。
- 传非法 user_id（非数字）时：后端返回明确错误而不是默默 fallback。

如果你确认这个方案，我会按上述顺序提交改动并跑 `npm run build`（后端）与一个浏览器 demo 的联调验收。