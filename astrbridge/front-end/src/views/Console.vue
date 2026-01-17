<template>
  <div class="page">
    <div class="action-bar glass-panel">
      <div class="left">
        <el-tag :type="connected ? 'success' : 'info'" effect="plain">
          {{ connected ? '已连接' : '未连接' }}
        </el-tag>
        <el-input v-model="adapterHost" placeholder="适配器地址，例如 localhost:8080" class="host-input" />
        <el-input v-model="userId" placeholder="user_id（必须为数字）" class="uid-input" />
        <el-button type="primary" @click="toggleConnection">
          {{ connected ? '断开' : '连接' }}
        </el-button>
        <el-button plain @click="resetUserId" :disabled="connected">重置 user_id</el-button>
      </div>
      <div class="right">
        <el-switch v-model="autoScroll" active-text="自动滚动" inline-prompt />
        <el-button-group class="ml-2">
          <el-button type="danger" plain @click="clear">清空</el-button>
        </el-button-group>
      </div>
    </div>

    <div class="chat glass-panel" ref="chatRef">
      <div v-for="m in messages" :key="m.id" class="msg-row" :class="m.role">
        <div class="bubble">
          <div class="meta">
            <span class="name">{{ m.roleLabel }}</span>
            <span class="time">{{ m.time }}</span>
          </div>
          <div class="text">{{ m.text }}</div>
        </div>
      </div>
    </div>

    <div class="composer glass-panel">
      <el-input
        v-model="draft"
        placeholder="输入消息，回车发送"
        :disabled="!connected"
        @keydown.enter.prevent="send"
      />
      <el-button type="primary" :disabled="!connected || !draft.trim()" @click="send">发送</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'

type MsgRole = 'user' | 'bot' | 'system'
type LogLevel = 'info' | 'warn' | 'error'

interface ChatMessage {
  id: string
  role: MsgRole
  roleLabel: string
  time: string
  text: string
  level?: LogLevel
}

interface MessageReply {
  event: 'message_reply'
  payload?: { text?: string }
}

interface ErrorPayload {
  event?: string
  error?: string
}

const STORAGE_ADAPTER_HOST = 'adapter_admin_host'
const STORAGE_USER_ID = 'adapter_user_id'

const autoScroll = ref(true)
const chatRef = ref<any>(null)
const draft = ref('')
const adapterHost = ref('')
const userId = ref('')
const route = useRoute()

const ws = ref<WebSocket | null>(null)
const connected = ref(false)
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

const messages = ref<ChatMessage[]>([])

const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

const push = (role: MsgRole, text: string, level?: LogLevel) => {
  messages.value.push({
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    roleLabel: role === 'user' ? '我' : role === 'bot' ? 'AstrBot' : '系统',
    time: nowTime(),
    text,
    level
  })
  if (messages.value.length > 2000) messages.value.shift()
}

const scrollToBottom = () => {
  if (!autoScroll.value || !chatRef.value) return
  chatRef.value.scrollTop = chatRef.value.scrollHeight
}

watch(
  () => messages.value.length,
  () => nextTick(scrollToBottom)
)

const defaultHost = () => `${(globalThis as any).location?.hostname || 'localhost'}:8080`

const getOrCreateUserId = () => {
  try {
    const existing = globalThis.localStorage?.getItem(STORAGE_USER_ID)
    if (existing && /^\d+$/.test(existing)) return existing
  } catch {}
  const created = String(1000000000 + Math.floor(Math.random() * 9000000000))
  try {
    globalThis.localStorage?.setItem(STORAGE_USER_ID, created)
  } catch {}
  return created
}

const validateUserId = (value: string) => /^\d+$/.test(value)

const wsUrl = computed(() => {
  const rawHost = adapterHost.value.trim() || defaultHost()
  const proto = (globalThis as any).location?.protocol === 'https:' ? 'wss' : 'ws'
  const base = rawHost.includes('://') ? rawHost : `${proto}://${rawHost}`
  const url = new URL(base)
  url.searchParams.set('user_id', userId.value.trim())
  return url.toString()
})

const startHeartbeat = () => {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send('PING')
    }
  }, 30000)
}

const stopHeartbeat = () => {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

const disconnect = () => {
  stopHeartbeat()
  try {
    ws.value?.close()
  } catch {}
  ws.value = null
  connected.value = false
}

const connect = () => {
  if (!validateUserId(userId.value.trim())) {
    ElMessage.error('user_id 必须为纯数字')
    return
  }
  disconnect()

  const socket = new WebSocket(wsUrl.value)
  ws.value = socket

  socket.onopen = () => {
    push('system', '连接成功', 'info')
    connected.value = true
    startHeartbeat()
  }

  socket.onclose = () => {
    push('system', '连接已断开', 'warn')
    stopHeartbeat()
    connected.value = false
  }

  socket.onerror = () => {
    push('system', '连接发生错误', 'error')
    connected.value = false
  }

  socket.onmessage = (evt) => {
    const data = typeof evt.data === 'string' ? evt.data : ''
    if (data === 'PONG') return
    if (!data) return
    try {
      const parsed = JSON.parse(data) as MessageReply | ErrorPayload
      if ((parsed as MessageReply).event === 'message_reply') {
        push('bot', (parsed as MessageReply).payload?.text || '')
        return
      }
      if ((parsed as ErrorPayload).error) {
        push('system', `错误：${(parsed as ErrorPayload).error}`, 'error')
        return
      }
      push('system', data, 'info')
    } catch {
      push('system', data, 'info')
    }
  }
}

const toggleConnection = () => {
  if (connected.value) {
    disconnect()
    return
  }
  connect()
}

const send = () => {
  if (!connected.value || !ws.value) return
  const text = draft.value.trim()
  if (!text) return

  const uid = userId.value.trim()
  const payload = {
    event: 'message_new',
    payload: {
      text,
      metadata: { user_id: uid, session_id: 'admin_console' }
    }
  }
  ws.value.send(JSON.stringify(payload))
  push('user', text)
  draft.value = ''
}

const clear = () => {
  messages.value = []
}

const resetUserId = () => {
  if (connected.value) return
  const created = String(1000000000 + Math.floor(Math.random() * 9000000000))
  userId.value = created
  try {
    globalThis.localStorage?.setItem(STORAGE_USER_ID, created)
  } catch {}
  ElMessage.success('已重置 user_id')
}

watch(adapterHost, (v) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_ADAPTER_HOST, v)
  } catch {}
})

watch(userId, (v) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_USER_ID, v)
  } catch {}
})

watch(
  () => route.query.user_id,
  (v) => {
    if (connected.value) return
    const qUserId = String(v || '').trim()
    if (!validateUserId(qUserId)) return
    userId.value = qUserId
  }
)

onMounted(() => {
  try {
    adapterHost.value = globalThis.localStorage?.getItem(STORAGE_ADAPTER_HOST) || defaultHost()
  } catch {
    adapterHost.value = defaultHost()
  }
  const qUserId = String(route.query.user_id || '').trim()
  userId.value = validateUserId(qUserId) ? qUserId : getOrCreateUserId()
})

onUnmounted(() => {
  disconnect()
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: calc(100vh - 140px);
}

.glass-panel {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.action-bar {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ml-2 {
  margin-left: 12px;
}

.host-input {
  width: 260px;
}

.uid-input {
  width: 200px;
}

.chat {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #111827;
}

.msg-row {
  display: flex;
  margin-bottom: 10px;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.bot {
  justify-content: flex-start;
}

.msg-row.system {
  justify-content: center;
}

.bubble {
  max-width: 78%;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.msg-row.user .bubble {
  background: rgba(99, 102, 241, 0.22);
  border-color: rgba(99, 102, 241, 0.3);
}

.msg-row.bot .bubble {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.2);
}

.msg-row.system .bubble {
  background: rgba(255, 255, 255, 0.04);
}

.meta {
  display: flex;
  gap: 10px;
  opacity: 0.7;
  font-size: 12px;
  margin-bottom: 6px;
}

.text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.composer {
  padding: 14px;
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
