<template>
  <div class="page-container">
    <!-- 顶部操作栏 -->
    <div class="action-bar glass-panel">
      <div class="left">
        <el-input
          v-model="searchQuery"
          placeholder="搜索用户 ID..."
          prefix-icon="Search"
          class="search-input"
          clearable
        />
        <el-select v-model="filterStatus" placeholder="状态筛选" style="width: 120px">
          <el-option label="全部" value="all" />
          <el-option label="在线" value="online" />
          <el-option label="离线" value="offline" />
        </el-select>
      </div>
      <div class="right">
        <el-button
          type="danger"
          plain
          icon="Delete"
          :disabled="!isSuperAdmin || offlineCount === 0"
          @click="clearOfflineSessions"
        >
          清理离线会话
        </el-button>
        <el-button type="primary" icon="Refresh" @click="fetchSessions" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- 用户卡片网格 -->
    <div class="session-grid" v-loading="loading">
      <div 
        v-for="session in filteredSessions" 
        :key="session.userId" 
        class="user-card"
        :class="{ 'is-offline': !session.online }"
      >
        <div class="card-header">
          <div class="avatar-wrapper">
            <el-avatar :size="48" :icon="UserFilled" class="user-avatar" :class="{ online: session.online }" />
            <div class="status-indicator" :class="{ online: session.online }"></div>
          </div>
          <div class="user-info">
            <div class="user-id">用户 {{ session.userId }}</div>
            <div class="last-seen">{{ session.lastActiveTime }}</div>
          </div>
          <el-dropdown trigger="click">
            <el-button circle plain :icon="More" size="small" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :icon="Message" @click="openConsole(session.userId)">发送消息</el-dropdown-item>
                <el-dropdown-item
                  v-if="isSuperAdmin"
                  :icon="Delete"
                  divided
                  class="text-danger"
                  @click="kick(session.userId)"
                >
                  强制下线
                </el-dropdown-item>
                <el-dropdown-item v-else :icon="Delete" divided disabled>强制下线（无权限）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <div class="card-body">
          <div class="stat-row">
            <span class="label">积压消息</span>
            <el-tag size="small" :type="session.queueSize > 0 ? 'danger' : 'info'" effect="light" round>
              {{ session.queueSize }} 条
            </el-tag>
          </div>
          <div class="stat-row">
            <span class="label">连接状态</span>
            <span class="value" :class="session.online ? 'text-green' : 'text-gray'">
              {{ session.online ? '活跃中' : '已断开' }}
            </span>
          </div>
        </div>

        <div class="card-footer">
          <el-button type="primary" text bg size="small" class="action-btn" @click="openDetails(session)">
            查看详情
          </el-button>
        </div>
      </div>

      <!-- 空状态 -->
      <el-empty 
        v-if="filteredSessions.length === 0" 
        description="暂无相关会话" 
        class="empty-placeholder"
      />
    </div>

    <el-dialog v-model="detailsVisible" title="会话详情" width="520px">
      <el-descriptions v-if="selectedSession" :column="1" border>
        <el-descriptions-item label="用户 ID">{{ selectedSession.userId }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="selectedSession.online ? 'success' : 'info'" effect="light">
            {{ selectedSession.online ? '在线' : '离线' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="积压消息">{{ selectedSession.queueSize }}</el-descriptions-item>
        <el-descriptions-item label="最后活跃">{{ selectedSession.lastActiveTime }}</el-descriptions-item>
        <el-descriptions-item label="来源标识">
          <el-tag v-if="selectedSession.lastSessionId" type="info" effect="light">
            {{ selectedSession.lastSessionId }}
          </el-tag>
          <span v-else class="muted">暂无</span>
        </el-descriptions-item>
        <el-descriptions-item label="最近消息时间">
          <span v-if="selectedSession.lastMessageTime">{{ selectedSession.lastMessageTime }}</span>
          <span v-else class="muted">暂无</span>
        </el-descriptions-item>
        <el-descriptions-item label="最近消息预览">
          <span v-if="selectedSession.lastMessageText">{{ selectedSession.lastMessageText }}</span>
          <span v-else class="muted">暂无</span>
        </el-descriptions-item>
      </el-descriptions>

      <template #footer>
        <div class="dialog-footer">
          <el-space wrap :size="10" alignment="center">
            <el-button @click="detailsVisible = false">关闭</el-button>
            <el-tooltip content="使用该用户 ID 在消息测试台发起测试消息" placement="top">
              <span>
                <el-button type="primary" plain @click="selectedSession && openConsole(selectedSession.userId)">
                  去测试台发消息
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              v-if="isSuperAdmin && selectedSession"
              type="danger"
              plain
              :disabled="!selectedSession.online"
              @click="kick(selectedSession.userId)"
            >
              强制下线
            </el-button>
          </el-space>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { UserFilled, More, Message, Delete } from '@element-plus/icons-vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getRole } from '../auth'
import { useRouter } from 'vue-router'

interface Session {
  userId: string;
  online: boolean;
  queueSize: number;
  lastActiveTime: string;
  lastMessageText?: string;
  lastMessageTime?: string;
  lastSessionId?: string;
}

const loading = ref(false)
const searchQuery = ref('')
const filterStatus = ref('all')
const sessions = ref<Session[]>([])
const isSuperAdmin = computed(() => getRole() === 'super_admin')
const offlineCount = computed(() => sessions.value.filter((s) => !s.online).length)

const router = useRouter()
const detailsVisible = ref(false)
const selectedSession = ref<Session | null>(null)

const filteredSessions = computed(() => {
  return sessions.value.filter(s => {
    const matchId = s.userId.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchStatus = filterStatus.value === 'all' 
      ? true 
      : (filterStatus.value === 'online' ? s.online : !s.online)
    return matchId && matchStatus
  })
})

const fetchSessions = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/sessions')
    sessions.value = res.data?.data || []
    if (detailsVisible.value && selectedSession.value) {
      const latest = sessions.value.find((s) => s.userId === selectedSession.value?.userId) || null
      selectedSession.value = latest
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const openDetails = (session: Session) => {
  selectedSession.value = session
  detailsVisible.value = true
}

const openConsole = (userId: string) => {
  router.push({ path: '/console', query: { user_id: userId } })
}

const clearOfflineSessions = async () => {
  if (!isSuperAdmin.value) {
    ElMessage.warning('无权限')
    return
  }
  try {
    await ElMessageBox.confirm(`确认清理所有离线会话？（共 ${offlineCount.value} 个）`, '高危操作', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    const res = await axios.post('/api/sessions/offline/clear')
    ElMessage.success(`已清理 ${res.data?.cleared ?? 0} 个离线会话`)
    fetchSessions()
  } catch {
    ElMessage.error('操作失败或无权限')
  }
}

const kick = async (userId: string) => {
  try {
    await ElMessageBox.confirm(`确认强制下线用户 ${userId}？`, '高危操作', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    await axios.post(`/api/sessions/${encodeURIComponent(userId)}/kick`)
    ElMessage.success('已下线')
    fetchSessions()
  } catch {
    ElMessage.error('操作失败或无权限')
  }
}

onMounted(fetchSessions)

let poller: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  poller = setInterval(fetchSessions, 3000)
})

onUnmounted(() => {
  if (poller != null) clearInterval(poller)
  poller = null
})
</script>

<style scoped>
.page-container {
  padding: 0;
}

.glass-panel {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
}

.action-bar {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.left {
  display: flex;
  gap: 12px;
}

.search-input {
  width: 240px;
}

.session-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.user-card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
  transition: all 0.3s ease;
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
}

.user-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  border-color: #dcdfe6;
}

.user-card.is-offline {
  opacity: 0.8;
  background: #fcfcfc;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

.muted {
  color: #94a3b8;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.avatar-wrapper {
  position: relative;
}

.user-avatar {
  background: #ebf5ff;
  color: #409eff;
}

.user-avatar.online {
  background: #f0f9eb;
  color: #67c23a;
}

.status-indicator {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #909399;
  border: 2px solid #fff;
}

.status-indicator.online {
  background: #67c23a;
}

.user-info {
  flex: 1;
  overflow: hidden;
}

.user-id {
  font-weight: 600;
  font-size: 16px;
  color: #303133;
  margin-bottom: 4px;
}

.last-seen {
  font-size: 12px;
  color: #909399;
}

.card-body {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}

.stat-row:last-child {
  margin-bottom: 0;
}

.label {
  color: #606266;
}

.text-green { color: #67c23a; font-weight: 500; }
.text-gray { color: #909399; }
.text-danger { color: #f56c6c; }

.card-footer {
  margin-top: auto;
}

.action-btn {
  width: 100%;
}

.empty-placeholder {
  grid-column: 1 / -1;
  padding: 40px 0;
}
</style>
