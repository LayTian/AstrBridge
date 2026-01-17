const http = require('http')
const assert = require('assert')
const { spawn } = require('child_process')
const { WebSocketServer } = require('ws')

const request = ({ port, method, path, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(data
            ? {
                'Content-Type': 'application/json',
                'Content-Length': data.length
              }
            : {}),
          ...headers
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }))
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })

const waitForPort = async (port, child, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`)
    try {
      const res = await request({ port, method: 'GET', path: '/api/status' })
      if (res.status && res.status > 0) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timeout waiting for port ${port}`)
}

const readEnvFile = () => {
  const fs = require('fs')
  const env = {}
  const raw = fs.readFileSync('.env', 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const idx = l.indexOf('=')
    if (idx < 0) continue
    env[l.slice(0, idx)] = l.slice(idx + 1)
  }
  return env
}

const run = async () => {
  const env = readEnvFile()
  const port = 18081
  const astrPort = 19090

  const astr = new WebSocketServer({ host: '127.0.0.1', port: astrPort, path: '/ws' })
  astr.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let parsed
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        return
      }
      if (parsed?.post_type !== 'message' || !parsed?.user_id) return
      const userId = parsed?.user_id
      const text =
        parsed?.raw_message ||
        parsed?.message?.[0]?.data?.text ||
        ''
      const delayMs = String(text).includes('delay') ? 50 : 5
      setTimeout(() => {
        const msg = {
          action: 'send_private_msg',
          params: {
            user_id: userId,
            message: [{ type: 'text', data: { text: `echo:${text}` } }]
          },
          echo: { seq: Math.floor(Math.random() * 100000) }
        }
        ws.send(JSON.stringify(msg))
      }, delayMs)
    })
  })

  const child = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_USERNAME: env.ADMIN_USERNAME,
      ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      ADMIN_TOKEN_SECRET: env.ADMIN_TOKEN_SECRET,
      SUPER_ADMIN_KEY: env.SUPER_ADMIN_KEY,
      ASTRBOT_URL: `ws://127.0.0.1:${astrPort}/ws`,
      ASTRBOT_TOKEN: env.ASTRBOT_TOKEN || 'x',
      ASTRBOT_ID: env.ASTRBOT_ID || '123456789',
      INTEGRATION_SECRET: 'test-secret',
      SESSION_MAX_QUEUE_PER_USER: '2'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdoutTail = ''
  let stderrTail = ''
  child.stdout.on('data', (buf) => {
    stdoutTail = (stdoutTail + String(buf)).slice(-4000)
  })
  child.stderr.on('data', (buf) => {
    stderrTail = (stderrTail + String(buf)).slice(-4000)
  })

  try {
    await waitForPort(port, child)
    const integrationHeaders = { 'x-integration-secret': 'test-secret' }

    const req1 = request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '10001', text: 'm1', timeout_ms: 3000 }
    })
    const req2 = request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '10001', text: 'm2', timeout_ms: 3000 }
    })
    const [r1, r2] = await Promise.all([req1, req2])
    if (r1.status !== 200) {
      throw new Error(`request-reply r1 failed: status=${r1.status} body=${r1.body}`)
    }
    if (r2.status !== 200) {
      throw new Error(`request-reply r2 failed: status=${r2.status} body=${r2.body}`)
    }
    assert.strictEqual(r1.status, 200, r1.body)
    assert.strictEqual(r2.status, 200, r2.body)
    const b1 = JSON.parse(r1.body)
    const b2 = JSON.parse(r2.body)
    assert.ok(b1.request_id)
    assert.ok(b2.request_id)
    assert.notStrictEqual(b1.request_id, b2.request_id)
    assert.strictEqual(b1.reply?.payload?.metadata?.request_id, b1.request_id)
    assert.strictEqual(b2.reply?.payload?.metadata?.request_id, b2.request_id)

    const i1 = await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: { ...integrationHeaders, 'Idempotency-Key': 'idem-1' },
      body: { user_id: '10002', text: 'idem', timeout_ms: 3000 }
    })
    if (i1.status !== 200) {
      throw new Error(`idempotency i1 failed: status=${i1.status} body=${i1.body}`)
    }
    assert.strictEqual(i1.status, 200, i1.body)
    const i2 = await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: { ...integrationHeaders, 'Idempotency-Key': 'idem-1' },
      body: { user_id: '10002', text: 'idem', timeout_ms: 3000 }
    })
    if (i2.status !== 200) {
      throw new Error(`idempotency i2 failed: status=${i2.status} body=${i2.body}`)
    }
    assert.strictEqual(i2.status, 200, i2.body)
    const ib1 = JSON.parse(i1.body)
    const ib2 = JSON.parse(i2.body)
    assert.strictEqual(ib1.request_id, ib2.request_id)
    assert.deepStrictEqual(ib1.reply, ib2.reply)

    const t1 = await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '10003', text: 'delay', timeout_ms: 1 }
    })
    assert.strictEqual(t1.status, 504)

    await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '20001', text: 'q1', timeout_ms: 3000 }
    })
    await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '20001', text: 'q2', timeout_ms: 3000 }
    })
    await request({
      port,
      method: 'POST',
      path: '/api/integrations/webhook/request-reply',
      headers: integrationHeaders,
      body: { user_id: '20001', text: 'q3', timeout_ms: 3000 }
    })
    await request({
      port,
      method: 'GET',
      path: '/api/metrics'
    })
    const metricsRes = await request({ port, method: 'GET', path: '/api/metrics' })
    assert.strictEqual(metricsRes.status, 200)
    const metricsBody = JSON.parse(metricsRes.body)
    assert.ok(metricsBody.counters)
    assert.ok(metricsBody.histograms)
    assert.ok(metricsBody.counters.offline_drop_total >= 1)
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    throw new Error(`${msg}\n--- stdout ---\n${stdoutTail}\n--- stderr ---\n${stderrTail}`)
  } finally {
    child.kill()
    astr.close()
  }
}

run()
  .then(() => {
    process.stdout.write('smoke integrations ok\n')
    process.exit(0)
  })
  .catch((e) => {
    process.stderr.write(`smoke integrations failed: ${e && e.message ? e.message : String(e)}\n`)
    process.exit(1)
  })
