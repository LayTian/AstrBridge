# AstrBridge Admin & Gateway

一个包含 **WS 适配层 + 管理后台（web-admin）+ Dual-token 鉴权 + 审计日志 + 健康度分析** 的工程化样例，适合作为毕设项目骨架。

## 功能概览
- WebSocket 会话管理：在线/离线、队列积压、会话列表
- 管理后台（web-admin）：系统概览、会话管理、消息测试台、接入中心、数据分析、实时日志、审计日志、设置
- Dual-token 鉴权：账号密码登录 → Access Token（短期）→ Refresh Token（httpOnly Cookie）自动续签
- 双角色 RBAC：普通管理员 / 超级管理员（高危操作：踢人、服务端配置修改）
- 审计日志：记录登录、刷新、登出、踢人、配置修改等关键操作
- 健康度评分：后端输出 score/level/reasons，前端数据分析页展示

## 快速启动

### 1) 配置环境变量
复制并修改：

```bash
copy .env.example .env
```

至少需要配置：
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- `ADMIN_TOKEN_SECRET`
- `SUPER_ADMIN_KEY`（可选；填了才可登录为 super_admin）

### 2) 启动后端

```bash
npm install
npm run build
npm start
```

服务默认监听：`http://localhost:8080`

### 3) 启动 web-admin

```bash
cd web-admin
npm install
npm run dev
```

打开：`http://localhost:5174/`

## 鉴权说明（Dual-token）
- `POST /api/auth/login`：账号密码登录，返回 `access_token`，同时下发 `refresh_token`（httpOnly Cookie）
- `POST /api/auth/refresh`：用 refresh cookie 换取新的 access token（前端自动触发）
- `POST /api/auth/logout`：清理 refresh cookie
- `/api/*`：除 `/api/auth/*` 与 `/api/integrations/*` 外均需要 `Authorization: Bearer <access_token>`

## 角色与权限
- `admin`：普通管理员
- `super_admin`：登录时额外填写 `SUPER_ADMIN_KEY`（可选项），才会被签发为超级管理员

高危操作（仅 super_admin）：
- `POST /api/sessions/:id/kick`
- `POST /api/admin/config`（修改 ASTRBOT_URL/ID/TOKEN，并触发重连）
- `POST /api/sessions/offline/clear`（清理离线会话）

## 常用接口
- `GET /docs`：API 文档（Redoc，自动渲染 OpenAPI）
- `GET /openapi.json`：OpenAPI 规范（JSON）
- `GET /api/openapi.json`：OpenAPI 规范（JSON，兼容）
- `GET /api/status`：基础状态（含 astrbot_connected）
- `GET /api/metrics/health`：健康度评分（score/level/reasons/model/signals）
- `GET /api/metrics`：指标快照（JSON）
- `GET /metrics`：指标导出（文本，Prometheus 风格简化版）
- `GET /api/audit/recent`：审计日志列表

## HTTP API 接入（不使用 SDK）
适用于：你的业务服务端 / 网关 / webhook 场景（不需要浏览器直连 WS）。

### 发送消息
- Endpoint：`POST /api/integrations/:id/events`
  - `:id`：你自定义的接入来源标识（任意字符串，如 `webhook`、`crm`、`site_a`）
- Headers：
  - `Content-Type: application/json`
  - 可选 `x-integration-secret: <secret>`（当你在服务端配置了 `INTEGRATION_SECRET` 时必须带）
  - 可选 `Idempotency-Key: <key>`（或 body 传 `idempotency_key`），用于请求幂等
- Body：
  - `user_id`：字符串，但必须是纯数字（OneBot v11 语义）
  - `text`：要发送的文本
  - 可选 `idempotency_key`：请求幂等 key（与 header 二选一）

示例：

```bash
curl -X POST "http://localhost:8080/api/integrations/webhook/events" \
  -H "Content-Type: application/json" \
  -H "x-integration-secret: <可选>" \
  -d "{\"user_id\":\"10001\",\"text\":\"你好\"}"

说明：该接口是“发送请求”的 HTTP 确认响应，返回会包含 `request_id`；机器人回复不会在本次 HTTP 响应中返回，而是通过 WebSocket 推送到对应 `user_id` 的会话（或在用户离线时入队，等 WS 上线后下发）。

### 同步等待回复（HTTP 直接拿机器人回复）
如果你的调用方无法/不方便保持 WebSocket 连接，可以使用下面这个接口在一次 HTTP 请求里等待“下一条机器人回复”：
- Endpoint：`POST /api/integrations/:id/request-reply`
- Body：
  - `user_id`：字符串但必须纯数字
  - `text`：要发送的文本
  - `timeout_ms`：可选，等待回复的超时毫秒数（默认 15000）
  - 可选 `idempotency_key`：请求幂等 key（与 header `Idempotency-Key` 二选一）

返回：
- `request_id`：本次请求标识
- `reply`：机器人回复报文（其中 `reply.payload.metadata.request_id` 会回填该 request_id）

注意：该接口按 `user_id` 维度 FIFO 关联“下一条回复”，同一 user_id 并发请求会排队；在提供方对同一 user_id 的回复不乱序的假设下可稳定工作。
```

### 浏览器调用注意
如果你想在浏览器里直接用 fetch 调用该 API：
- 推荐同源访问（例如 `http://localhost:8080/sdk/api-demo.html`）
- 或通过你自己的前端开发服务器代理 `/api` 到本服务（避免 CORS 问题）

如需跨域访问，可配置：
- `CORS_ALLOW_ORIGINS`：逗号分隔的 allow list（例如 `http://localhost:5174,http://127.0.0.1:5174`）

## 测试

```bash
npm test
```

该 smoke 测试会启动一个临时后端实例（端口 18080），并验证 login/refresh/RBAC/audit 等核心流程。
