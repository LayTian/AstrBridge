export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AstrBridge 接口文档',
    version: '1.0.0',
    description: `
# 项目简介
AstrBridge 是一个面向 AstrBot 的“消息接入网关 + 管理平台”示例工程：对外提供 WebSocket（浏览器/前端直连）与 HTTP 接入接口（业务系统调用）两种接入方式；对内作为 WebSocket 客户端连接 AstrBot，并将消息投递/回复回传串成一条可观测、可运维的链路。

主要特性：
- **双接入模式**：WS（浏览器/前端）与 HTTP（Integrations）并存，覆盖“交互式聊天”和“服务端调用”两类场景。
- **AstrBot 适配**：将消息转换为 OneBot v11 私聊事件投递给 AstrBot，并解析 AstrBot 下发的 send_private_msg/send_msg 动作（action）回推给指定 user_id。
- **同步等待回复**：HTTP 的同步问答模式（request-reply）支持同步等待“下一条回复”，并通过 request_id 进行链路关联。
- **可靠性与秩序**：按 user_id 做先进先出（FIFO）排队与并发隔离；离线消息入队并落盘；队列/会话上限可配置。
- **幂等性**：接入接口支持幂等键 Idempotency-Key（命中缓存直接复用结果，避免重试重复投递）。
- **可观测与可运维**：日志（近期日志 + SSE 实时流）、审计日志、指标快照（JSON）与 Prometheus 风格导出、健康度评分模型与看板。
- **工程化后台**：带基于角色的权限控制（RBAC）的管理后台（会话管理/日志/审计/分析/配置/测试台/接入指南）。
- **浏览器接入 SDK**：提供开箱即用的 WS 客户端 SDK（心跳、会话标识等）。

快速导航：
- 文档页：/docs
- OpenAPI：/openapi.json
- 指标快照：/api/metrics，Prometheus 导出：/metrics

# 鉴权指南
本系统提供两种鉴权方式：

1. **管理后台鉴权 (Admin API)**
   - 适用于 \`/api/auth\`, \`/api/admin\`, \`/api/sessions\` 等管理接口。
   - 使用 JWT Bearer Token。
   - Header: \`Authorization: Bearer <access_token>\` 或 \`X-Admin-Token: <access_token>\`。
   - 获取 Token：调用 \`POST /api/auth/login\`。

2. **业务接入鉴权 (Integration API)**
   - 适用于 \`/api/integrations/...\` 接口。
   - 使用预共享密钥 (PSK)。
   - Header: \`X-Integration-Secret: <your_secret>\`。
   - 配置：在服务端环境变量 \`INTEGRATION_SECRET\` 中设置；若未设置则不校验该 header。

# 状态码说明
| 状态码 | 说明 |
| :--- | :--- |
| 200 | 请求成功 |
| 204 | 请求成功（无内容） |
| 400 | 参数错误（缺少字段、类型错误等） |
| 401 | 未授权（Token 无效、过期或 Secret 错误） |
| 403 | 禁止访问（权限不足） |
| 503 | 服务不可用（AstrBot 未连接、队列已满等） |
| 504 | 请求超时（同步等待回复超时） |
    `
  },
  servers: [{ url: '/' }],
  tags: [
    { name: '接入', description: '外部业务接入\n\n提供给第三方业务系统调用的 HTTP 入口，支持发送消息、同步等待回复等。' },
    { name: '认证', description: '管理认证\n\n管理后台的登录、刷新令牌与退出接口。' },
    { name: '会话管理', description: '会话管理\n\n查询在线用户、踢出用户、清理离线会话。' },
    { name: '系统配置', description: '系统配置\n\n修改 AstrBot 连接信息等全局配置（仅超级管理员）。' },
    { name: '可观测性', description: '可观测性\n\n系统状态、健康度评分、指标导出与日志审计。' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        title: '错误响应',
        description: '通用错误响应',
        properties: {
          status: { type: 'string', example: 'failed', description: '状态标识' },
          error: { type: 'string', example: 'unauthorized', description: '错误码' }
        },
        required: ['status', 'error']
      },
      OkResponse: {
        type: 'object',
        title: '成功响应',
        description: '通用成功响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok', description: '状态标识' }
        },
        required: ['status']
      },
      AuthLoginRequest: {
        type: 'object',
        title: '登录请求',
        description: '登录请求参数',
        properties: {
          username: { type: 'string', example: 'admin', description: '管理员用户名' },
          password: { type: 'string', example: '123456', description: '管理员密码' },
          super_key: { type: 'string', nullable: true, example: 'sk_...', description: '超级管理员密钥（可选，用于提权）' }
        },
        required: ['username', 'password']
      },
      AuthLoginResponse: {
        type: 'object',
        title: '登录响应',
        description: '登录成功响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          access_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...', description: 'JWT 访问令牌（Access Token），有效期短' },
          expires_at: { type: 'number', example: 1768600000, description: 'Access Token 过期时间戳（秒）' },
          role: { type: 'string', enum: ['admin', 'super_admin'], example: 'admin', description: '当前角色' }
        },
        required: ['status', 'access_token', 'expires_at', 'role']
      },
      StatusResponse: {
        type: 'object',
        title: '状态快照响应',
        description: '系统状态快照',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          uptime: { type: 'number', example: 3600, description: '运行时间（秒）' },
          online_users: { type: 'number', example: 42, description: '当前在线（有活跃 WS 连接）的用户数' },
          total_sessions: { type: 'number', example: 100, description: '总会话数（含离线持久化会话）' },
          queued_messages: { type: 'number', example: 5, description: '当前离线队列积压消息总数' },
          astrbot_connected: { type: 'boolean', example: true, description: '是否已连接到 AstrBot' }
        },
        required: ['status', 'uptime', 'online_users', 'total_sessions', 'queued_messages']
      },
      HealthResponse: {
        type: 'object',
        title: '健康度响应',
        description: '健康度详情',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          data: {
            type: 'object',
            properties: {
              score: { type: 'number', example: 95, description: '健康分（0-100）' },
              level: { type: 'string', enum: ['ok', 'degraded', 'down'], example: 'ok', description: '健康等级' },
              reasons: { type: 'array', items: { type: 'string' }, example: ['离线会话较多'], description: '扣分原因列表' }
            }
          }
        },
        required: ['status', 'data']
      },
      MetricsResponse: {
        type: 'object',
        title: '指标响应',
        description: '指标集合',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          at: { type: 'number', example: 1768600000, description: '采样时间戳（毫秒）' },
          counters: { type: 'object', description: '累加计数器（如请求总数、失败总数）' },
          gauges: { type: 'object', description: '瞬时值（如当前连接数）' },
          histograms: { type: 'object', description: '分布统计（如延迟 P50/P95/P99）' }
        },
        required: ['status', 'at', 'counters', 'gauges', 'histograms']
      },
      IntegrationSendRequest: {
        type: 'object',
        title: '异步发送请求',
        description: '消息发送参数',
        properties: {
          user_id: { type: 'string', example: '12345678', description: '目标用户 ID（OneBot v11 user_id）' },
          text: { type: 'string', example: '你好，这是一条测试消息', description: '消息内容（纯文本）' },
          idempotency_key: { type: 'string', example: 'msg_uuid_123', description: '幂等键（可选，建议使用）' }
        },
        required: ['user_id', 'text']
      },
      IntegrationSendResponse: {
        type: 'object',
        title: '异步发送响应',
        description: '发送结果',
        properties: {
          status: { type: 'string', example: 'ok' },
          integration: { type: 'string', example: 'webhook', description: '集成 ID' },
          request_id: { type: 'string', example: 'req_abc123', description: '请求追踪 ID' }
        },
        required: ['status', 'integration', 'request_id']
      },
      IntegrationRequestReplyRequest: {
        type: 'object',
        title: '同步问答请求',
        description: '同步请求参数',
        properties: {
          user_id: { type: 'string', example: '12345678', description: '目标用户 ID' },
          text: { type: 'string', example: '查询天气', description: '发送给用户的指令' },
          timeout_ms: { type: 'number', example: 15000, description: '等待回复超时时间（毫秒）' },
          idempotency_key: { type: 'string', example: 'req_uuid_456', description: '幂等键' }
        },
        required: ['user_id', 'text']
      },
      IntegrationRequestReplyResponse: {
        type: 'object',
        title: '同步问答响应',
        description: '同步请求结果（包含用户回复）',
        properties: {
          status: { type: 'string', example: 'ok' },
          integration: { type: 'string', example: 'webhook' },
          request_id: { type: 'string', example: 'req_abc123' },
          reply: {
            type: 'object',
            nullable: true,
            description: '用户回复的原始 Event 数据',
            example: {
              message: [{ type: 'text', data: { text: '今天晴转多云' } }],
              raw_message: '今天晴转多云',
              user_id: 12345678
            }
          }
        },
        required: ['status', 'integration', 'request_id']
      },
      SessionItem: {
        type: 'object',
        title: '会话项',
        description: '会话项（用于管理后台展示）',
        properties: {
          userId: { type: 'string', example: '12345678', description: '用户 ID（字符串，但应为纯数字）' },
          online: { type: 'boolean', example: true, description: '是否在线（是否有活跃 WS 连接）' },
          queueSize: { type: 'number', example: 0, description: '离线队列积压数量' },
          lastActive: { type: 'number', example: 1768600000000, description: '最后活跃时间戳（毫秒）' },
          lastActiveTime: { type: 'string', example: '2026/1/17 12:00:00', description: '最后活跃时间（本地化字符串）' },
          lastMessageText: { type: 'string', example: '你好', description: '最近一条入站消息的文本摘要' },
          lastMessageAt: { type: 'number', example: 1768600000000, description: '最近一条入站消息时间戳（毫秒）' },
          lastMessageTime: { type: 'string', example: '2026/1/17 12:00:00', description: '最近一条入站消息时间（本地化字符串）' },
          lastSessionId: { type: 'string', example: 'sess_xxx', description: '最近一次连接的 session_id（tab 级别）' }
        },
        required: ['userId', 'online', 'queueSize', 'lastActive']
      },
      SessionsListResponse: {
        type: 'object',
        title: '会话列表响应',
        description: '会话列表响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          data: { type: 'array', items: { $ref: '#/components/schemas/SessionItem' } }
        },
        required: ['status', 'data']
      },
      SessionsClearOfflineResponse: {
        type: 'object',
        title: '清理离线会话响应',
        description: '清理离线会话响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          cleared: { type: 'number', example: 12, description: '本次清理的离线会话数量' }
        },
        required: ['status', 'cleared']
      },
      SessionsKickResponse: {
        type: 'object',
        title: '踢下线响应',
        description: '踢下线响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          message: { type: 'string', example: 'User 123456 kicked' }
        },
        required: ['status', 'message']
      },
      AdminConfigResponse: {
        type: 'object',
        title: '配置读取响应',
        description: '系统配置读取响应',
        properties: {
          status: { type: 'string', enum: ['ok'], example: 'ok' },
          data: {
            type: 'object',
            properties: {
              ASTRBOT_URL: { type: 'string', example: 'ws://127.0.0.1:6161/ws', description: 'AstrBot WebSocket 地址' },
              ASTRBOT_ID: { type: 'string', example: 'bot_001', description: 'AstrBot ID' },
              WS_PATH: { type: 'string', example: '/ws', description: 'AstrBot WebSocket 路径' },
              has_ASTRBOT_TOKEN: { type: 'boolean', example: true, description: '是否已配置 AstrBot Token（不返回明文）' }
            },
            required: ['ASTRBOT_URL', 'ASTRBOT_ID', 'WS_PATH', 'has_ASTRBOT_TOKEN']
          }
        },
        required: ['status', 'data']
      },
      AdminConfigUpdateRequest: {
        type: 'object',
        title: '配置更新请求',
        description: '更新系统配置请求（仅超级管理员）。至少提供一个字段。',
        properties: {
          ASTRBOT_URL: { type: 'string', example: 'ws://127.0.0.1:6161/ws' },
          ASTRBOT_ID: { type: 'string', example: 'bot_001' },
          ASTRBOT_TOKEN: { type: 'string', example: '***', description: 'AstrBot Token（敏感信息，不会在读取接口返回）' }
        }
      }
    }
  },
  paths: {
    '/api/openapi.json': {
      get: {
        tags: ['可观测性'],
        summary: '获取 OpenAPI 规范',
        description: '返回本接口文档的原始 JSON 定义，可用于导入 Postman 或其他 API 工具。',
        responses: {
          200: {
            description: 'OpenAPI JSON',
            content: { 'application/json': { schema: { type: 'object' } } }
          }
        }
      }
    },
    '/api/status': {
      get: {
        tags: ['可观测性'],
        summary: '服务状态快照',
        description: '获取系统当前的运行状态，包括运行时间、在线用户数、AstrBot 连接状态等。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/public/status': {
      get: {
        tags: ['可观测性'],
        summary: '公开运行状态（无需登录）',
        description: '提供给演示/官网的公开只读运行状态快照（不需要管理员令牌）。',
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } } }
        }
      }
    },
    '/api/metrics/health': {
      get: {
        tags: ['可观测性'],
        summary: '健康度评分',
        description: '获取系统健康度评分模型，包含具体扣分项与阈值，用于监控看板展示。',
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } }
        }
      }
    },
    '/api/metrics': {
      get: {
        tags: ['可观测性'],
        summary: '获取指标数据 (JSON)',
        description: '获取所有内部监控指标的当前快照，格式为 JSON，适合前端展示。',
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsResponse' } } } }
        }
      }
    },
    '/metrics': {
      get: {
        tags: ['可观测性'],
        summary: '获取指标数据 (Prometheus)',
        description: '获取 Prometheus 兼容格式的指标文本，可直接被 Prometheus Server 抓取。',
        responses: {
          200: { description: '成功', content: { 'text/plain': { schema: { type: 'string', example: 'http_requests_total 100\n...' } } } }
        }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['认证'],
        summary: '管理员登录',
        description: '使用账号密码登录，获取 Access Token (JWT) 和 Refresh Token (HttpOnly Cookie)。',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthLoginRequest' } } }
        },
        responses: {
          200: { description: '登录成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthLoginResponse' } } } },
          400: { description: '参数错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { description: '用户名或密码错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          503: { description: '未配置认证（系统未设置 ADMIN_TOKEN_SECRET）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/auth/refresh': {
      post: {
        tags: ['认证'],
        summary: '刷新令牌',
        description: '使用 HttpOnly Cookie 中的 refresh_token 换取新的 Access Token。',
        responses: {
          200: { description: '刷新成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthLoginResponse' } } } },
          401: { description: 'Refresh Token 无效或过期', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          503: { description: '未配置认证', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['认证'],
        summary: '退出登录',
        description: '清除服务端的 Refresh Cookie。客户端应同时丢弃 Access Token。',
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } }
        }
      }
    },
    '/api/integrations/{id}/events': {
      post: {
        tags: ['接入'],
        summary: '发送消息 (异步)',
        description:
          '以指定 user_id 的身份向机器人发送一条消息（Adapter 会将其转换为 OneBot v11 私聊事件投递给 AstrBot）。该接口仅返回“投递确认”，不等待机器人回复，适用于通知类/触发类场景。',
        'x-code-samples': [
          {
            lang: 'cURL',
            source: `curl -X POST http://localhost:8080/api/integrations/webhook/events \\
  -H "Content-Type: application/json" \\
  -H "X-Integration-Secret: your_secret" \\
  -d '{"user_id": "123456", "text": "你好，我是业务系统"}'`
          },
          {
            lang: 'Node.js',
            source: `const res = await fetch('http://localhost:8080/api/integrations/webhook/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Integration-Secret': 'your_secret'
  },
  body: JSON.stringify({
    user_id: '123456',
    text: '你好，我是业务系统'
  })
});
console.log(await res.json());`
          },
          {
            lang: 'Python',
            source: `import requests

res = requests.post(
    'http://localhost:8080/api/integrations/webhook/events',
    headers={'X-Integration-Secret': 'your_secret'},
    json={'user_id': '123456', 'text': '你好，我是业务系统'}
)
print(res.json())`
          }
        ],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'webhook' }, description: '集成 ID (如 webhook)' },
          { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', example: 'evt_123' }, description: '幂等键，防止重试导致重复发送' },
          { name: 'X-Integration-Secret', in: 'header', required: false, schema: { type: 'string', example: 'sk_...' }, description: '接入密钥 (配置时必填)' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IntegrationSendRequest' } } }
        },
        responses: {
          200: { description: '投递成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/IntegrationSendResponse' } } } },
          400: { description: '参数错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { description: '未授权 (Secret 错误)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          503: { description: '服务不可用 (AstrBot 断连)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/integrations/{id}/request-reply': {
      post: {
        tags: ['接入'],
        summary: '发送消息并等待回复 (同步)',
        description:
          '以指定 user_id 的身份向机器人发送一条消息，并在一次 HTTP 请求内阻塞等待“下一条机器人回复”。适用于问答、查询等交互场景；支持超时设置与幂等重试。',
        'x-code-samples': [
          {
            lang: 'cURL',
            source: `curl -X POST http://localhost:8080/api/integrations/webhook/request-reply \\
  -H "Content-Type: application/json" \\
  -H "X-Integration-Secret: your_secret" \\
  -d '{"user_id": "123456", "text": "查询天气"}'`
          },
          {
            lang: 'Node.js',
            source: `const res = await fetch('http://localhost:8080/api/integrations/webhook/request-reply', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Integration-Secret': 'your_secret'
  },
  body: JSON.stringify({
    user_id: '123456',
    text: '查询天气'
  })
});
const data = await res.json();
console.log('机器人回复：', data.reply?.raw_message);`
          }
        ],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'webhook' }, description: '集成 ID' },
          { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', example: 'req_456' }, description: '幂等键，若命中缓存则直接返回上次结果' },
          { name: 'X-Integration-Secret', in: 'header', required: false, schema: { type: 'string', example: 'sk_...' }, description: '接入密钥' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IntegrationRequestReplyRequest' } } }
        },
        responses: {
          200: { description: '成功收到回复', content: { 'application/json': { schema: { $ref: '#/components/schemas/IntegrationRequestReplyResponse' } } } },
          400: { description: '参数错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          503: { description: '服务不可用', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          504: { description: '等待回复超时', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/sessions': {
      get: {
        tags: ['会话管理'],
        summary: '获取会话列表',
        description: '返回当前所有用户会话的快照（在线状态、离线队列积压、最后活跃时间等），用于管理后台展示。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionsListResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/sessions/offline/clear': {
      post: {
        tags: ['会话管理'],
        summary: '清理离线会话（仅超级管理员）',
        description: '删除所有离线会话（包括其离线队列），并将结果落盘保存。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionsClearOfflineResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          403: { description: '禁止访问', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/sessions/{id}/kick': {
      post: {
        tags: ['会话管理'],
        summary: '踢用户下线（仅超级管理员）',
        description: '关闭指定 user_id 的 WS 连接并移除会话上下文（用于封禁/排障）。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: '12345678' } }],
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionsKickResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          403: { description: '禁止访问', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/api/admin/config': {
      get: {
        tags: ['系统配置'],
        summary: '读取系统配置',
        description: '读取 AstrBot 连接相关配置（不会返回 Token 明文）。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminConfigResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      },
      post: {
        tags: ['系统配置'],
        summary: '更新系统配置并触发重连（仅超级管理员）',
        description: '更新 AstrBot 连接信息并触发适配器重新连接 AstrBot。至少提供一个字段。',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminConfigUpdateRequest' } } } },
        responses: {
          200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/OkResponse' } } } },
          400: { description: '参数错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { description: '未授权', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          403: { description: '禁止访问', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    }
  }
} as const;
