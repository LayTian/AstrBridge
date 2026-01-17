<template>
  <div class="page">
    <div class="card">
      <div class="brand">
        <div class="logo">A</div>
        <div class="titles">
          <div class="title">AstrBridge Admin</div>
          <div class="subtitle">请输入账号密码登录</div>
        </div>
      </div>

      <el-form @submit.prevent>
        <el-form-item label="账号">
          <el-input v-model="username" autocomplete="username" placeholder="admin" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="password" type="password" show-password autocomplete="current-password" placeholder="password" />
        </el-form-item>
        <el-form-item label="超级密钥">
          <el-input v-model="superKey" type="password" show-password autocomplete="off" placeholder="可选" />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            :disabled="!username.trim() || !password.trim()"
            @click="login"
            style="width: 100%"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="hint">
        <span>后端需要配置 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_TOKEN_SECRET。</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { clearAuth, isAuthed, refreshAccessToken, setAuth } from '../auth'

const router = useRouter()
const username = ref('')
const password = ref('')
const superKey = ref('')
const loading = ref(false)

const login = async () => {
  const u = username.value.trim()
  const p = password.value.trim()
  const sk = superKey.value.trim()
  if (!u || !p) return
  loading.value = true
  try {
    const res = await axios.post('/api/auth/login', { username: u, password: p, super_key: sk || undefined })
    const accessToken = res.data?.access_token
    const expiresAt = res.data?.expires_at
    const role = res.data?.role
    if (!accessToken || !expiresAt) {
      ElMessage.error('登录失败')
      return
    }
    setAuth(String(accessToken), Number(expiresAt), role === 'super_admin' ? 'super_admin' : 'admin')
    ElMessage.success('登录成功')
    router.replace('/')
  } catch (e: any) {
    const status = e?.response?.status
    const code = e?.response?.data?.error
    if (status === 503 && code === 'auth_not_configured') {
      ElMessage.error('服务端未配置登录（请设置 ADMIN_USERNAME/ADMIN_PASSWORD/ADMIN_TOKEN_SECRET）')
      return
    }
    if (status === 401) {
      ElMessage.error('账号或密码错误')
      return
    }
    ElMessage.error('登录失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (isAuthed()) {
    router.replace('/')
    return
  }
  const ok = await refreshAccessToken()
  if (ok) {
    router.replace('/')
    return
  }
  clearAuth()
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(circle at 10% 10%, #c7d2fe 0%, transparent 40%),
    radial-gradient(circle at 90% 20%, #fbcfe8 0%, transparent 45%),
    radial-gradient(circle at 50% 90%, #bbf7d0 0%, transparent 50%),
    #0b1220;
}

.card {
  width: 460px;
  max-width: 100%;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  padding: 22px 22px 18px;
}

.brand {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
}

.logo {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 900;
  font-size: 20px;
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 18px;
  font-weight: 900;
  color: #0f172a;
}

.subtitle {
  color: #64748b;
  font-size: 13px;
}

.hint {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
}
</style>
