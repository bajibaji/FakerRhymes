# 项目架构说明文档 (ARCHITECTURE.md)

本文档旨在描述 **废壳押韵机器人 (Faker Rhymes)** 的技术架构、核心模块设计及数据流向。

---

## 1. 核心技术栈

- **Runtime**: [Electron](https://www.electronjs.org/) (v39.2.7)
- **Frontend**: HTML5, CSS3 (Custom Properties, Flexbox/Grid), JavaScript (Vanilla JS)
- **Animation**: [Rive](https://rive.app/) (Core Engine - 采用状态机驱动的矢量动画系统，全面替换原有的 GSAP)
- **NLP/Pinyin**: [pinyin-pro](https://pinyin-pro.cn/)
- **AI Integration**: Google Gemini API (@google/generative-ai)
- **Storage**: IndexedDB (via custom DB wrapper), LocalStorage
- **Offline Support**: Service Worker, Web Workers (for heavy dict processing)

---

## 2. 目录结构

```text
FakerRhymes/
├── main.js              # Electron 主进程 (处理窗口、IPC、网络代理、AI API 调用)
├── preload.js           # 预加载脚本 (安全桥接主进程与渲染进程)
├── index.html           # 主界面视图
├── custom.html          # 自定义词库管理界面
├── dict_optimized.json  # 核心离线词库数据 (JSON 格式)
├── scripts/             # 渲染进程逻辑
│   ├── app.js           # 应用逻辑入口、UI 绑定
│   ├── db.js            # IndexedDB 封装类 (持久化自定义词条)
│   ├── dict-manager.js  # 词库管理器 (加载、索引构建、查询逻辑)
│   └── rhyme-engine.js  # 押韵核心引擎 (拼音解析、变体生成、匹配算法)
├── styles/              # 样式文件
├── dict-worker.js       # Web Worker (后台处理词库加载与解析)
├── sw.js                # Service Worker (离线资源缓存)
└── package.json         # 项目配置与依赖管理
```

---

## 3. 系统架构与交互流程

### 3.1 进程模型

本项目遵循 Electron 的多进程架构：

- **Main Process**: 负责原生窗口管理、拦截 IPC 调用以处理敏感操作（如带代理的网络请求）。
- **Renderer Process**: 负责 UI 渲染、本地押韵算法执行、自定义词库管理。

```mermaid
graph TD
    A[用户界面 (Renderer)] -- "输入词语" --> B[app.js]
    B -- "调用算法" --> C[rhyme-engine.js]
    C -- "查询" --> D[dict-manager.js]
    D -- "索引匹配" --> E[(dict_optimized.json)]
    D -- "缓存匹配" --> F[(IndexedDB)]
    
    B -- "AI 模式启用" --> G[preload.js]
    G -- "IPC Invoke" --> H[main.js]
    H -- "HTTPS Proxy" --> I[Google Gemini API]
    I -- "返回生成词" --> H
    H -- "IPC Reply" --> B
    B -- "渲染结果" --> A
```

---

## 4. 押韵引擎原理 (Rhyme Engine)

### 4.1 拼音解析与标准化
使用 `pinyin-pro` 将汉字转为带声调拼音，引擎将其标准化：
- 转换 `ü` -> `v`。
- 分离声母 (Initial) 与 韵母 (Final)。
- 特殊处理 `i` 韵（隔离平舌 `i-flat` 与翘舌 `i-retro`）。

### 4.2 宽松度等级 (Looseness Tiers)
- **Tier 0 (严格)**: 必须满足 **同韵母 + 同声调**。
- **Tier 1 (中等)**: 允许 **扩展韵部匹配**（如前后鼻音合并，参考“十三辙”）。
- **Tier 2 (最松)**: 忽略声调，允许最大范围的韵部变体，并支持 **平仄过滤**（平：1,2声；仄：3,4声）。

### 4.3 匹配流程
1. **提取源词指纹**: 获取每个字的韵母和声调。
2. **生成查询变体**: 根据宽松度等级，生成可能的韵母组合 Key。
3. **索引查询**: 在 `dictIndex` (Map) 中快速定位匹配词条。
4. **后置过滤**: 检查特殊声母匹配规则、排除源词本身、应用平仄过滤。

---

## 5. 数据持久化与性能优化

### 5.1 词库加载优化
- **Web Worker**: 词库解析和去重在 `dict-worker.js` 中异步执行，避免阻塞 UI 渲染。
- **Memory Indexing**: `dict-manager.js` 会为词库构建一个分片索引 (`Map`)，支持后缀匹配（1-4字）。
- **requestIdleCallback**: 利用浏览器空闲时间构建索引，降低长任务阻塞风险。

### 5.2 存储策略
- **LocalStorage**: 存储用户配置（API Key, 代理地址, 宽松度偏好）。
- **IndexedDB**: 存储用户手动添加的“自定义词库”，支持大容量持久化。
- **Service Worker**: 缓存静态资源，确保应用在无网络环境下依然可用。

---

## 7. 扩展性考虑：Rive 动画集成
本项目已在架构层面支持集成 [Rive](https://rive.app/)。Rive 极其适合作为“押韵机器人”的视觉主体：
- **状态机控制**: 可以根据搜索状态（Idle、Searching、Success、Error）切换机器人的动作。
- **高性能**: 相比复杂的 DOM 动画，Rive 在 Canvas/WebGL 上运行，对渲染进程压力较小。
- **集成方式**: 可通过 `@rive-app/canvas` 运行时库直接在渲染进程中加载 `.riv` 资源。

---

## 6. AI 押韵模式
通过 Electron 主进程调用 Gemini API，绕过前端 CORS 限制并支持系统级代理配置：
1. 主进程封装 `node-fetch` + `HttpsProxyAgent`。
2. 构造特定 Prompt 指引 AI 生成符合韵律的词汇。
3. 对 AI 返回结果进行本地二次校验与过滤，确保质量。
