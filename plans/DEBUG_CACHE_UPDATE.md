# 调试计划：解决网页版本不更新问题

## 问题描述
用户反馈代码已更新，但在浏览器中打开网页仍显示旧版本 (v1.8.2)，而代码中已设定为 v1.8.5。

## 可能的原因分析 (Hypotheses)

1.  **浏览器 HTTP 缓存了 `service-worker.js`**：浏览器可能没有去服务器请求新的 SW 文件，或者服务器返回了 304 Not Modified。
2.  **`importScripts('version.js')` 读取了旧缓存**：这是最可能的嫌疑人。Service Worker 使用 `importScripts` 加载 `version.js` 时，如果服务器没有设置正确的 Cache-Control，浏览器可能会直接使用 HTTP 缓存中的旧版 `version.js`。导致 SW 内部的 `APP_VERSION` 仍然是旧的，从而 `CACHE_NAME` 也是旧的。
3.  **Service Worker 等待状态 (Waiting)**：虽然代码中有 `skipWaiting()`，但如果有错误发生导致这行没执行，新 SW 可能处于 waiting 状态。
4.  **Network-First 策略失效**：SW 中的 fetch 事件逻辑可能存在 bug，导致即使有网络也优先读了缓存。
5.  **CDN/服务端缓存**：如果托管在 GitHub Pages 等平台，CDN 可能缓存了文件。

## 筛选出的最主要原因
**`importScripts('version.js')` 读取了旧缓存** 是最可能的原因。因为 `service-worker.js` 文件头部已经修改了注释 `// Version: v1.8.5`，这通常足以触发浏览器对 SW 文件的更新检测。但 `importScripts` 请求的资源通常遵循浏览器的标准 HTTP 缓存策略。

## 调试步骤 (Todo)

- [ ] **1. 添加调试日志**
    - 在 `js/service-worker.js` 中添加 `console.log`，打印当前的 `APP_VERSION` 和 `CACHE_NAME`。
    - 在 `js/version.js` 中添加日志，确认它被执行。
- [ ] **2. 用户验证**
    - 请求用户打开控制台，查看输出的版本号。
- [ ] **3. 实施修复**
    - 方案 A：在 `service-worker.js` 中 `importScripts` 加上版本号参数（如果有构建工具）。
    - 方案 B：直接在 `service-worker.js` 中定义版本号，不再依赖 `version.js` (或者在 SW 中硬编码版本以破坏缓存)。
    - 方案 C：在 `importScripts` 的 URL 后加上随机数或时间戳（不推荐，会导致 SW 频繁更新）。
    - 方案 D：修改 `importScripts` 为 `importScripts('version.js?v=1.8.5')` 手动同步版本号。

## 执行日志
*文档创建时间: 2026-02-15*
