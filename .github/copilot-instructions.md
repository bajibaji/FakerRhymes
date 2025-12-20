# Copilot 使用说明 — FakerRhymes

下面为 AI 代理（或新来开发者）快速上手本仓库的要点。目标是：让 AI 能在不来回猜测的情况下修改押韵逻辑、词库加载、或 UI 行为。

- **项目类型**：纯静态前端单页应用（无构建步骤）。主要文件：`index.html`（核心逻辑与 UI）、`data.js`（词库合并与导出接口）、`custom.html`（自定义词库管理）、`dict_optimized.json`（可选的本地优化字典）。

- **运行/调试**：直接在浏览器打开 `index.html` 或用简单静态服务器，例如：

```bash
# 在仓库根目录运行（任选其一）
python -m http.server 8080
npx http-server -p 8080
```

- **关键全局接口 / 本地存储**：
  - `window.getRhymeBank()`：返回合并后的押韵词列表（来自 `data.js` 的 `bank`、`customBank`、localStorage、以及在线缓存）。
  - `window.RHYME_CHAR_BANK`：运行时的缓存数组，`window.refreshRhymeBank()` 可刷新并返回该数组。
  - localStorage keys：`CUSTOM_RHYME_BANK`（自定义词库）、`ONLINE_DICT_CACHE` / `ONLINE_DICT_TIME` / `ONLINE_DICT_SOURCE`（在线词库缓存与元信息）。

- **主要拼音/押韵逻辑位置（修改时请参考）**：
  - `index.html` 中的函数：`toInfo()`（字符->拼音信息）、`detectFinal()`（提取韵母/声母并处理特殊规则）、`buildFinalVariants()`（按松紧级别合并韵母）、`queryDict()`（使用 `dict_optimized.json` 或自定义词库查询匹配）。
  - 这些函数实现了项目特有的规则：
    - Triple-I Isolation（`i-flat` / `i-retro`）
    - 平翘舌、前后鼻音的合并规则（见 `thirteenTracks` 与 `legacyKeyMap`）
    - 松紧分级：0（严格）、1（中等）、2（最松）—对应 `looseness` 控件

- **词库格式注意**：
  - `dict_optimized.json` 支持多种结构：可以是数组（字符串或对象），也可以是按键值映射到字符数组。`index.html` 中的 `loadOnlineDict()` 有解析逻辑，修改时请同步更新解析器。
  - 自定义词可放在 `data.js` 的 `customBank`，或通过 `custom.html` 保存到 `CUSTOM_RHYME_BANK`（更推荐：使用 `custom.html` 或 localStorage，避免直接提交大量字符到 `data.js`）。

- **外部依赖 / 协议**：
  - 运行依赖 `pinyin-pro`（通过 CDN 顺序加载，见 `cdnList`）。若更改版本，请同时更新 CDN 列表。
  - GSAP（可选，用于动画），如果 CDN 失败，应用仍可工作（动画为降级功能）。

- **修改建议与风险点**：
  - 改动拼音解析或韵脚匹配时，应同时检查：`detectFinal()`、`buildFinalVariants()`、`legacyKeyMap`、`phraseFitsSource()` 与 `queryDict()`，因为这些函数协同决定匹配结果。
  - 当引入新韵母别名或合并规则，需更新 `dict_optimized.json` 的键名或在 `buildKeyVariants()` 中兼容 `v/u` 变体。

- **常见任务示例**：
  - 添加新自定义词：在浏览器打开 `custom.html` -> 填写 -> 点击保存（写入 `CUSTOM_RHYME_BANK`）。
  - 本地调试拼音库问题：在 `index.html` 找到 `cdnList`，可以临时注释 CDN 并引入本地 `pinyin-pro.umd.js`。
  - 扩展/优化字典：编辑 `dict_optimized.json`（保持键为韵脚+声调组合格式，值为短语数组），然后在浏览器点击“📚 加载词库”。

- **对 AI 的具体指令模板**（例子）
  - “在 `index.html` 中使 `detectFinal()` 对 `ü` 的处理兼容 `üan` 与 `van` 两种写法，保留现有 `v/u` 兼容性，并在 `buildFinalVariants()` 中更新对应分组。”
  - “为 `queryDict()` 添加一个小日志点，打印生成的 `queryKeys`，以便调试字典匹配问题；不要改动最终返回值结构。”

如果需要，我可以把本文件变更为更详细的检查列表（例如每个函数的输入/输出范例、典型单元测试用例），或者现在直接创建初始 PR。请告诉我你优先希望补充的部分。 
