<template>
  <div class="dashboard-container">
    <!-- Hero Section -->
    <div class="hero-card">
      <div class="hero-content">
        <h2>{{ heroTitle }}</h2>
        <p>{{ heroSubtitle }}</p>
      </div>
      <div class="hero-image">
        <el-icon :size="120" color="rgba(255,255,255,0.2)"><Monitor /></el-icon>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="icon-wrapper blue">
          <el-icon><UserFilled /></el-icon>
        </div>
        <div class="stat-content">
          <span class="label">在线用户</span>
          <span class="value">{{ status.online_users }}</span>
          <span :class="['trend', trends.onlineUsers.className]">{{ trends.onlineUsers.text }} <span class="trend-label">较上小时</span></span>
        </div>
      </div>

      <div class="stat-card">
        <div class="icon-wrapper purple">
          <el-icon><Message /></el-icon>
        </div>
        <div class="stat-content">
          <span class="label">待处理消息</span>
          <span class="value">{{ status.queued_messages }}</span>
          <span :class="['trend', trends.queuedMessages.className]">{{ trends.queuedMessages.text }} <span class="trend-label">较上小时</span></span>
        </div>
      </div>

      <div class="stat-card">
        <div class="icon-wrapper orange">
          <el-icon><Connection /></el-icon>
        </div>
        <div class="stat-content">
          <span class="label">总会话数</span>
          <span class="value">{{ status.total_sessions }}</span>
          <span :class="['trend', trends.totalSessions.className]">{{ trends.totalSessions.text }} <span class="trend-label">较上小时</span></span>
        </div>
      </div>

      <div class="stat-card">
        <div class="icon-wrapper green">
          <el-icon><Cpu /></el-icon>
        </div>
        <div class="stat-content">
          <span class="label">预估 QPS</span>
          <span class="value">~{{ Math.floor(status.online_users * 0.5) }}</span>
          <span :class="['trend', trends.qps.className]">{{ trends.qps.text }} <span class="trend-label">较上小时</span></span>
        </div>
      </div>
    </div>

    <!-- Main Content Split -->
    <div class="content-split">
      <div class="left-panel">
        <div class="panel-header">
          <h3>活跃会话列表</h3>
          <el-button circle :icon="Refresh" @click="fetchData" :loading="loading" />
        </div>
        
        <el-table 
          :data="sessions" 
          style="width: 100%" 
          class="modern-table"
        >
          <el-table-column prop="userId" label="用户 ID" width="180">
            <template #default="scope">
              <span class="user-id-badge">{{ scope.row.userId }}</span>
            </template>
          </el-table-column>
          
          <el-table-column prop="online" label="状态" width="120">
            <template #default="scope">
              <span :class="['status-pill', scope.row.online ? 'online' : 'offline']">
                {{ scope.row.online ? '在线' : '离线' }}
              </span>
            </template>
          </el-table-column>
          
          <el-table-column prop="queueSize" label="待发消息" width="120">
            <template #default="scope">
              <div class="queue-bar">
                <div class="bar-fill" :style="{ width: Math.min(scope.row.queueSize * 10, 100) + '%' }"></div>
                <span>{{ scope.row.queueSize }}</span>
              </div>
            </template>
          </el-table-column>
          
          <el-table-column prop="lastActiveTime" label="最后活跃" />
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button link type="primary" size="small">详情</el-button>
              <el-tooltip :content="isSuperAdmin ? '' : '仅超级管理员可执行'" :disabled="isSuperAdmin" placement="top">
                <span>
                  <el-button
                    link
                    type="danger"
                    size="small"
                    @click="kickUser(scope.row)"
                    :disabled="!scope.row.online || !isSuperAdmin"
                  >
                    踢下线
                  </el-button>
                </span>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </div>
      
      <div class="right-panel">
        <div class="panel-header">
          <h3>系统动态</h3>
        </div>
        <div class="event-timeline">
          <div class="event-item" v-for="e in events" :key="e.id">
            <div :class="['event-dot', e.level]"></div>
            <div class="event-content">
              <p class="event-title">{{ e.title }}</p>
              <p v-if="e.detail" class="event-detail">{{ e.detail }}</p>
              <p class="event-time">{{ formatSince(e.ts) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { UserFilled, Message, Connection, Cpu, Refresh, Monitor } from '@element-plus/icons-vue'
import axios from 'axios'
import { getRole } from '../auth'
const loading = ref(false)
type StatusSnapshot = {
  ts: number
  online_users: number
  queued_messages: number
  total_sessions: number
}

const status = ref({
  online_users: 0,
  queued_messages: 0,
  total_sessions: 0,
  uptime: 0
})

interface Session {
  userId: string;
  online: boolean;
  queueSize: number;
  lastActiveTime: string;
}

const sessions = ref<Session[]>([])

type HealthSnapshot = {
  status: 'ok'
  data: {
    score: number
    level: 'ok' | 'degraded' | 'down'
    reasons: string[]
    signals: {
      astrbot_connected: boolean
      online_users: number
      total_sessions: number
      queued_messages: number
    }
    thresholds: {
      queued_warn: number
      queued_bad: number
      score_degraded: number
      score_ok: number
    }
  }
}

type TimelineEvent = {
  id: string
  title: string
  detail?: string
  ts: number
  level: 'ok' | 'warn' | 'danger'
}

const nowTick = ref(Date.now())
const events = ref<TimelineEvent[]>([])
const lastHealthLevel = ref<HealthSnapshot['data']['level'] | null>(null)
const lastReasonsKey = ref<string>('')
const lastAstrbotConnected = ref<boolean | null>(null)
const lastQueueState = ref<'ok' | 'warn' | 'danger' | null>(null)
const lastSelfCheckEventAt = ref<number>(0)

const isSuperAdmin = computed(() => getRole() === 'super_admin')
const heroTitle = computed(() => (isSuperAdmin.value ? '欢迎回来，超级管理员！' : '欢迎回来，管理员！'))
const heroSubtitle = computed(() =>
  isSuperAdmin.value
    ? '你拥有高危操作权限：踢人、修改服务端配置等。请谨慎操作。'
    : '你可以查看系统状态、会话与日志；高危操作需要超级管理员授权。'
)

const kickUser = async (user: any) => {
  if (!isSuperAdmin.value) {
    ElMessage.warning('无权限')
    return
  }
  try {
    await axios.post(`/api/sessions/${encodeURIComponent(String(user.userId))}/kick`)
    ElMessage.success('已下线')
  } catch {
    ElMessage.error('操作失败')
  }
}

const HISTORY_KEY = 'dashboard_status_history_v1'

const readHistory = (): StatusSnapshot[] => {
  try {
    const raw = (globalThis as any).localStorage?.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && typeof x.ts === 'number')
      .map((x) => ({
        ts: Number(x.ts),
        online_users: Number(x.online_users) || 0,
        queued_messages: Number(x.queued_messages) || 0,
        total_sessions: Number(x.total_sessions) || 0
      }))
  } catch {
    return []
  }
}

const writeHistory = (items: StatusSnapshot[]) => {
  try {
    ;(globalThis as any).localStorage?.setItem(HISTORY_KEY, JSON.stringify(items))
  } catch {}
}

const recordStatusSnapshot = () => {
  const now = Date.now()
  const history = readHistory()
  const trimmed = history.filter((x) => now - x.ts <= 2 * 60 * 60 * 1000)
  trimmed.push({
    ts: now,
    online_users: Number(status.value.online_users) || 0,
    queued_messages: Number(status.value.queued_messages) || 0,
    total_sessions: Number(status.value.total_sessions) || 0
  })
  writeHistory(trimmed)
}

const formatTrend = (current: number, previous: number) => {
  if (!Number.isFinite(previous) || previous < 0) return { text: '--', className: 'neutral' }
  if (previous === 0) {
    if (current === 0) return { text: '0%', className: 'neutral' }
    return { text: '+100%', className: 'up' }
  }
  const delta = current - previous
  const pct = Math.round((delta / previous) * 100)
  if (pct > 0) return { text: `+${pct}%`, className: 'up' }
  if (pct < 0) return { text: `${pct}%`, className: 'down' }
  return { text: '0%', className: 'neutral' }
}

const formatSince = (ts: number) => {
  const ms = Math.max(0, Number(nowTick.value) - Number(ts))
  const sec = Math.floor(ms / 1000)
  if (sec < 10) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 48) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  return `${day} 天前`
}

const pushEvent = (e: Omit<TimelineEvent, 'id'>) => {
  const id = `${e.ts}:${e.title}:${e.detail || ''}:${e.level}`
  const head = events.value[0]
  if (head && head.title === e.title && (head.detail || '') === (e.detail || '') && head.level === e.level) return
  events.value = [{ id, ...e }, ...events.value].slice(0, 8)
}

const classifyQueueLevel = (queued: number, thresholds: HealthSnapshot['data']['thresholds']) => {
  if (!Number.isFinite(queued) || queued <= 0) return 'ok'
  if (queued >= thresholds.queued_bad) return 'danger'
  if (queued >= thresholds.queued_warn) return 'warn'
  return 'ok'
}

const healthLevelMeta = (level: HealthSnapshot['data']['level']) => {
  if (level === 'ok') return { title: '系统自检：正常', level: 'ok' as const }
  if (level === 'degraded') return { title: '系统自检：降级', level: 'warn' as const }
  return { title: '系统自检：异常', level: 'danger' as const }
}

const applyHealthToTimeline = (snap: HealthSnapshot) => {
  const ts = Date.now()
  const levelMeta = healthLevelMeta(snap.data.level)
  const reasonsKey = (snap.data.reasons || []).join('|')

  if (lastAstrbotConnected.value === null) lastAstrbotConnected.value = snap.data.signals.astrbot_connected
  if (lastAstrbotConnected.value !== snap.data.signals.astrbot_connected) {
    pushEvent({
      ts,
      title: snap.data.signals.astrbot_connected ? 'AstrBot 已连接' : 'AstrBot 连接断开',
      detail: snap.data.signals.astrbot_connected ? '上游已恢复' : '请检查 ASTRBOT_URL/网络/Token',
      level: snap.data.signals.astrbot_connected ? 'ok' : 'danger'
    })
    lastAstrbotConnected.value = snap.data.signals.astrbot_connected
  }

  const qLevel = classifyQueueLevel(snap.data.signals.queued_messages, snap.data.thresholds)
  if (lastQueueState.value === null) lastQueueState.value = qLevel
  if (lastQueueState.value !== qLevel) {
    pushEvent({
      ts,
      title:
        qLevel === 'ok'
          ? '队列恢复正常'
          : qLevel === 'warn'
            ? '队列开始积压'
            : '队列严重积压',
      detail: `当前积压 ${snap.data.signals.queued_messages}`,
      level: qLevel
    })
    lastQueueState.value = qLevel
  }

  const shouldEmitSelfCheck = ts - lastSelfCheckEventAt.value >= 60 * 1000
  if (lastHealthLevel.value === null || lastHealthLevel.value !== snap.data.level || shouldEmitSelfCheck) {
    pushEvent({
      ts,
      title: levelMeta.title,
      detail: `健康分 ${snap.data.score}${snap.data.reasons?.length ? `；${snap.data.reasons.join('；')}` : ''}`,
      level: levelMeta.level
    })
    lastSelfCheckEventAt.value = ts
  } else if (lastReasonsKey.value !== reasonsKey) {
    pushEvent({
      ts,
      title: '系统自检原因更新',
      detail: snap.data.reasons?.length ? snap.data.reasons.join('；') : '状态良好',
      level: levelMeta.level
    })
  }

  lastHealthLevel.value = snap.data.level
  lastReasonsKey.value = reasonsKey
}

const getPreviousHourSnapshot = (): StatusSnapshot | null => {
  const history = readHistory()
  const target = Date.now() - 60 * 60 * 1000
  let best: StatusSnapshot | null = null
  for (const item of history) {
    if (item.ts <= target && (!best || item.ts > best.ts)) best = item
  }
  return best
}

const trends = computed(() => {
  const prev = getPreviousHourSnapshot()
  if (!prev) {
    return {
      onlineUsers: { text: '--', className: 'neutral' },
      queuedMessages: { text: '--', className: 'neutral' },
      totalSessions: { text: '--', className: 'neutral' },
      qps: { text: '--', className: 'neutral' }
    }
  }
  const currentOnline = Number(status.value.online_users) || 0
  const currentQueued = Number(status.value.queued_messages) || 0
  const currentSessions = Number(status.value.total_sessions) || 0

  const prevOnline = Number(prev.online_users) || 0
  const prevQueued = Number(prev.queued_messages) || 0
  const prevSessions = Number(prev.total_sessions) || 0

  const currentQps = Math.floor(currentOnline * 0.5)
  const prevQps = Math.floor(prevOnline * 0.5)

  return {
    onlineUsers: formatTrend(currentOnline, prevOnline),
    queuedMessages: formatTrend(currentQueued, prevQueued),
    totalSessions: formatTrend(currentSessions, prevSessions),
    qps: formatTrend(currentQps, prevQps)
  }
})

const fetchData = async () => {
  loading.value = true
  try {
    const [statusRes, sessionsRes, healthRes] = await Promise.all([
      axios.get('/api/status'),
      axios.get('/api/sessions'),
      axios.get('/api/metrics/health')
    ])
    status.value = statusRes.data
    sessions.value = sessionsRes.data.data
    recordStatusSnapshot()
    if (healthRes?.data?.status === 'ok' && healthRes?.data?.data) {
      applyHealthToTimeline(healthRes.data as HealthSnapshot)
    }
  } catch (error) {
    console.error('Failed to fetch data', error)
    pushEvent({ ts: Date.now(), title: '系统自检失败', detail: '无法获取健康度信息', level: 'danger' })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
  setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
  setInterval(fetchData, 5000)
})
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Hero Card */
.hero-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 20px;
  padding: 40px;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 10px 30px rgba(118, 75, 162, 0.3);
  position: relative;
  overflow: hidden;
}

.hero-content {
  z-index: 1;
}

.hero-content h2 {
  margin: 0 0 12px 0;
  font-size: 32px;
  font-weight: 700;
}

.hero-content p {
  margin: 0 0 24px 0;
  opacity: 0.9;
  font-size: 16px;
}

.hero-actions {
  display: flex;
  gap: 16px;
}

.hero-btn {
  background: white;
  color: #764ba2;
  border: none;
  font-weight: 600;
  padding: 12px 24px;
  height: auto;
}

.hero-btn-outline {
  background: rgba(255,255,255,0.2);
  color: white;
  border: 1px solid rgba(255,255,255,0.3);
  font-weight: 600;
  padding: 12px 24px;
  height: auto;
}

.hero-image {
  position: absolute;
  right: -20px;
  bottom: -30px;
  transform: rotate(-15deg);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

.stat-card {
  background: white;
  border-radius: 16px;
  padding: 24px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.02);
}

.icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.blue { background: #ebf8ff; color: #4299e1; }
.purple { background: #faf5ff; color: #9f7aea; }
.orange { background: #fffaf0; color: #ed8936; }
.green { background: #f0fff4; color: #48bb78; }

.stat-content {
  display: flex;
  flex-direction: column;
}

.stat-content .label {
  font-size: 13px;
  color: #a0aec0;
  font-weight: 600;
  margin-bottom: 4px;
}

.stat-content .value {
  font-size: 28px;
  font-weight: 700;
  color: #2d3748;
  line-height: 1.2;
}

.trend {
  font-size: 12px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.trend.up { color: #48bb78; }
.trend.down { color: #f56565; }
.trend.neutral { color: #a0aec0; }

.trend-label {
  color: #a0aec0;
  font-weight: 400;
}

/* Content Split */
.content-split {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
}

.left-panel, .right-panel {
  background: white;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.02);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

/* Modern Table */
.modern-table :deep(th) {
  background: transparent !important;
  border-bottom: 1px solid #edf2f7 !important;
  color: #a0aec0;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.modern-table :deep(td) {
  border-bottom: 1px solid #f7fafc !important;
  padding: 16px 0 !important;
}

.user-id-badge {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  color: #4a5568;
  background: #f7fafc;
  padding: 4px 8px;
  border-radius: 6px;
}

.status-pill {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-pill.online {
  background: #f0fff4;
  color: #48bb78;
}

.status-pill.offline {
  background: #edf2f7;
  color: #a0aec0;
}

.queue-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #718096;
}

.bar-fill {
  height: 6px;
  background: #f56565;
  border-radius: 3px;
  min-width: 4px;
}

/* Timeline */
.event-timeline {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.event-item {
  display: flex;
  gap: 12px;
  position: relative;
}

.event-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: -20px;
  width: 2px;
  background: #edf2f7;
}

.event-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e2e8f0;
  margin-top: 4px;
  border: 2px solid white;
  box-shadow: 0 0 0 2px #e2e8f0;
}

.event-dot.ok {
  background: #48bb78;
  box-shadow: 0 0 0 2px #c6f6d5;
}

.event-dot.warn {
  background: #ed8936;
  box-shadow: 0 0 0 2px #feebc8;
}

.event-dot.danger {
  background: #f56565;
  box-shadow: 0 0 0 2px #fed7d7;
}

.event-content p {
  margin: 0;
}

.event-title {
  font-size: 14px;
  font-weight: 600;
  color: #2d3748;
}

.event-detail {
  font-size: 12px;
  color: #718096;
  margin-top: 4px;
}

.event-time {
  font-size: 12px;
  color: #a0aec0;
  margin-top: 4px;
}
</style>
