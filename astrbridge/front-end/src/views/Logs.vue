<template>
  <div class="logs-container">
    <div class="logs-header glass-panel">
      <div class="left">
        <h4><el-icon><Document /></el-icon> 系统实时日志</h4>
        <el-tag size="small" type="info" effect="plain">实时流</el-tag>
      </div>
      <div class="right">
        <el-switch
          v-model="onlyImportant"
          active-text="仅异常"
          inline-prompt
        />
        <el-switch
          v-model="hideHeartbeat"
          active-text="屏蔽心跳"
          inline-prompt
          class="ml-2"
        />
        <el-switch
          v-model="compact"
          active-text="精简显示"
          inline-prompt
          class="ml-2"
        />
        <el-switch
          v-model="mergeDuplicates"
          active-text="合并重复"
          inline-prompt
          class="ml-2"
        />
        <el-switch 
          v-model="autoScroll" 
          active-text="自动滚动" 
          inline-prompt
          class="ml-2"
        />
        <el-button-group class="ml-2">
          <el-button type="danger" plain @click="clearLogs">清屏</el-button>
          <el-button type="primary" plain @click="downloadLogs">下载</el-button>
        </el-button-group>
      </div>
    </div>

    <div class="terminal-window" ref="terminalRef">
      <div class="terminal-content">
        <div v-for="(log, index) in displayLogs" :key="index" class="log-line">
          <span class="log-time">[{{ log.time }}]</span>
          <span class="log-level" :class="log.level">{{ log.level.toUpperCase() }}</span>
          <span class="log-msg">{{ log.message }}</span>
          <span v-if="log.count > 1" class="log-count">×{{ log.count }}</span>
        </div>
        
        <div class="cursor-line">
          <span class="prompt">></span>
          <span class="cursor">_</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { Document } from '@element-plus/icons-vue'
import axios from 'axios'

const onlyImportant = ref(false)
const hideHeartbeat = ref(true)
const compact = ref(true)
const mergeDuplicates = ref(true)
const autoScroll = ref(true)
const terminalRef = ref<any>(null)
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
interface LogEntry {
  ts: number
  time: string
  level: LogLevel
  message: string
}

interface DisplayLogEntry extends LogEntry {
  count: number
}

const rawLogs = ref<LogEntry[]>([])
let eventSource: EventSource | null = null

const isHeartbeat = (message: string) => {
  const m = message.toLowerCase()
  return m.includes('heartbeat') || m.includes('sending heartbeat ping')
}

const normalizeDynamicParts = (message: string) => {
  return message
    .replace(/\b(ws|wss|http|https):\/\/\S+/gi, '$1://…')
    .replace(/\bid=\d+\b/gi, 'id=#')
    .replace(/\buser(?:_id)?[=:\s]*\d+\b/gi, 'user=#')
    .replace(/\b\d{4,}\b/g, '#')
}

const extractJsonPart = (text: string) => {
  const start = text.indexOf('{')
  if (start < 0) return null
  const jsonCandidate = text.slice(start)
  if (jsonCandidate.includes('…')) return null
  return jsonCandidate
}

const safeJsonParse = (text: string): any | null => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const extractTextPreview = (message: any): string => {
  if (!message) return ''
  if (typeof message === 'string') return message.trim()
  if (Array.isArray(message)) {
    const textSegments = message
      .filter((seg) => seg && (seg.type === 'text' || seg.type === 'Plain'))
      .map((seg) => seg?.data?.text || '')
      .filter(Boolean)
    return textSegments.join('').trim()
  }
  if (typeof message === 'object') {
    if (message.type === 'text' || message.type === 'Plain') {
      return (message.data?.text || '').trim()
    }
  }
  return ''
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

const mapModuleName = (name: string) => {
  const map: Record<string, string> = {
    AstrBotService: 'AstrBot服务',
    WebSocketServer: 'WebSocket',
    SessionManager: '会话管理',
    Admin: '管理端'
  }
  return map[name] || name
}

const summarizeMessage = (message: string) => {
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/)
  const moduleName = match ? mapModuleName(match[1] ?? '') : ''
  const rest = match ? (match[2] ?? '') : message

  const inferredModule =
    moduleName ||
    (/(astrbot|send_private_msg|Received message from AstrBot|Sending API Response|Sending Event to AstrBot|Received RAW)/i.test(
      rest
    )
      ? 'AstrBot服务'
      : '')

  const normalized = normalizeDynamicParts(rest)

  if (/^Received message from AstrBot:\s*/i.test(rest)) {
    const jsonText = extractJsonPart(rest)
    const obj = jsonText ? safeJsonParse(jsonText) : null
    if (obj) {
      const preview = clip(extractTextPreview(obj?.params?.message), 220)
      return `收到 AstrBot 消息：${preview || obj.action || 'astrbot'}`
    }
    return `收到 AstrBot 消息`
  }

  if (/Sending Event to AstrBot:/i.test(rest)) {
    const jsonText = extractJsonPart(rest)
    const obj = jsonText ? safeJsonParse(jsonText) : null
    if (obj) {
      const msgType = obj.message_type || obj.post_type || 'event'
      const userId = obj.user_id ?? obj?.sender?.user_id ?? obj?.params?.user_id
      const preview = clip(extractTextPreview(obj.message), 24)
      return `${inferredModule}: →AstrBot ${msgType} user=${userId ?? '#'}${preview ? ` "${preview}"` : ''}`
    }
    return `${inferredModule}: →AstrBot 报文(len=${rest.length})`
  }

  if (/Received RAW:/i.test(rest)) {
    const jsonText = extractJsonPart(rest)
    const obj = jsonText ? safeJsonParse(jsonText) : null
    if (obj) {
      const action = obj.action || 'astrbot'
      const userId = obj?.params?.user_id
      const echoSeq = obj?.echo?.seq
      const preview = clip(extractTextPreview(obj?.params?.message), 28)
      return `${inferredModule}: ←AstrBot ${action} user=${userId ?? '#'}${preview ? ` "${preview}"` : ''}${echoSeq != null ? ` (seq=${echoSeq})` : ''}`
    }
    return `${inferredModule}: ←AstrBot 报文(len=${rest.length})`
  }

  if (/Sending API Response:/i.test(rest)) {
    const jsonText = extractJsonPart(rest)
    const obj = jsonText ? safeJsonParse(jsonText) : null
    if (obj) {
      const ok = obj.status === 'ok' || obj.retcode === 0
      const echoSeq = obj?.echo?.seq
      return `${inferredModule}: →AstrBot 回执 ${ok ? 'OK' : 'FAIL'}${echoSeq != null ? ` (seq=${echoSeq})` : ''}`
    }
    return `${inferredModule}: →AstrBot 回执`
  }

  const rules: Array<[RegExp, string]> = [
    [/^Connected to AstrBot/i, '已连接'],
    [/^Connecting to AstrBot/i, '连接中'],
    [/^Sending heartbeat ping/i, '心跳'],
    [/^WebSocket server starting/i, 'WS 启动'],
    [/^WebSocket server started/i, 'WS 启动'],
    [/^WebSocket server is listening/i, 'WS 监听'],
    [/^Attaching WebSocket server/i, 'WS 挂载'],
    [/^Server is running on/i, 'HTTP 启动'],
    [/^WebSocket is accessible at/i, 'WS 地址'],
    [/^New client connected/i, '客户端连接'],
    [/^Client disconnected/i, '客户端断开'],
    [/^Sending \d+ pending messages to user/i, '离线消息推送'],
    [/^Loaded \d+ sessions from disk/i, '载入会话'],
    [/^Updating session for user/i, '更新会话'],
    [/^Received message from user/i, '收到用户消息'],
    [/^Forwarded AstrBot reply to user/i, '回包给用户'],
    [/^Invalid JSON received/i, '无效 JSON'],
  ]

  for (const [re, text] of rules) {
    if (re.test(rest)) return inferredModule ? `${inferredModule}: ${text}` : text
  }

  if (rest.includes('{')) {
    return inferredModule ? `${inferredModule}: JSON报文(len=${rest.length})` : `JSON报文(len=${rest.length})`
  }

  const finalText = inferredModule ? `${inferredModule}: ${normalized}` : normalized
  return finalText.length > 140 ? `${finalText.slice(0, 140)}…` : finalText
}

const addRawLog = (log: LogEntry) => {
  rawLogs.value.push(log)
  if (rawLogs.value.length > 2000) rawLogs.value.shift()
}

const scrollToBottom = () => {
  if (autoScroll.value && terminalRef.value) {
    terminalRef.value.scrollTop = terminalRef.value.scrollHeight
  }
}

const displayLogs = computed<DisplayLogEntry[]>(() => {
  const byLevel = onlyImportant.value
    ? rawLogs.value.filter((l) => l.level === 'warn' || l.level === 'error')
    : rawLogs.value

  const filtered = hideHeartbeat.value
    ? byLevel.filter((l) => !isHeartbeat(l.message))
    : byLevel

  const mapped = filtered.map((l) => ({
    ...l,
    message: compact.value ? summarizeMessage(l.message) : l.message,
    count: 1
  }))

  if (!mergeDuplicates.value) return mapped

  const merged: DisplayLogEntry[] = []
  for (const l of mapped) {
    const last = merged[merged.length - 1]
    if (last && last.level === l.level && last.message === l.message) {
      last.count += 1
      last.ts = l.ts
      last.time = l.time
      continue
    }
    merged.push({ ...l })
  }
  return merged
})

watch(() => displayLogs.value.length, () => {
  nextTick(scrollToBottom)
})

const clearLogs = () => {
  rawLogs.value = []
}

const downloadLogs = () => {
  const content = displayLogs.value
    .map((l) => `[${l.time}] ${l.level.toUpperCase()} ${l.message}${l.count > 1 ? ` ×${l.count}` : ''}`)
    .join('\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = (globalThis as any).document?.createElement('a')
  if (!a) return
  a.href = url
  a.download = `adapter-logs-${new Date().toISOString().slice(0, 10)}.txt`
  ;(globalThis as any).document?.body?.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  axios
    .get('/api/logs/recent', { params: { limit: 200 } })
    .then((res) => {
      const data = res.data?.data || []
      rawLogs.value = data
    })
    .catch(() => {})

  eventSource = new EventSource('/api/logs/stream')
  eventSource.onmessage = (evt) => {
    try {
      const entry = JSON.parse(evt.data)
      addRawLog(entry)
    } catch {}
  }
})

onUnmounted(() => {
  eventSource?.close()
  eventSource = null
})
</script>

<style scoped>
.logs-container {
  height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
}

.logs-header {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.left h4 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.right {
  display: flex;
  align-items: center;
}

.ml-2 {
  margin-left: 12px;
}

/* 终端窗口 */
.terminal-window {
  flex: 1;
  background: #1e1e1e;
  border-radius: 12px;
  padding: 16px;
  overflow-y: auto;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
  border: 1px solid #333;
}

.log-line {
  line-height: 1.6;
  font-size: 13px;
  display: flex;
  gap: 10px;
}

.log-time {
  color: #666;
  min-width: 80px;
}

.log-level {
  min-width: 60px;
  font-weight: bold;
}

.log-level.info { color: #67c23a; }
.log-level.warn { color: #e6a23c; }
.log-level.error { color: #f56c6c; }
.log-level.debug { color: #409eff; }

.log-msg {
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 光标动画 */
.cursor-line {
  margin-top: 4px;
  color: #fff;
  display: flex;
  gap: 8px;
}

.prompt {
  color: #67c23a;
  font-weight: bold;
}

.cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 滚动条美化 */
.terminal-window::-webkit-scrollbar {
  width: 10px;
}

.terminal-window::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.terminal-window::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 5px;
}

.terminal-window::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
