import axios from 'axios'

const TOKEN_KEY = 'admin_access_token'
const EXPIRES_AT_KEY = 'admin_access_token_expires_at'
const ROLE_KEY = 'admin_role'

export type AdminRole = 'admin' | 'super_admin'

export const getToken = (): string | null => {
  try {
    const raw = (globalThis as any).localStorage?.getItem(TOKEN_KEY)
    if (!raw) return null
    return String(raw)
  } catch {
    return null
  }
}

export const getExpiresAt = (): number | null => {
  try {
    const raw = (globalThis as any).localStorage?.getItem(EXPIRES_AT_KEY)
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return n
  } catch {
    return null
  }
}

export const getRole = (): AdminRole | null => {
  try {
    const raw = (globalThis as any).localStorage?.getItem(ROLE_KEY)
    if (!raw) return null
    return raw === 'super_admin' ? 'super_admin' : 'admin'
  } catch {
    return null
  }
}

export const setAuth = (token: string, expiresAt: number, role: AdminRole) => {
  try {
    ;(globalThis as any).localStorage?.setItem(TOKEN_KEY, token)
    ;(globalThis as any).localStorage?.setItem(EXPIRES_AT_KEY, String(expiresAt))
    ;(globalThis as any).localStorage?.setItem(ROLE_KEY, role)
  } catch {}
}

export const clearAuth = () => {
  try {
    ;(globalThis as any).localStorage?.removeItem(TOKEN_KEY)
    ;(globalThis as any).localStorage?.removeItem(EXPIRES_AT_KEY)
    ;(globalThis as any).localStorage?.removeItem(ROLE_KEY)
  } catch {}
}

export const isAuthed = () => {
  const t = getToken()
  if (!t) return false
  const exp = getExpiresAt()
  if (!exp) return true
  const now = Math.floor(Date.now() / 1000)
  return exp > now
}

export const isExpired = () => {
  const exp = getExpiresAt()
  if (!exp) return false
  const now = Math.floor(Date.now() / 1000)
  return exp <= now
}

export const shouldRefreshSoon = (skewSeconds = 30) => {
  const exp = getExpiresAt()
  if (!exp) return false
  const now = Math.floor(Date.now() / 1000)
  return exp <= now + Math.max(0, Math.floor(skewSeconds))
}

export const refreshAccessToken = async (): Promise<boolean> => {
  const client = axios.create({ withCredentials: true })
  try {
    const res = await client.post('/api/auth/refresh')
    const accessToken = res.data?.access_token
    const expiresAt = res.data?.expires_at
    const role = res.data?.role
    if (!accessToken || !expiresAt) return false
    setAuth(String(accessToken), Number(expiresAt), role === 'super_admin' ? 'super_admin' : 'admin')
    return true
  } catch {
    return false
  }
}
