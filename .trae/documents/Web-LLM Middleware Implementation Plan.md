# 实施计划：Web-LLM 中间件平台 (Revised)

收到反馈。你是对的，**“离线队列”是 Day 1 的核心**，我必须明确它的实现细节和存储方案。

针对你提出的“离线数据怎么存储”的问题，为了在不引入 Redis 等重型依赖（增加部署难度）的前提下保证数据不丢，我将在 Day 1 增加 **“文件持久化 (File Persistence)”** 机制。

## 阶段一：核心韧性与离线队列 (Day 1 重点)
目标：实现完整的会话管理、离线消息队列，并保证**服务重启不丢消息**。

1.  **SessionManager 重构 (核心)**
    *   **数据结构**：修复 `UserSession` 接口，包含 `queue` (消息队列) 和 `lastActive`。
    *   **逻辑实现**：
        *   `enqueueMessage()`: 用户离线时，消息推入内存队列。
        *   `flushQueue()`: 用户上线时，自动推送积压消息。
    *   **存储方案 (新增)**：
        *   实现 `saveSessions()`: 在服务关闭 (SIGINT) 时，将所有未发送的队列序列化写入 `data/sessions.json`。
        *   实现 `loadSessions()`: 在服务启动时，读取本地文件恢复队列。
        *   *设计理由：轻量级、零依赖，符合毕设“易部署”的要求，同时具备容灾能力。*

2.  **后端 API 落地**
    *   修改 `WebSocketServer`，公开 `getSessionManager()`。
    *   修改 `index.ts`，挂载 Express 路由 `GET /api/status` 和 `GET /api/sessions`。
    *   修复之前的语法错误 (TS1068)。

3.  **验证后端**
    *   `npx tsc` 编译。
    *   测试：发送消息 -> 停止服务 -> 重启服务 -> 连接 -> 收到消息。

## 阶段二：可视化后台搭建 (Day 2)
目标：搭建 Vue 3 前端，接通数据。

1.  **前端初始化**：安装 `element-plus`, `axios`, `echarts`。
2.  **环境配置**：配置 Vite Proxy 解决跨域。
3.  **Dashboard 开发**：展示“当前积压消息数”和“在线用户列表”。

请确认此方案（特别是文件持久化存储策略），确认后我即刻开始编码。