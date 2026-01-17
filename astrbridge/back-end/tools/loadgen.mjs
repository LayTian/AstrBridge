import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`))
  if (idx === -1) return fallback
  const v = args[idx]
  if (v.includes('=')) return v.slice(v.indexOf('=') + 1)
  const next = args[idx + 1]
  if (!next || next.startsWith('--')) return fallback
  return next
}

const base = (getArg('base', 'http://localhost:8080') || '').replace(/\/+$/, '')
const integrationId = getArg('id', 'demo')
const userId = getArg('user', 'loadgen')
const mode = getArg('mode', 'both')
const concurrency = Math.max(1, Number(getArg('concurrency', '6')) || 6)
const durationSec = Math.max(1, Number(getArg('duration', '30')) || 30)
const timeoutMs = Math.max(1, Number(getArg('timeoutMs', '15000')) || 15000)
const secret = getArg('secret', process.env.INTEGRATION_SECRET || '')
const text = getArg('text', 'ping')
const sampleDelayEvery = Math.max(0, Number(getArg('sampleDelayEvery', '0')) || 0)
const delayText = getArg('delayText', 'delay')

if (typeof fetch !== 'function') {
  console.error('This script requires Node.js with global fetch support.')
  process.exit(1)
}

const headers = {
  'content-type': 'application/json',
  ...(secret ? { 'x-integration-secret': secret } : {})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const now = () => Date.now()

const counters = {
  startedAt: now(),
  events: { sent: 0, ok: 0, failed: 0 },
  rr: { sent: 0, ok: 0, timeout: 0, failed: 0, latMs: [] }
}

const pushLat = (v) => {
  const arr = counters.rr.latMs
  arr.push(v)
  if (arr.length > 5000) arr.splice(0, arr.length - 5000)
}

const pct = (arr, p) => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))
  return sorted[idx] || 0
}

const postJson = async (url, body) => {
  const started = now()
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const ms = now() - started
  let data
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { res, ms, data }
}

const eventsOnce = async (i) => {
  counters.events.sent++
  const t =
    sampleDelayEvery > 0 && i > 0 && i % sampleDelayEvery === 0 ? `${text} ${delayText} ${randomUUID()}` : `${text} ${randomUUID()}`
  const { res } = await postJson(`${base}/api/integrations/${encodeURIComponent(integrationId)}/events`, { user_id: userId, text: t })
  if (res.ok) counters.events.ok++
  else counters.events.failed++
}

const requestReplyOnce = async (i) => {
  counters.rr.sent++
  const t =
    sampleDelayEvery > 0 && i > 0 && i % sampleDelayEvery === 0 ? `${text} ${delayText} ${randomUUID()}` : `${text} ${randomUUID()}`
  const { res, ms, data } = await postJson(`${base}/api/integrations/${encodeURIComponent(integrationId)}/request-reply`, {
    user_id: userId,
    text: t,
    timeout_ms: timeoutMs
  })
  pushLat(ms)
  if (res.status === 504 || data?.error === 'timeout') counters.rr.timeout++
  else if (res.ok) counters.rr.ok++
  else counters.rr.failed++
}

const worker = async (workerId, endAt) => {
  let i = 0
  while (now() < endAt) {
    i++
    try {
      if (mode === 'events') await eventsOnce(i)
      else if (mode === 'request-reply') await requestReplyOnce(i)
      else {
        if (i % 2 === 0) await eventsOnce(i)
        else await requestReplyOnce(i)
      }
    } catch {
      if (mode === 'events') counters.events.failed++
      else counters.rr.failed++
    }
    if (workerId === 0) await sleep(0)
  }
}

const formatRate = (n, sec) => (sec > 0 ? (n / sec).toFixed(2) : '0.00')

const main = async () => {
  const endAt = counters.startedAt + durationSec * 1000
  console.log(
    JSON.stringify(
      {
        base,
        integrationId,
        userId,
        mode,
        concurrency,
        durationSec,
        timeoutMs,
        secret: secret ? 'set' : 'empty'
      },
      null,
      2
    )
  )

  const timer = setInterval(async () => {
    const elapsed = (now() - counters.startedAt) / 1000
    const p50 = pct(counters.rr.latMs, 50)
    const p95 = pct(counters.rr.latMs, 95)
    const p99 = pct(counters.rr.latMs, 99)
    process.stdout.write(
      `t=${elapsed.toFixed(1)}s | events ${counters.events.ok}/${counters.events.sent} ok (${formatRate(counters.events.sent, elapsed)} rps)` +
        ` | rr ok=${counters.rr.ok} timeout=${counters.rr.timeout} fail=${counters.rr.failed} sent=${counters.rr.sent}` +
        ` | rr-lat p50=${p50.toFixed(0)} p95=${p95.toFixed(0)} p99=${p99.toFixed(0)} ms\n`
    )
    try {
      const snap = await fetch(`${base}/api/metrics`).then((r) => r.json())
      const ev = Number(snap?.counters?.integrations_events_total) || 0
      const rr = Number(snap?.counters?.integrations_request_reply_total) || 0
      const p50m = Number(snap?.histograms?.request_reply_latency_ms?.p50) || 0
      const p99m = Number(snap?.histograms?.request_reply_latency_ms?.p99) || 0
      process.stdout.write(`metrics | events_total=${ev} request_reply_total=${rr} latency_p50=${p50m} latency_p99=${p99m}\n`)
    } catch {}
  }, 1000)

  const tasks = Array.from({ length: concurrency }, (_, idx) => worker(idx, endAt))
  await Promise.all(tasks)
  clearInterval(timer)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

