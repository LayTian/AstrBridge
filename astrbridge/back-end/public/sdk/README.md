# AdapterClient（浏览器直连 SDK）

适用于“其他网站的前端（浏览器）直接接入 Adapter”的场景。

## 方式一：ESM（推荐）

```html
<script type="module">
  import { AdapterClient } from "http://localhost:8080/sdk/adapter-client.mjs";

  const client = new AdapterClient({
    url: "ws://localhost:8080",
    // userId 可不传：会自动生成并写入 localStorage（同一浏览器稳定）
    // sessionId 可不传：会为每个 tab 自动生成（写入 sessionStorage）
  });

  client.onReply((text) => console.log("bot:", text));
  await client.connect();
  client.sendText("你好");
</script>
```

## 方式二：UMD（传统 script）

```html
<script src="http://localhost:8080/sdk/adapter-client.umd.js"></script>
<script>
  const client = new window.AdapterClient({ url: "ws://localhost:8080" });
  client.onReply((text) => console.log("bot:", text));
  client.connect().then(() => client.sendText("hello"));
<\/script>
```

## 重要说明
- Adapter 侧用 `user_id` 做会话标识：SDK 会自动生成一个数字字符串（避免后端 fallback 到固定 10001）。
- 如需显式指定：传入 `new AdapterClient({ userId: '10001' })`。
- 心跳协议：SDK 会每 30s 发送 `PING`，服务端应返回 `PONG`。
