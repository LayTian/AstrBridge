<template>
  <div class="page">
    <div class="header glass-panel">
      <div class="left">
        <h3>接入中心</h3>
        <el-tag size="small" type="info" effect="plain">浏览器直连</el-tag>
      </div>
      <div class="right">
        <el-button type="primary" plain @click="openDemo">打开 Demo</el-button>
      </div>
    </div>

    <el-alert
      class="glass-panel"
      title="user_id 必须为数字语义（OneBot v11）。建议使用 SDK 自动生成的 10 位数字。"
      type="info"
      :closable="false"
      show-icon
    />

    <div class="grid">
      <div class="card glass-panel">
        <div class="card-title">常用链接</div>
        <div class="kv">
          <div class="k">SDK（ESM）</div>
          <div class="v">
            <el-link :href="sdkMjs" target="_blank" type="primary">{{ sdkMjs }}</el-link>
          </div>
          <div class="k">SDK（UMD）</div>
          <div class="v">
            <el-link :href="sdkUmd" target="_blank" type="primary">{{ sdkUmd }}</el-link>
          </div>
          <div class="k">Demo</div>
          <div class="v">
            <el-link :href="demoUrl" target="_blank" type="primary">{{ demoUrl }}</el-link>
          </div>
          <div class="k">API Demo</div>
          <div class="v">
            <el-link :href="apiDemoUrl" target="_blank" type="primary">{{ apiDemoUrl }}</el-link>
          </div>
          <div class="k">WS 地址</div>
          <div class="v">
            <span class="mono">{{ wsBase }}</span>
          </div>
        </div>
      </div>

      <div class="card glass-panel">
        <div class="card-title">ESM 最短示例</div>
        <el-input v-model="snippetEsm" type="textarea" :rows="10" readonly />
      </div>

      <div class="card glass-panel">
        <div class="card-title">UMD 最短示例</div>
        <el-input v-model="snippetUmd" type="textarea" :rows="10" readonly />
      </div>

      <div class="card glass-panel">
        <div class="card-title">HTTP API 接入（服务端/网关推荐）</div>
        <el-input v-model="snippetApi" type="textarea" :rows="10" readonly />
        <el-descriptions :column="1" border>
          <el-descriptions-item label="Endpoint">
            <span class="mono">POST /api/integrations/:id/events</span> / <span class="mono">POST /api/integrations/:id/request-reply</span>
          </el-descriptions-item>
          <el-descriptions-item label="Headers">
            <span class="mono">Content-Type: application/json</span>；可选 <span class="mono">x-integration-secret</span>；可选 <span class="mono">Idempotency-Key</span>
          </el-descriptions-item>
          <el-descriptions-item label="Body">
            <span class="mono">{ user_id: string(纯数字), text: string, timeout_ms?: number, idempotency_key?: string }</span>
          </el-descriptions-item>
          <el-descriptions-item label="返回值说明">
            /events 返回提交结果与 request_id；/request-reply 会在一次 HTTP 里等待机器人回复并返回 reply（含 request_id）。
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="card glass-panel">
        <div class="card-title">调试建议</div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="多站点接入">
            每个网站/业务建议使用不同 user_id 前缀策略，避免串台。
          </el-descriptions-item>
          <el-descriptions-item label="同站点多用户">
            把你业务的真实用户 ID 映射为数字（如哈希取模生成 10 位数字），并保证稳定。
          </el-descriptions-item>
          <el-descriptions-item label="排障">
            可用「消息测试台」直接连 WS 发消息，确认链路。
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const host = computed(() => globalThis.location?.hostname || 'localhost')
const httpProto = computed(() => (globalThis.location?.protocol === 'https:' ? 'https' : 'http'))
const wsProto = computed(() => (globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'))
const httpBase = computed(() => `${httpProto.value}://${host.value}:8080`)
const wsBase = computed(() => `${wsProto.value}://${host.value}:8080`)

const sdkMjs = computed(() => `${httpBase.value}/sdk/adapter-client.mjs`)
const sdkUmd = computed(() => `${httpBase.value}/sdk/adapter-client.umd.js`)
const demoUrl = computed(() => `${httpBase.value}/sdk/demo.html`)
const apiDemoUrl = computed(() => `${httpBase.value}/sdk/api-demo.html`)

const snippetEsm = ref(
  `<script type="module">
  import { AdapterClient } from "${sdkMjs.value}";

  const client = new AdapterClient({
    url: "${wsBase.value}",
  });

  client.onReply((text) => console.log("bot:", text));
  await client.connect();
  client.sendText("你好");
<\/script>`
)

const snippetUmd = ref(
  `<script src="${sdkUmd.value}"><\/script>
<script>
  const client = new window.AdapterClient({ url: "${wsBase.value}" });
  client.onReply((text) => console.log("bot:", text));
  client.connect().then(() => client.sendText("hello"));
<\/script>`
)

const snippetApi = ref(
  `# 异步投递（不等回复）
curl -X POST "${httpBase.value}/api/integrations/<integration_id>/events" \\
  -H "Content-Type: application/json" \\
  -H "x-integration-secret: <可选>" \\
  -H "Idempotency-Key: <可选>" \\
  -d '{"user_id":"10001","text":"你好"}'

# 同步等待回复（一次 HTTP 拿 reply）
curl -X POST "${httpBase.value}/api/integrations/<integration_id>/request-reply" \\
  -H "Content-Type: application/json" \\
  -H "x-integration-secret: <可选>" \\
  -H "Idempotency-Key: <可选>" \\
  -d '{"user_id":"10001","text":"你好","timeout_ms":15000}'`
)

const openDemo = () => {
  globalThis.open?.(demoUrl.value, '_blank')
}
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
  gap: 12px;
  align-items: center;
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

.kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px 12px;
  align-items: center;
}

.k {
  color: #64748b;
  font-size: 13px;
}

.v {
  color: #111827;
  overflow-wrap: anywhere;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
