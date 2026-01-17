<template>
  <div class="page">
    <div class="header glass-panel">
      <div class="left">
        <h3>审计日志</h3>
        <el-tag size="small" type="info" effect="plain">管理员操作记录</el-tag>
      </div>
      <div class="right">
        <el-button :icon="Refresh" circle @click="refresh" :loading="loading" />
        <el-button @click="exportJson" :disabled="rows.length === 0">导出</el-button>
      </div>
    </div>

    <div class="filters glass-panel">
      <el-input v-model="q" placeholder="关键词（用户/动作/目标/详情）" clearable />
      <el-select v-model="action" placeholder="动作" clearable style="width: 180px">
        <el-option label="登录" value="login" />
        <el-option label="续签" value="refresh" />
        <el-option label="退出登录" value="logout" />
        <el-option label="强制下线" value="kick" />
        <el-option label="修改配置" value="config_update" />
      </el-select>
      <el-input v-model="actor" placeholder="操作者（username）" clearable style="width: 180px" />
      <el-button type="primary" @click="refresh" :loading="loading">查询</el-button>
    </div>

    <div class="table glass-panel">
      <el-table :data="rows" height="560">
        <el-table-column prop="time" label="时间" width="110" />
        <el-table-column prop="actor" label="操作者" width="140" />
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <el-tag :type="row.role === 'super_admin' ? 'danger' : 'info'" effect="light">
              {{ roleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="160">
          <template #default="{ row }">
            {{ actionLabel(row.action) }}
          </template>
        </el-table-column>
        <el-table-column label="目标" width="140">
          <template #default="{ row }">
            {{ formatTarget(row) }}
          </template>
        </el-table-column>
        <el-table-column label="结果" width="120">
          <template #default="{ row }">
            <el-tag :type="row.result === 'ok' ? 'success' : 'warning'" effect="light">
              {{ resultLabel(row.result) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="详情">
          <template #default="{ row }">
            {{ detailLabel(row.detail) }}
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { Refresh } from '@element-plus/icons-vue'

type AuditRow = {
  ts: number
  time: string
  actor: string
  role: string
  action: string
  target?: string
  ip?: string
  result: string
  detail?: string
}

const loading = ref(false)
const q = ref('')
const action = ref<string | undefined>(undefined)
const actor = ref('')
const rows = ref<AuditRow[]>([])

const roleLabel = (role: string) => {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'admin') return '普通管理员'
  return role || '-'
}

const actionLabel = (act: string) => {
  const map: Record<string, string> = {
    login: '登录',
    refresh: '续签',
    logout: '退出登录',
    kick: '强制下线',
    config_update: '修改配置'
  }
  return map[act] || act || '-'
}

const resultLabel = (r: string) => {
  if (r === 'ok') return '成功'
  if (r === 'failed') return '失败'
  return r || '-'
}

const detailLabel = (d?: string) => {
  if (!d) return ''
  const map: Record<string, string> = {
    auth_not_configured: '服务端未配置登录',
    invalid_params: '参数不合法',
    invalid_credentials: '账号或密码错误',
    missing_cookie: '缺少刷新令牌 Cookie',
    invalid_kind: '令牌类型不正确',
    expired: '令牌已过期',
    invalid_signature: '令牌签名校验失败',
    invalid_token: '令牌格式不正确',
    invalid_payload: '令牌载荷不合法',
    forbidden: '无权限'
  }
  return map[d] || d
}

const formatTarget = (row: AuditRow) => {
  if (row.action === 'kick' && row.target) return `用户 ${row.target}`
  return row.target || ''
}

const refresh = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/audit/recent', {
      params: {
        limit: 500,
        q: q.value.trim() || undefined,
        action: action.value || undefined,
        actor: actor.value.trim() || undefined
      }
    })
    rows.value = res.data?.data || []
  } finally {
    loading.value = false
  }
}

const exportJson = () => {
  const blob = new Blob([JSON.stringify(rows.value, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(refresh)
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

.right {
  display: flex;
  gap: 10px;
  align-items: center;
}

.filters {
  padding: 14px 16px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.table {
  padding: 16px;
}
</style>
