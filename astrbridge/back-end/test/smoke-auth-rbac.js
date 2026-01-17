const http = require('http')
const assert = require('assert')
const { spawn } = require('child_process')

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
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode}`)
    }
    try {
      const res = await request({ port, method: 'GET', path: '/' })
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
  const port = 18080

  const child = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(port) },
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

    const loginAdmin = await request({
      port,
      method: 'POST',
      path: '/api/auth/login',
      body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }
    })
    assert.strictEqual(loginAdmin.status, 200)
    const adminBody = JSON.parse(loginAdmin.body)
    assert.ok(adminBody.access_token)
    assert.ok(adminBody.expires_at)
    assert.strictEqual(adminBody.role, 'admin')
    const adminAccess = adminBody.access_token

    const refreshCookie = (loginAdmin.headers['set-cookie'] || []).find((x) => String(x).includes('refresh_token='))
    assert.ok(refreshCookie)

    const refreshRes = await request({
      port,
      method: 'POST',
      path: '/api/auth/refresh',
      headers: { Cookie: refreshCookie }
    })
    assert.strictEqual(refreshRes.status, 200)
    const refreshBody = JSON.parse(refreshRes.body)
    assert.ok(refreshBody.access_token)

    const adminKick = await request({
      port,
      method: 'POST',
      path: '/api/sessions/1/kick',
      headers: { Authorization: `Bearer ${adminAccess}` }
    })
    assert.strictEqual(adminKick.status, 403)

    const adminCfg = await request({
      port,
      method: 'POST',
      path: '/api/admin/config',
      headers: { Authorization: `Bearer ${adminAccess}` },
      body: { ASTRBOT_URL: env.ASTRBOT_URL }
    })
    assert.strictEqual(adminCfg.status, 403)

    const loginSuper = await request({
      port,
      method: 'POST',
      path: '/api/auth/login',
      body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, super_key: env.SUPER_ADMIN_KEY }
    })
    assert.strictEqual(loginSuper.status, 200)
    const superBody = JSON.parse(loginSuper.body)
    assert.strictEqual(superBody.role, 'super_admin')
    const superAccess = superBody.access_token

    const superCfg = await request({
      port,
      method: 'POST',
      path: '/api/admin/config',
      headers: { Authorization: `Bearer ${superAccess}` },
      body: { ASTRBOT_URL: env.ASTRBOT_URL }
    })
    assert.strictEqual(superCfg.status, 200)

    const superKick = await request({
      port,
      method: 'POST',
      path: '/api/sessions/1/kick',
      headers: { Authorization: `Bearer ${superAccess}` }
    })
    assert.strictEqual(superKick.status, 200)

    const audit = await request({
      port,
      method: 'GET',
      path: '/api/audit/recent?limit=10',
      headers: { Authorization: `Bearer ${superAccess}` }
    })
    assert.strictEqual(audit.status, 200)
    const auditBody = JSON.parse(audit.body)
    assert.ok(Array.isArray(auditBody.data))
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    throw new Error(`${msg}\n--- stdout ---\n${stdoutTail}\n--- stderr ---\n${stderrTail}`)
  } finally {
    child.kill()
  }
}

run()
  .then(() => {
    process.stdout.write('smoke ok\n')
    process.exit(0)
  })
  .catch((e) => {
    process.stderr.write(`smoke failed: ${e && e.message ? e.message : String(e)}\n`)
    process.exit(1)
  })
