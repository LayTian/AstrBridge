<template>
  <div class="page">
    <div class="header glass-panel">
      <div class="left">
        <h3>设置</h3>
        <el-tag size="small" type="info" effect="plain">本地配置</el-tag>
      </div>
    </div>

    <div class="grid">
      <div class="card glass-panel">
        <div class="card-title">适配器地址</div>
        <el-form label-position="top">
          <el-form-item label="HTTP/WS Host">
            <el-input v-model="adapterHost" placeholder="例如 localhost:8080" />
          </el-form-item>
          <el-form-item>
            <el-alert
              title="用于“消息测试台”和接入中心的链接推导。默认是当前站点 hostname:8080。"
              type="info"
              :closable="false"
              show-icon
            />
          </el-form-item>
        </el-form>
      </div>

      <div class="card glass-panel">
        <div class="card-title">user_id 策略</div>
        <el-form label-position="top">
          <el-form-item label="当前 user_id（会写入 localStorage）">
            <el-input v-model="userId" />
          </el-form-item>
          <div class="actions">
            <el-button type="primary" plain @click="generateUserId">生成新的 10 位数字</el-button>
            <el-button type="danger" plain @click="clearUserId">清空</el-button>
          </div>
          <el-form-item class="mt-2">
            <el-alert
              title="OneBot v11 的 user_id 语义上是 number。建议使用纯数字字符串；不同站点/用户请确保映射稳定且不冲突。"
              type="warning"
              :closable="false"
              show-icon
            />
          </el-form-item>
        </el-form>
      </div>

      <div class="card glass-panel">
        <div class="card-title">服务端配置</div>
        <el-form label-position="top">
          <el-form-item label="ASTRBOT_URL">
            <el-input v-model="astrbotUrl" :disabled="!isSuperAdmin" placeholder="ws://host:port/ws" />
          </el-form-item>
          <el-form-item label="ASTRBOT_ID">
            <el-input v-model="astrbotId" :disabled="!isSuperAdmin" placeholder="123456789" />
          </el-form-item>
          <el-form-item label="ASTRBOT_TOKEN">
            <el-input v-model="astrbotToken" :disabled="!isSuperAdmin" type="password" show-password placeholder="可选更新" />
          </el-form-item>
          <div class="actions">
            <el-button type="primary" :disabled="!isSuperAdmin" :loading="saving" @click="saveServerConfig">保存并重连</el-button>
            <el-tag v-if="!isSuperAdmin" type="info" effect="plain" size="small">仅超级管理员可修改</el-tag>
          </div>
        </el-form>
      </div>

      <div class="card glass-panel">
        <div class="card-title">清理缓存</div>
        <div class="actions">
          <el-button type="danger" plain @click="resetAll">重置本地配置</el-button>
          <el-button type="danger" @click="logout">退出登录</el-button>
        </div>
        <div class="hint">会清空本页使用的 localStorage key（不影响浏览器其它数据）。</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { clearAuth, getRole } from '../auth'
import axios from 'axios'

const STORAGE_ADAPTER_HOST = 'adapter_admin_host'
const STORAGE_USER_ID = 'adapter_user_id'

const adapterHost = ref('')
const userId = ref('')
const router = useRouter()
const isSuperAdmin = computed(() => getRole() === 'super_admin')

const astrbotUrl = ref('')
const astrbotId = ref('')
const astrbotToken = ref('')
const saving = ref(false)

const host = computed(() => (globalThis as any).location?.hostname || 'localhost')
const defaultHost = () => `${host.value}:8080`

const generateUserId = () => {
  const created = String(1000000000 + Math.floor(Math.random() * 9000000000))
  userId.value = created
  ElMessage.success('已生成新的 user_id')
}

const clearUserId = () => {
  userId.value = ''
  ElMessage.success('已清空 user_id')
}

const resetAll = () => {
  try {
    globalThis.localStorage?.removeItem(STORAGE_ADAPTER_HOST)
    globalThis.localStorage?.removeItem(STORAGE_USER_ID)
  } catch {}
  adapterHost.value = defaultHost()
  userId.value = ''
  ElMessage.success('已重置本地配置')
}

const logout = () => {
  axios.post('/api/auth/logout').catch(() => {})
  clearAuth()
  ElMessage.success('已退出')
  router.replace('/login')
}

const loadServerConfig = async () => {
  try {
    const res = await axios.get('/api/admin/config')
    const data = res.data?.data || {}
    astrbotUrl.value = data.ASTRBOT_URL || ''
    astrbotId.value = data.ASTRBOT_ID || ''
    astrbotToken.value = ''
  } catch {}
}

const saveServerConfig = async () => {
  if (!isSuperAdmin.value) return
  saving.value = true
  try {
    const payload: any = {}
    if (astrbotUrl.value.trim()) payload.ASTRBOT_URL = astrbotUrl.value.trim()
    if (astrbotId.value.trim()) payload.ASTRBOT_ID = astrbotId.value.trim()
    if (astrbotToken.value.trim()) payload.ASTRBOT_TOKEN = astrbotToken.value.trim()
    await axios.post('/api/admin/config', payload)
    astrbotToken.value = ''
    ElMessage.success('已保存并触发重连')
  } catch (e: any) {
    const status = e?.response?.status
    ElMessage.error(status === 403 ? '无权限' : '保存失败')
  } finally {
    saving.value = false
  }
}

watch(adapterHost, (v) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_ADAPTER_HOST, v)
  } catch {}
})

watch(userId, (v) => {
  try {
    globalThis.localStorage?.setItem(STORAGE_USER_ID, v)
  } catch {}
})

onMounted(() => {
  try {
    adapterHost.value = globalThis.localStorage?.getItem(STORAGE_ADAPTER_HOST) || defaultHost()
  } catch {
    adapterHost.value = defaultHost()
  }
  try {
    userId.value = globalThis.localStorage?.getItem(STORAGE_USER_ID) || ''
  } catch {
    userId.value = ''
  }
  loadServerConfig()
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

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  font-weight: 700;
  color: #1a202c;
}

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hint {
  color: #64748b;
  font-size: 12px;
}

.mt-2 {
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
