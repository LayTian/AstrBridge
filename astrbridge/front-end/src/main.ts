import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import axios from 'axios'
import fetchAdapter from 'axios/unsafe/adapters/fetch.js'
import xhrAdapter from 'axios/lib/adapters/xhr.js'
import { clearAuth, getToken, refreshAccessToken, shouldRefreshSoon } from './auth'

const app = createApp(App)

;(axios.defaults as any).adapter = fetchAdapter || xhrAdapter

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

let refreshInFlight: Promise<boolean> | null = null

const isAuthEndpoint = (url?: string) => {
  if (!url) return false
  return url.startsWith('/api/auth/')
}

axios.interceptors.request.use(async (config) => {
  if (isAuthEndpoint(config.url)) return config

  if (shouldRefreshSoon(15)) {
    refreshInFlight = refreshInFlight || refreshAccessToken()
    const ok = await refreshInFlight
    refreshInFlight = null
    if (!ok) {
      clearAuth()
      router.replace('/login')
      return Promise.reject(new Error('refresh_failed'))
    }
  }

  const token = getToken()
  if (token) {
    config.headers = config.headers || {}
    ;(config.headers as any).Authorization = `Bearer ${token}`
  }
  return config
})

axios.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status
    const cfg = err?.config
    if (status === 401 && cfg && !cfg._retry && !isAuthEndpoint(cfg.url)) {
      cfg._retry = true
      refreshInFlight = refreshInFlight || refreshAccessToken()
      const ok = await refreshInFlight
      refreshInFlight = null
      if (ok) {
        cfg.headers = cfg.headers || {}
        ;(cfg.headers as any).Authorization = `Bearer ${getToken()}`
        return axios(cfg)
      }
    }
    if (status === 401) {
      clearAuth()
      router.replace('/login')
    }
    return Promise.reject(err)
  }
)

app.use(ElementPlus)
app.use(router)
app.mount('#app')
