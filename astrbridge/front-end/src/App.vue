<template>
  <router-view v-if="isLogin" />
  <el-container v-else class="layout-container">
    <!-- 侧边栏：深色沉浸式 -->
    <el-aside width="260px" class="sidebar">
      <div class="logo-area">
        <div class="logo-icon">
          <el-icon :size="24" color="#fff"><Connection /></el-icon>
        </div>
        <div class="logo-text">
          <h1>AstrBridge<span>Ops</span></h1>
          <p class="version">v1.2.0 Enterprise</p>
        </div>
      </div>
      
      <div class="menu-wrapper">
        <el-menu 
          :default-active="activeMenu"
          class="custom-menu"
          background-color="transparent"
          text-color="#a0aec0"
          active-text-color="#fff"
          router
        >
          <div class="menu-group-title">数据监控</div>
          <el-menu-item index="/">
            <el-icon><Monitor /></el-icon>
            <span>仪表盘</span>
          </el-menu-item>
          <el-menu-item index="/health">
            <el-icon><Connection /></el-icon>
            <span>数据分析</span>
          </el-menu-item>
          <el-menu-item index="/logs">
            <el-icon><Document /></el-icon>
            <span>实时日志</span>
          </el-menu-item>
          <el-menu-item index="/audit">
            <el-icon><Document /></el-icon>
            <span>审计日志</span>
          </el-menu-item>

          <div class="menu-group-title">系统管理</div>
          <el-menu-item index="/sessions">
            <el-icon><User /></el-icon>
            <span>会话管理</span>
          </el-menu-item>
          <el-menu-item index="/console">
            <el-icon><Document /></el-icon>
            <span>消息测试台</span>
          </el-menu-item>
          <el-menu-item index="/integrations">
            <el-icon><Connection /></el-icon>
            <span>接入中心</span>
          </el-menu-item>
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon>
            <span>设置</span>
          </el-menu-item>
        </el-menu>
      </div>

    </el-aside>
    
    <el-container class="main-wrapper">
      <!-- 顶栏：极简浮动 -->
      <el-header class="top-header">
        <div class="header-left">
          <h2 class="page-title">{{ currentPageName }}</h2>
        </div>
        <div class="header-right">
          <div class="status-badge">
            <span class="dot"></span>
            系统在线
          </div>
          <div class="divider"></div>
          <span class="uptime">UPTIME: {{ formatUptime(status.uptime) }}</span>
        </div>
      </el-header>
      
      <el-main class="content-area">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Monitor, User, Document, Connection, Setting } from '@element-plus/icons-vue'
import axios from 'axios'

const route = useRoute()
const status = ref({ uptime: 0 })

const activeMenu = computed(() => route.path)
const isLogin = computed(() => route.path === '/login')

const currentPageName = computed(() => {
  const nameMap: Record<string, string> = {
    'Dashboard': '系统概览',
    'Analytics': '数据分析',
    'Sessions': '会话管理',
    'Console': '消息测试台',
    'Integrations': '接入中心',
    'Logs': '运行日志',
    'Audit': '审计日志',
    'Settings': '设置'
  }
  return nameMap[route.name as string] || 'Dashboard'
})

const formatUptime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

const fetchGlobalStatus = async () => {
  if (isLogin.value) return
  try {
    const res = await axios.get('/api/status')
    status.value.uptime = res.data.uptime
  } catch {}
}

onMounted(() => {
  fetchGlobalStatus()
  setInterval(fetchGlobalStatus, 10000)
})
</script>

<style>
/* Global Reset */
body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #f8f9fc;
  color: #2d3748;
}

.layout-container {
  height: 100vh;
  display: flex;
}

/* Sidebar Styling */
.sidebar {
  background: #1a202c;
  color: white;
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 24px rgba(0,0,0,0.05);
  z-index: 10;
}

.logo-area {
  height: 80px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.logo-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(118, 75, 162, 0.4);
}

.logo-text h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}

.logo-text span {
  color: #a0aec0;
  font-weight: 400;
}

.version {
  margin: 0;
  font-size: 10px;
  color: #718096;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.menu-wrapper {
  flex: 1;
  padding: 24px 0;
  overflow-y: auto;
}

.menu-group-title {
  padding: 0 24px;
  margin-bottom: 8px;
  margin-top: 24px;
  font-size: 11px;
  font-weight: 700;
  color: #4a5568;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.menu-group-title:first-child {
  margin-top: 0;
}

.custom-menu {
  border: none !important;
}

.el-menu-item {
  height: 50px;
  line-height: 50px;
  margin: 4px 16px;
  border-radius: 8px;
  border: none !important;
}

.el-menu-item.is-active {
  background: #2d3748 !important;
  color: #fff !important;
  font-weight: 600;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.el-menu-item:hover {
  background: rgba(255,255,255,0.05) !important;
}

/* Main Area Styling */
.main-wrapper {
  background: #f8f9fc;
  display: flex;
  flex-direction: column;
}

.top-header {
  height: 80px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 40px;
  background: transparent;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #1a202c;
  letter-spacing: -0.5px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
  background: #fff;
  padding: 8px 16px;
  border-radius: 30px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.02);
  border: 1px solid #edf2f7;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #48bb78;
}

.status-badge .dot {
  width: 8px;
  height: 8px;
  background: #48bb78;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(72, 187, 120, 0.2);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(72, 187, 120, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(72, 187, 120, 0); }
  100% { box-shadow: 0 0 0 0 rgba(72, 187, 120, 0); }
}

.divider {
  width: 1px;
  height: 16px;
  background: #e2e8f0;
}

.uptime {
  font-size: 12px;
  font-weight: 600;
  color: #a0aec0;
  font-family: 'JetBrains Mono', monospace;
}

.content-area {
  padding: 0 40px 40px;
  overflow-y: auto;
}
</style>
