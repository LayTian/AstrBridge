## 目标
把当前只有「仪表盘 / 会话管理 / 实时日志」的后台扩展成“运维 + 接入 + 测试”一体的轻量控制台；新增的菜单项必须要么真实可用，要么干脆不出现。

## 现状（已具备的后端能力）
- 运行状态：`GET /api/status`
- 会话列表与踢下线：`GET /api/sessions`、`POST /api/sessions/:id/kick`
- 日志：`GET /api/logs/recent`、`GET /api/logs/stream(SSE)`
- 浏览器接入 SDK 静态文件：`/sdk/adapter-client.mjs`、`/sdk/demo.html`

## 菜单扩展方案（优先做“无需新增后端接口”的真实功能）
### 1) 新增「消息测试台」页面（核心：让运维能直接发/收消息）
- 功能：在后台里选择/输入 `userId`，一键建立 WS 连接，发送文本，实时显示 bot 回复（`message_reply`）。
- 价值：不用再开 `test.html`，后台直接完成联调/排障。
- 实现：web-admin 新建 `Console.vue`（或 `Tester.vue`），内部实现一套轻量 WS client（复用你现有协议：`PING/PONG` + `message_new/message_reply`）。

### 2) 新增「接入中心」页面（生态扩展入口）
- 功能：把“接入其他网站”的关键内容产品化：
  - 显示 SDK ESM/UMD 引用地址（基于当前 host 推导 `http://<host>:8080/sdk/...`）
  - 提供最短示例代码片段（复制即可用）
  - 提供 demo 链接 `/sdk/demo.html`
  - 提醒 user_id 规则（必须为数字语义）
- 实现：web-admin 新建 `Integrations.vue`（纯前端页面，主要展示说明与可复制代码块）。

### 3) 新增「系统健康」页面（把重要信息集中化）
- 功能：
  - 以卡片形式展示 uptime、online_users、queued_messages、total_sessions
  - 展示 AstrBot 在线状态（可用“最近日志是否出现 Connected/Disconnected”做弱判断）
  - 展示最近 N 条日志（调用 `/api/logs/recent`），并可跳转到实时日志页
- 实现：web-admin 新建 `Health.vue`，仅调用现有 API。

### 4) 新增「设置」页面（把可控项收口）
- 功能（纯前端可落地）：
  - 适配器地址（ws/http 端口、host）输入框并保存到 localStorage
  - 默认 userId 策略说明/重置入口（帮助排查“用户串台/上下文”问题）
- 实现：web-admin 新建 `Settings.vue`。

## 路由与侧边栏改造
- 更新 [router/index.ts](file:///e:/adpater/web-admin/src/router/index.ts)：新增 `/console`、`/integrations`、`/health`、`/settings` 路由。
- 更新 [App.vue](file:///e:/adpater/web-admin/src/App.vue)：侧边栏按分组增加菜单项，并确保 active 高亮跟随 route（你之前提到的问题已修）。

## 可选增强（若你希望更“像产品”，再加）
- 会话详情页：点击 session “详情”可查看 queue、最后活跃、并在同页直接测试发消息。
- 审计/消息追踪：新增后端 message buffer + SSE（但这会扩大后端范围，不作为本轮默认）。

## 验证
- `npm run build`（web-admin）确保类型/构建通过。
- 手动验证：
  - 刷新任意新页面路由，侧边栏高亮正确
  - 消息测试台能连 WS、发消息、收 `message_reply`
  - 接入中心的 demo 链接可打开，SDK 链接可访问

确认后我会按上述 1→4 顺序实现，并把新增菜单全部做到“能用”。