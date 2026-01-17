# 移除插件系统回滚计划

根据您的要求，我们将完全移除插件系统相关的代码和文件，使项目回到 Day 2 完成时的状态。

## 后端清理
1.  **修改 `src/server/WebSocketServer.ts`**
    *   移除 `InterceptorManager` 和 `SensitiveWordInterceptor` 的导入。
    *   移除 `interceptorManager` 属性定义。
    *   移除构造函数中拦截器的初始化和注册代码。
    *   移除 `processUserMessage` 方法中执行拦截器链的逻辑（即移除 `run(context)` 及相关的阻断判断）。
2.  **删除文件**
    *   删除整个 `src/plugins/` 目录（包含 `Types.ts`, `InterceptorManager.ts`, `SensitiveWordInterceptor.ts`）。

## 前端清理
1.  **修改 `web-admin/src/App.vue`**
    *   删除侧边栏菜单中的“插件配置”入口。
2.  **修改 `web-admin/src/router/index.ts`**
    *   删除 `/plugins` 路由定义。
    *   移除 `Plugins.vue` 的导入。
3.  **删除文件**
    *   删除 `web-admin/src/views/Plugins.vue`。

## 验证
1.  运行 `npx tsc` 确保后端编译无报错。
2.  重启服务，验证基础聊天和管理功能不受影响。
