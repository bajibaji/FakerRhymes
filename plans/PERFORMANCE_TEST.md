# FakerRhymes 性能测试文档

本文档旨在记录 FakerRhymes (废壳韵脚生成器) 的性能评估标准、测试场景及优化方向。

## 1. 测试目标 (KPIs)

为了确保用户在创作时拥有流畅的体验，我们关注以下核心指标：

- **LCP (Largest Contentful Paint)**: 页面核心交互界面渲染完成时间（目标 < 1.5s）。
- **词库初始化耗时 (Dictionary Init)**: 首次进入应用，下载、解析 3 个 `dict_part_n.json` 并写入 IndexedDB 的总耗时。
- **搜索延迟 (Search Latency)**: 
    - 严格模式：目标 < 50ms。
    - 最松模式（多音字及变体多）：目标 < 200ms。
- **内存占用 (Memory Footprint)**: 词典全量载入内存后的常驻大小（目标：移动端 < 100MB）。
- **AI 响应延迟**: 从发送请求到首个字符流式输出的时间。

## 2. 测试环境

建议在以下环境下进行基准测试：
- **桌面端**: Chrome (Latest), 网络限速设为 "Fast 3G" 进行加载测试。
- **移动端**: 真实中端安卓/iOS 设备，使用系统浏览器测试交互流畅度。
- **离线环境**: 模拟 Service Worker 激活后的二次加载性能。

## 3. 核心测试场景

### 3.1 初始冷启动性能
- **操作**: 清除浏览器缓存和 IndexedDB，重新加载页面。
- **关注点**: 
    - 并行下载 3 个 JSON 分片的效率。
    - Web Worker 的启动开销。
    - `data.js` 中 `loadDictionary` 函数的执行耗时。

### 3.2 词典检索压力测试
- **操作**: 输入长词（如 3-4 字），并在“严格”、“中等”、“最松”模式间切换。
- **关注点**: 
    - 最松模式下生成的查询键变体数量。
    - 布隆过滤器 (Bloom Filter) 对无效查询的拦截效率。
    - 搜索结果渲染（DOM 操作）是否引起掉帧。

### 3.3 离线存储性能
- **操作**: 刷新页面，观察数据从 IndexedDB 恢复到内存的速度。
- **关注点**: `IDBTransaction` 的完成速度及数据反序列化耗时。

### 3.4 内存溢出风险测试
- **操作**: 长时间使用，反复进行自定义词库录入和大规模搜索。
- **关注点**: 观察 Chrome Task Manager 中的内存增长曲线，确认是否存在闭包导致的内存泄漏。

## 4. 推荐测试工具

- **Chrome DevTools (Performance Tab)**: 用于分析长任务 (Long Tasks) 和主线程阻塞情况。
- **Chrome DevTools (Memory Tab)**: 进行 Heap Snapshot 堆快照分析，检查 `globalDictData` 的实际占用。
- **Lighthouse**: 评估 PWA 指标及可访问性。
- **Console Profiler**: 项目代码中已内置部分 `console.time` 记录，可在控制台查看关键步骤耗时。

## 5. 当前已知性能特征与瓶颈

1.  **分片优势**: 通过拆分 `dict_part_n.json`，显著降低了单次 HTTP 请求的压力。
2.  **内存权衡**: 为了实现极速检索，我们将全量词库映射为内存 Map。在超大规模词库（>10万词）情况下，需考虑改为分片按需加载。
3.  **计算波峰**: 在"最松"模式下匹配长词时，CPU 会有短暂的高负载，目前通过 Web Worker 缓解，但仍需监控低端设备的响应。

## 6. 2026-02-22 查询性能优化记录

### 问题诊断
- **P0**: `queryDict` Phase 2 后缀查询存在 N+1 问题，Tier 2 下对每个变体 key 单独发一次 `postMessage`，最多 200+ 次 Worker 往返
- **P0**: `encoded_key LIKE '%xxx'` 前缀通配符无法走索引，退化为全行扫描
- **P1**: 缺少复合索引 `(suffix_2, length)`
- **P1**: `matchedByWordCount` 去重用 `Array.includes()` 是 O(n)
- **P2**: `BloomFilter` 类已不再使用，为死代码

### 修改内容
- [`js/worker-db.js`](js/worker-db.js): 新增 `querySuffixBatch` 函数，将 N 次后缀查询合并为 1 次 SQL（用 `IN` 替代 `LIKE '%xxx'`，可走索引）
- [`js/worker-db.js`](js/worker-db.js): 新增复合索引 `idx_words_suffix_length ON words(suffix_2, length)`
- [`js/worker-db.js`](js/worker-db.js): 新增 `ensureIndexes()` 函数，对已有数据库补建缺失索引
- [`js/db.js`](js/db.js): 新增 `querySuffixBatch` 代理接口
- [`js/main.js`](js/main.js): Phase 2 改为单次 `querySuffixBatch` 调用，消除 N+1
- [`js/main.js`](js/main.js): `matchedByWordCount` 值改用 `Set`，去重 O(1)
- [`js/main.js`](js/main.js): Phase 1 `BATCH_SIZE` 从 100 提升到 500
- [`js/main.js`](js/main.js): 删除 `BloomFilter` 死代码

### 预期收益
- Tier 2（最松模式）查询延迟：200+ 次 Worker 往返 → 1 次，预计快 **10-50x**
- 后缀过滤：`LIKE` 全扫 → `IN` 走索引，预计快 **5-10x**
- 复合索引：`suffix_2 + length` 双条件过滤，预计快 **2-3x**

---
*最后更新日期: 2026年2月22日*
