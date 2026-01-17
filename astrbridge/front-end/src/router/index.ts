import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Sessions from '../views/Sessions.vue'
import Logs from '../views/Logs.vue'
import Analytics from '../views/Analytics.vue'
import Console from '../views/Console.vue'
import Integrations from '../views/Integrations.vue'
import Settings from '../views/Settings.vue'
import Login from '../views/Login.vue'
import Audit from '../views/Audit.vue'
import { isAuthed, refreshAccessToken } from '../auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login
  },
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard
  },
  {
    path: '/health',
    name: 'Analytics',
    component: Analytics
  },
  {
    path: '/sessions',
    name: 'Sessions',
    component: Sessions
  },
  {
    path: '/console',
    name: 'Console',
    component: Console
  },
  {
    path: '/integrations',
    name: 'Integrations',
    component: Integrations
  },
  {
    path: '/logs',
    name: 'Logs',
    component: Logs
  },
  {
    path: '/audit',
    name: 'Audit',
    component: Audit
  },
  {
    path: '/settings',
    name: 'Settings',
    component: Settings
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.path === '/login') return true
  if (isAuthed()) return true
  const ok = await refreshAccessToken()
  if (ok) return true
  return { path: '/login' }
})

export default router
