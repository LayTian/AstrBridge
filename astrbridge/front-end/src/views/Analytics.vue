<template>
  <div class="page">
    <div class="header glass-panel">
      <div class="left">
        <h3>数据分析</h3>
        <el-tag size="small" type="info" effect="plain">趋势与分布</el-tag>
      </div>
      <div class="right">
        <el-button :icon="Refresh" circle @click="refresh" :loading="loading" />
      </div>
    </div>

    <div class="stats">
      <div class="stat glass-panel">
        <div class="label label-row">
          <span>健康度</span>
          <el-popover placement="bottom-end" width="380" trigger="click">
            <template #reference>
              <el-button size="small" text type="primary" class="calc-hint-btn">计算说明</el-button>
            </template>
            <div class="health-explain">
              <div class="line">
                <span class="k">公式</span>
                <span class="v">{{ health.model.formula }}</span>
              </div>
              <div class="line">
                <span class="k">基准分</span>
                <span class="v">{{ health.model.base }}</span>
              </div>
              <div class="line">
                <span class="k">扣分项</span>
                <span class="v"></span>
              </div>
              <div class="deduct">
                <div class="row">
                  <span class="k">AstrBot</span>
                  <span class="v">-{{ health.model.deductions.astrbot.value }}（{{ health.model.deductions.astrbot.rule }}）</span>
                </div>
                <div class="row">
                  <span class="k">队列积压</span>
                  <span class="v">-{{ health.model.deductions.queue.value }}（{{ health.model.deductions.queue.rule }}）</span>
                </div>
                <div class="row">
                  <span class="k">离线会话</span>
                  <span class="v">-{{ health.model.deductions.offline_sessions.value }}（{{ health.model.deductions.offline_sessions.rule }}）</span>
                </div>
              </div>
              <div class="line">
                <span class="k">信号</span>
                <span class="v"></span>
              </div>
              <div class="deduct">
                <div class="row">
                  <span class="k">astrbot_connected</span>
                  <span class="v">{{ health.signals.astrbot_connected }}</span>
                </div>
                <div class="row">
                  <span class="k">online_users</span>
                  <span class="v">{{ health.signals.online_users }}</span>
                </div>
                <div class="row">
                  <span class="k">total_sessions</span>
                  <span class="v">{{ health.signals.total_sessions }}</span>
                </div>
                <div class="row">
                  <span class="k">queued_messages</span>
                  <span class="v">{{ health.signals.queued_messages }}</span>
                </div>
              </div>
              <div v-if="health.reasons.length" class="line">
                <span class="k">原因</span>
                <span class="v">{{ health.reasons.join('；') }}</span>
              </div>
              <div class="line">
                <span class="k">分级</span>
                <span class="v">ok≥{{ health.thresholds.score_ok }}，degraded≥{{ health.thresholds.score_degraded }}</span>
              </div>
            </div>
          </el-popover>
        </div>
        <div class="value">
          <el-tag :type="healthTagType" effect="dark">
            {{ health.score }} / 100 · {{ health.level }}
          </el-tag>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">服务状态</div>
        <div class="value">
          <el-tag :type="statusOk ? 'success' : 'danger'" effect="dark">
            {{ statusOk ? '在线' : '异常' }}
          </el-tag>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">AstrBot 连接</div>
        <div class="value">
          <el-tag :type="astrBotConnected ? 'success' : 'warning'" effect="dark">
            {{ astrBotConnected ? '已连接' : '未知/断开' }}
          </el-tag>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">运行时间</div>
        <div class="value">{{ formatUptime(status.uptime) }}</div>
      </div>

      <div class="stat glass-panel">
        <div class="label">在线用户</div>
        <div class="value">{{ status.online_users }}</div>
      </div>

      <div class="stat glass-panel">
        <div class="label">总会话数</div>
        <div class="value">{{ status.total_sessions }}</div>
      </div>

      <div class="stat glass-panel">
        <div class="label">待处理消息</div>
        <div class="value">{{ status.queued_messages }}</div>
      </div>

      <div class="stat glass-panel">
        <div class="label">接入 QPS</div>
        <div class="value">{{ formatRate(integrationsQps, 'req/s') }}</div>
        <div class="sub">
          <span class="muted">events {{ formatRate(integrationsEventsQps) }}</span>
          <span class="muted">request-reply {{ formatRate(integrationsRequestReplyQps) }}</span>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">同步回复 P95</div>
        <div class="value">{{ formatRate(requestReplyP95, 'ms') }}</div>
        <div class="sub">
          <span class="muted">P50 {{ formatRate(requestReplyP50, 'ms') }}</span>
          <span class="muted">P99 {{ formatRate(requestReplyP99, 'ms') }}</span>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">同步成功率</div>
        <div class="value">
          <el-tag :type="requestReplySuccessTagType" effect="dark">{{ Math.round(requestReplySuccessRate * 100) }}%</el-tag>
        </div>
        <div class="sub">
          <span class="muted">ok {{ deltaRequestReplyOk }}</span>
          <span class="muted">timeout {{ deltaRequestReplyTimeout }}</span>
          <span class="muted">failed {{ deltaRequestReplyFailed }}</span>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">幂等命中</div>
        <div class="value">{{ deltaIdempotencyHit }}</div>
        <div class="sub">
          <span class="muted">inflight {{ deltaIdempotencyInflight }}</span>
          <span class="muted">used {{ deltaIdempotencyUsed }}</span>
        </div>
      </div>

      <div class="stat glass-panel">
        <div class="label">离线丢弃</div>
        <div class="value">{{ metricsNow?.counters?.offline_drop_total ?? 0 }}</div>
        <div class="sub">
          <span class="muted">近 10s +{{ deltaOfflineDrop }}</span>
        </div>
      </div>
    </div>

    <div class="charts">
      <div class="chart-card glass-panel">
        <div class="chart-header">
          <div class="title">关键指标趋势</div>
          <el-tag size="small" type="info" effect="plain">近 2 小时</el-tag>
        </div>
        <div ref="trendChartRef" class="chart-body"></div>
      </div>

      <div class="chart-card glass-panel">
        <div class="chart-header">
          <div class="title">待发消息 Top 会话</div>
          <el-tag size="small" type="info" effect="plain">实时</el-tag>
        </div>
        <div ref="queueChartRef" class="chart-body"></div>
      </div>

      <div class="chart-card glass-panel">
        <div class="chart-header">
          <div class="title">HTTP 接入流量</div>
          <el-tag size="small" type="info" effect="plain">近 10 分钟</el-tag>
        </div>
        <div ref="integrationsChartRef" class="chart-body"></div>
      </div>

      <div class="chart-card glass-panel">
        <div class="chart-header">
          <div class="title">同步回复延迟分位数</div>
          <el-tag size="small" type="info" effect="plain">近 10 分钟</el-tag>
        </div>
        <div ref="latencyChartRef" class="chart-body"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import * as echarts from 'echarts'

interface StatusResponse {
  status: string
  uptime: number
  online_users: number
  total_sessions: number
  queued_messages: number
  astrbot_connected?: boolean
}

interface HealthData {
  score: number
  level: 'ok' | 'degraded' | 'down' | 'unknown'
  reasons: string[]
  model: {
    base: number
    formula: string
    total_deduct: number
    deductions: {
      astrbot: { value: number; rule: string }
      queue: { value: number; rule: string }
      offline_sessions: { value: number; rule: string }
    }
  }
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

interface StatusSnapshot {
  ts: number
  online_users: number
  queued_messages: number
  total_sessions: number
}

interface MetricsSnapshot {
  ts: number
  counters: Record<string, number>
  gauges: Record<string, number>
  hist: {
    request_reply_latency_ms?: { p50: number; p95: number; p99: number; count: number }
  }
}

interface SessionRow {
  userId: string
  online: boolean
  queueSize: number
  lastActiveTime: string
}

const loading = ref(false)

const status = ref<StatusResponse>({
  status: 'unknown',
  uptime: 0,
  online_users: 0,
  total_sessions: 0,
  queued_messages: 0
})

const trendChartRef = ref<any>(null)
const queueChartRef = ref<any>(null)
const integrationsChartRef = ref<any>(null)
const latencyChartRef = ref<any>(null)
let trendChart: echarts.ECharts | null = null
let queueChart: echarts.ECharts | null = null
let integrationsChart: echarts.ECharts | null = null
let latencyChart: echarts.ECharts | null = null

const HISTORY_KEY = 'health_status_history_v1'
const METRICS_HISTORY_KEY = 'metrics_snapshot_history_v1'
const sessions = ref<SessionRow[]>([])
const metricsNow = ref<any>(null)
const health = ref<HealthData>({
  score: 0,
  level: 'unknown',
  reasons: [],
  model: {
    base: 100,
    formula: '',
    total_deduct: 0,
    deductions: {
      astrbot: { value: 0, rule: '' },
      queue: { value: 0, rule: '' },
      offline_sessions: { value: 0, rule: '' }
    }
  },
  signals: { astrbot_connected: false, online_users: 0, total_sessions: 0, queued_messages: 0 },
  thresholds: { queued_warn: 20, queued_bad: 50, score_degraded: 60, score_ok: 90 }
})

const statusOk = computed(() => status.value.status === 'ok')

const astrBotConnected = computed(() => {
  return status.value.astrbot_connected === true
})

const healthTagType = computed(() => {
  if (health.value.level === 'ok') return 'success'
  if (health.value.level === 'degraded') return 'warning'
  if (health.value.level === 'down') return 'danger'
  return 'info'
})

const formatUptime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${m}m ${sec}s`
}

const formatRate = (value: number, suffix = '') => {
  const n = Number(value)
  const v = Number.isFinite(n) ? n : 0
  if (suffix) {
    if (suffix === 'ms') return `${Math.round(v)}${suffix}`
    return `${v.toFixed(2)} ${suffix}`
  }
  return v.toFixed(2)
}

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

const recordSnapshot = () => {
  const now = Date.now()
  const history = readHistory()
  const kept = history.filter((x) => now - x.ts <= 2 * 60 * 60 * 1000)
  kept.push({
    ts: now,
    online_users: Number(status.value.online_users) || 0,
    queued_messages: Number(status.value.queued_messages) || 0,
    total_sessions: Number(status.value.total_sessions) || 0
  })
  writeHistory(kept)
}

const readMetricsHistory = (): MetricsSnapshot[] => {
  try {
    const raw = (globalThis as any).localStorage?.getItem(METRICS_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && typeof x.ts === 'number')
      .map((x) => ({
        ts: Number(x.ts),
        counters: x?.counters && typeof x.counters === 'object' ? x.counters : {},
        gauges: x?.gauges && typeof x.gauges === 'object' ? x.gauges : {},
        hist: x?.hist && typeof x.hist === 'object' ? x.hist : {}
      }))
  } catch {
    return []
  }
}

const writeMetricsHistory = (items: MetricsSnapshot[]) => {
  try {
    ;(globalThis as any).localStorage?.setItem(METRICS_HISTORY_KEY, JSON.stringify(items))
  } catch {}
}

const recordMetricsSnapshot = () => {
  const now = Date.now()
  const history = readMetricsHistory()
  const kept = history.filter((x) => now - x.ts <= 10 * 60 * 1000)
  const counters = metricsNow.value?.counters || {}
  const gauges = metricsNow.value?.gauges || {}
  const histograms = metricsNow.value?.histograms || {}
  kept.push({
    ts: now,
    counters: { ...counters },
    gauges: { ...gauges },
    hist: {
      request_reply_latency_ms: histograms?.request_reply_latency_ms
        ? {
            p50: Number(histograms.request_reply_latency_ms.p50) || 0,
            p95: Number(histograms.request_reply_latency_ms.p95) || 0,
            p99: Number(histograms.request_reply_latency_ms.p99) || 0,
            count: Number(histograms.request_reply_latency_ms.count) || 0
          }
        : undefined
    }
  })
  writeMetricsHistory(kept)
}

const metricDelta = (now: number, prev: number) => {
  const a = Number(now)
  const b = Number(prev)
  const d = (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0)
  return d >= 0 ? d : 0
}

const computeWindow = () => {
  const h = readMetricsHistory()
  if (h.length < 2) return null
  const a = h[h.length - 2]
  const b = h[h.length - 1]
  if (!a || !b) return null
  const dt = Math.max(0.001, (b.ts - a.ts) / 1000)
  const d = (k: string) => metricDelta(b.counters?.[k] || 0, a.counters?.[k] || 0)
  return { dt, d }
}

const window = computed(() => computeWindow())

const integrationsEventsQps = computed(() => {
  const w = window.value
  if (!w) return 0
  return w.d('integrations_events_total') / w.dt
})

const integrationsRequestReplyQps = computed(() => {
  const w = window.value
  if (!w) return 0
  return w.d('integrations_request_reply_total') / w.dt
})

const integrationsQps = computed(() => integrationsEventsQps.value + integrationsRequestReplyQps.value)

const deltaRequestReplyOk = computed(() => window.value?.d('integrations_request_reply_ok_total') || 0)
const deltaRequestReplyTimeout = computed(() => window.value?.d('integrations_request_reply_timeout_total') || 0)
const deltaRequestReplyFailed = computed(() => window.value?.d('integrations_request_reply_failed_total') || 0)

const requestReplySuccessRate = computed(() => {
  const ok = deltaRequestReplyOk.value
  const t = deltaRequestReplyTimeout.value + deltaRequestReplyFailed.value
  const total = ok + t
  if (total <= 0) return 1
  return ok / total
})

const requestReplySuccessTagType = computed(() => {
  const r = requestReplySuccessRate.value
  if (r >= 0.99) return 'success'
  if (r >= 0.95) return 'warning'
  return 'danger'
})

const requestReplyP50 = computed(() => Number(metricsNow.value?.histograms?.request_reply_latency_ms?.p50) || 0)
const requestReplyP95 = computed(() => Number(metricsNow.value?.histograms?.request_reply_latency_ms?.p95) || 0)
const requestReplyP99 = computed(() => Number(metricsNow.value?.histograms?.request_reply_latency_ms?.p99) || 0)

const deltaIdempotencyHit = computed(() => window.value?.d('idempotency_hit_total') || 0)
const deltaIdempotencyInflight = computed(() => window.value?.d('idempotency_inflight_total') || 0)
const deltaIdempotencyUsed = computed(() => window.value?.d('idempotency_used_total') || 0)
const deltaOfflineDrop = computed(() => window.value?.d('offline_drop_total') || 0)

const renderTrend = () => {
  if (!trendChart) return
  const history = readHistory()
  const labels = history.map((h) => new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false }))
  const online = history.map((h) => h.online_users)
  const queued = history.map((h) => h.queued_messages)
  const total = history.map((h) => h.total_sessions)

  trendChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 48, right: 28, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, left: 10, textStyle: { color: '#334155' }, selected: { 总会话数: false } },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } }
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: { color: '#64748b', hideOverlap: true },
        splitLine: { lineStyle: { color: '#e2e8f0' } }
      },
      {
        type: 'value',
        axisLabel: { color: '#64748b', hideOverlap: true },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '在线用户',
        type: 'line',
        smooth: true,
        data: online,
        showSymbol: false,
        itemStyle: { color: '#2563eb' }
      },
      {
        name: '待处理消息',
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        data: queued,
        showSymbol: false,
        itemStyle: { color: '#6366f1' },
        lineStyle: { width: 2, opacity: 0.9 },
        areaStyle: { opacity: 0.08 }
      },
      {
        name: '总会话数',
        type: 'line',
        smooth: true,
        data: total,
        showSymbol: false,
        itemStyle: { color: '#10b981' },
        lineStyle: { type: 'dashed', width: 2, opacity: 0.7 }
      }
    ]
  })
}

const renderIntegrationsTrend = () => {
  if (!integrationsChart) return
  const history = readMetricsHistory()
  const labels = history.map((h) => new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false }))
  const eventsQps: number[] = []
  const requestReplyQps: number[] = []
  for (let i = 0; i < history.length; i++) {
    if (i === 0) {
      eventsQps.push(0)
      requestReplyQps.push(0)
      continue
    }
    const a = history[i - 1]
    const b = history[i]
    if (!a || !b) {
      eventsQps.push(0)
      requestReplyQps.push(0)
      continue
    }
    const dt = Math.max(0.001, (b.ts - a.ts) / 1000)
    const ev = metricDelta(b.counters?.integrations_events_total || 0, a.counters?.integrations_events_total || 0) / dt
    const rr =
      metricDelta(b.counters?.integrations_request_reply_total || 0, a.counters?.integrations_request_reply_total || 0) / dt
    eventsQps.push(ev)
    requestReplyQps.push(rr)
  }

  integrationsChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 48, right: 20, top: 30, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const list = Array.isArray(params) ? params : []
        if (!list.length) return ''
        const axis = list[0]?.axisValueLabel ?? ''
        const kv: Record<string, number> = {}
        for (const p of list) kv[String(p.seriesName || '')] = Number(p.data) || 0
        const total = (kv['异步投递'] || 0) + (kv['同步问答'] || 0)
        return `${axis}<br/>总吞吐：${total.toFixed(2)} req/s<br/>异步投递：${(kv['异步投递'] || 0).toFixed(2)} req/s<br/>同步问答：${(
          kv['同步问答'] || 0
        ).toFixed(2)} req/s`
      }
    },
    legend: { top: 0, left: 10, textStyle: { color: '#334155' } },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', hideOverlap: true },
      splitLine: { lineStyle: { color: '#e2e8f0' } }
    },
    series: [
      {
        name: '异步投递',
        type: 'line',
        smooth: true,
        data: eventsQps,
        showSymbol: false,
        stack: 'qps',
        areaStyle: { opacity: 0.16 },
        itemStyle: { color: '#6366f1' },
        lineStyle: { width: 1.5, opacity: 0.9 }
      },
      {
        name: '同步问答',
        type: 'line',
        smooth: true,
        data: requestReplyQps,
        showSymbol: false,
        stack: 'qps',
        areaStyle: { opacity: 0.16 },
        itemStyle: { color: '#10b981' },
        lineStyle: { width: 1.5, opacity: 0.9 }
      }
    ]
  })
}

const renderLatencyTrend = () => {
  if (!latencyChart) return
  const history = readMetricsHistory()
  const labels = history.map((h) => new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false }))
  const p50 = history.map((h) => Number(h.hist?.request_reply_latency_ms?.p50) || 0)
  const p99 = history.map((h) => Number(h.hist?.request_reply_latency_ms?.p99) || 0)
  const band = p99.map((v, i) => Math.max(0, v - (p50[i] || 0)))

  latencyChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 48, right: 20, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e2e8f0' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', hideOverlap: true },
      splitLine: { lineStyle: { color: '#e2e8f0' } }
    },
    series: [
      {
        name: 'P50',
        type: 'line',
        smooth: true,
        data: p50,
        showSymbol: false,
        itemStyle: { color: '#2563eb' },
        lineStyle: { width: 2, opacity: 0.95 }
      },
      {
        name: '波动区间(P50~P99)',
        type: 'line',
        smooth: true,
        data: band,
        showSymbol: false,
        stack: 'lat',
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0.08, color: '#ef4444' },
        silent: true
      },
      {
        name: 'P99',
        type: 'line',
        smooth: true,
        data: p99,
        showSymbol: false,
        itemStyle: { color: '#ef4444' },
        lineStyle: { width: 2, opacity: 0.9 },
        markLine: {
          symbol: 'none',
          lineStyle: { color: '#ef4444', opacity: 0.55, type: 'dashed' },
          label: { color: '#334155' },
          data: [{ yAxis: 200, name: '200ms' }, { yAxis: 500, name: '500ms' }]
        }
      }
    ]
  })
}

const renderQueueTop = () => {
  if (!queueChart) return
  const top = [...sessions.value]
    .sort((a, b) => (b.queueSize || 0) - (a.queueSize || 0))
    .slice(0, 10)
    .reverse()

  const labels = top.map((s) => s.userId)
  const values = top.map((s) => s.queueSize)

  queueChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 70, right: 20, top: 20, bottom: 30 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } }
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#e2e8f0' } }
    },
    series: [
      {
        name: '待发消息',
        type: 'bar',
        data: values,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: '#6366f1' },
            { offset: 1, color: '#60a5fa' }
          ])
        },
        barWidth: 14
      }
    ]
  })
}

const refresh = async () => {
  loading.value = true
  try {
    const [statusRes, sessionsRes, healthRes, metricsRes] = await Promise.all([
      axios.get('/api/status'),
      axios.get('/api/sessions'),
      axios.get('/api/metrics/health'),
      axios.get('/api/metrics')
    ])
    status.value = statusRes.data
    sessions.value = sessionsRes.data?.data || []
    metricsNow.value = metricsRes.data || null
    health.value =
      healthRes.data?.data ||
      ({
        score: 0,
        level: 'unknown',
        reasons: [],
        model: {
          base: 100,
          formula: '',
          total_deduct: 0,
          deductions: {
            astrbot: { value: 0, rule: '' },
            queue: { value: 0, rule: '' },
            offline_sessions: { value: 0, rule: '' }
          }
        },
        signals: { astrbot_connected: false, online_users: 0, total_sessions: 0, queued_messages: 0 },
        thresholds: { queued_warn: 20, queued_bad: 50, score_degraded: 60, score_ok: 90 }
      } as HealthData)
    recordSnapshot()
    recordMetricsSnapshot()
    await nextTick()
    renderTrend()
    renderQueueTop()
    renderIntegrationsTrend()
    renderLatencyTrend()
  } finally {
    loading.value = false
  }
}

const initCharts = () => {
  if (trendChartRef.value && !trendChart) {
    trendChart = echarts.init(trendChartRef.value)
  }
  if (queueChartRef.value && !queueChart) {
    queueChart = echarts.init(queueChartRef.value)
  }
  if (integrationsChartRef.value && !integrationsChart) {
    integrationsChart = echarts.init(integrationsChartRef.value)
  }
  if (latencyChartRef.value && !latencyChart) {
    latencyChart = echarts.init(latencyChartRef.value)
  }
}

const resizeCharts = () => {
  trendChart?.resize()
  queueChart?.resize()
  integrationsChart?.resize()
  latencyChart?.resize()
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  initCharts()
  await refresh()
  ;(globalThis as any).addEventListener?.('resize', resizeCharts)
  timer = setInterval(refresh, 10000)
})

onUnmounted(() => {
  if (timer != null) clearInterval(timer)
  timer = null
  ;(globalThis as any).removeEventListener?.('resize', resizeCharts)
  trendChart?.dispose()
  queueChart?.dispose()
  trendChart = null
  queueChart = null
  integrationsChart?.dispose()
  latencyChart?.dispose()
  integrationsChart = null
  latencyChart = null
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.header {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.left h3 {
  margin: 0;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 16px;
}

.stat {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.label {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.calc-hint-btn {
  font-size: 12px;
  font-weight: 600;
  text-transform: none;
}

.value {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
}

.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
}

.muted {
  color: #64748b;
  font-weight: 600;
}

.health-explain {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #0f172a;
}

.health-explain .line {
  display: flex;
  gap: 10px;
}

.health-explain .k {
  width: 64px;
  flex: none;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.health-explain .v {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.deduct {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 8px;
}

.deduct .row {
  display: flex;
  gap: 10px;
}

.charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 380px;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font-weight: 700;
  color: #1a202c;
}

.chart-body {
  flex: 1;
  width: 100%;
  min-height: 320px;
}

@media (max-width: 1200px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .charts {
    grid-template-columns: 1fr;
  }
}
</style>
