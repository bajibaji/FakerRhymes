# 调试计划：解决查询功能失效问题

## 问题描述
用户反馈在更新到 v1.8.5 后，点击生成押韵时，查询功能失效。
用户反馈即使修复了 SW 路径，查询依然失效。
**报错信息**：`TypeError: results is not iterable at queryDict (main.js:664:24)`

## 错误分析 (Root Cause Analysis)

### 报错位置
`main.js:664` 附近的逻辑：
```javascript
const results = window.dbManager.querySuffix(suffix, sourceLength, '%' + qk);
suffixMatchCount += results.length;
for (const row of results) { // <--- 报错行：results is not iterable
    // ...
}
```

### 原因推断
1.  **`window.dbManager.querySuffix` 返回了非 Array/Iterable 类型**。
2.  查看 `js/db.js`：
    ```javascript
    querySuffix: (suffix2, minLength, pattern) => 
        sendToWorker('querySuffix', { suffix2, minLength, pattern }),
    ```
    `sendToWorker` 返回的是一个 `Promise`。
3.  **核心错误**：`querySuffix` 是一个异步函数（返回 Promise），但在 `main.js` 中被当成同步函数直接调用了，没有 `await`！
    ```javascript
    // 错误代码
    const results = window.dbManager.querySuffix(...) 
    // 此时 results 是一个 Promise 对象，Promise 不是 iterable (除非 await)
    ```

### 为什么之前没报错？
可能是之前的版本中，这块逻辑有 `await`，或者 `querySuffix` 曾经是同步的（不可能，因为涉及 Worker），或者是这次重构/更新引入的 regression。
或者，在之前的代码审查中，我只关注了 Cache 问题，忽略了用户更新后 `main.js` 可能存在的逻辑错误（或者我在之前的操作中不小心回滚了/修改了文件？不，`main.js` 我今天没动过。可能是用户上次更新 `v1.8.5` 时引入的 Bug，现在才暴露出来）。

### 验证其他调用
`main.js:639`: `const results = await window.dbManager.queryByKeys(batch);` -> 这里用了 `await`，是正确的。
`main.js:1109`: `const dictResult = await queryDict(...)` -> 这里用了 `await`，是正确的。

**结论**：`queryDict` 函数内部的 `querySuffix` 调用缺失了 `await`。

## 修复方案

1.  **修改 `js/main.js`**：
    在第 660 行左右，`window.dbManager.querySuffix` 前添加 `await`。
    ```javascript
    const results = await window.dbManager.querySuffix(suffix, sourceLength, '%' + qk);
    ```

2.  **补全 ASSETS (次要但建议)**
    虽然主要错误是 JS 逻辑错误，但 SW 的 ASSETS 列表依然不完整，建议顺手修了，增强稳定性。

## 调试步骤 (Todo)

- [x] **1. 修复 JS 逻辑错误**
    - 在 `js/main.js` 中找到 `window.dbManager.querySuffix` 调用，添加 `await`。
- [x] **2. 补全 SW Assets**
    - 更新 `js/service-worker.js`，加入 `main.js`, `db.js`, `worker-db.js`, `sql-wasm.min.js`, `sql-wasm.wasm`, `style.css` 等。
- [x] **3. 验证修复**
    - 请求用户刷新并测试。

## 修复总结
1.  **Service Worker 路径修正**：将 `js/service-worker.js` 中 `ASSETS` 列表的相对路径从 `./` 修正为 `../`（针对根目录文件）和 `./`（针对 `js/` 目录文件），并补全了核心 JS/CSS 资源，防止离线或弱网下关键脚本加载失败。
2.  **JS 异步逻辑修复**：修复了 `js/main.js` 中调用 `window.dbManager.querySuffix` 时漏写 `await` 的 Bug。由于 `dbManager` 通过 Web Worker 异步通信，必须等待 Promise 解析，否则返回的 Promise 对象会导致 `results is not iterable` 错误。

## 执行日志
*文档更新时间: 2026-02-16 - 修复完成，用户确认功能恢复。*
