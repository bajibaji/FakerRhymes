# FakerRhymes
无情押韵机器人

# 词库加载性能优化指南

## ⚠️ 词库字数不匹配的原因

### 为什么显示的唯一字数比我想象的少？

这是**完全正常的**！你的词库可能是按**韵脚分类**组织的，同一个字会在多个韵脚出现。

**举例：**
```
{
  "a1": ["八", "打", "八"],
  "an1": ["安", "八", "般"],
  "ang1": ["八", "方", "香"]
}
```

统计结果：
- **原始字符总数**（计重复）：9 个 `"八打八安般方香八"`
- **唯一汉字数**（去重）：`{"八", "打", "安", "般", "方", "香"}` = **6 个**
- **重复度**：(9-6)/9 = 33%

### 你的词库统计（真实数据）

```
韵脚分类数: 1,056,348
词库条目数: 1,590,822 个字符串
字符总数（计重复）: 5,279,835 个汉字字符
唯一汉字数（去重）: 11,597 个汉字
重复度: 99.8%
```

**这意味着：**
- 你的 11,597 个唯一汉字平均每个出现 **~456 次**（在不同韵脚）
- 这是因为词库按"韵脚+声调"组合作为 key，而一个字可以在多种拼音下出现
- 这种结构对于**快速查询特定韵脚的字**很好，但**唯一字数较少**

### 如何查看完整统计？

**在浏览器控制台（F12）运行：**
```javascript
window.dictDebug.showStats()   // 显示详细统计
window.dictDebug.cacheSize()   // 显示缓存占用
```

---

## 问题诊断

你的词库加载时网页会卡死，主要原因是：

1. **主线程阻塞** - 大量 JSON 解析和字符处理在主线程执行，阻塞 UI 响应
2. **同步解析** - `JSON.parse()` 和字符遍历都是同步操作，数据越大越卡
3. **缺乏进度反馈** - 用户看不到加载进度，体验不佳

## 解决方案

已实施的优化包括：

### 1. Web Worker 后台处理
- ✅ 已创建 `dict-worker.js` - 在独立线程中加载和解析词库
- ✅ 主线程保持响应，用户界面流畅
- ✅ 支持实时进度报告

### 2. 流式下载和分块处理
- ✅ 使用 `ReadableStream` 处理大文件
- ✅ 每 1000 项报告一次进度，实时显示加载百分比
- ✅ 添加进度条和文本提示

### 3. 支持回退方案
- ✅ 如果浏览器不支持 Web Worker，自动降级到改进的同步模式
- ✅ 回退模式中每 5000 项更新一次进度，不完全卡死

### 4. 详细统计显示
- ✅ 加载完成后显示详细的统计信息
- ✅ 支持在浏览器控制台查看完整数据

## 进一步优化建议

### 📌 优化你的 `dict_optimized.json`

#### 选项 A: 压缩格式（推荐）
将词库改为更紧凑的格式，减少文件大小 50-70%：

```json
{
  "an0": "安案按班班班办板般绑包保,...",
  "an1": "安案按班班班办板般绑包保,...",
  "an2": "安案按班班班办板般绑包保,...",
  ...
}
```

使用字符串拼接而非数组，可大幅减少 JSON 开销。

#### 选项 B: 分块词库
将大词库分成多个小文件（每个 50KB-100KB），按需加载：

```
dict_an.json    (韵母 an 的所有字)
dict_eng.json   (韵母 eng 的所有字)
dict_ang.json   (韵母 ang 的所有字)
...
```

修改 `dict-worker.js` 的 `dictSources` 以加载所有块：

```javascript
const dictSources = [
  { name: 'an', url: './dict_an.json' },
  { name: 'eng', url: './dict_eng.json' },
  { name: 'ang', url: './dict_ang.json' },
  // ... 更多块
];

// Worker 会依次加载并合并
```

### 📌 减少字库大小的其他方法

1. **只保留常用字** - 删除生僻字（用频率 < 0.01%）
   ```python
   # 示例 Python 脚本统计字频
   import json
   from collections import Counter
   
   with open('dict.json') as f:
       data = json.load(f)
   
   # 统计出现次数
   chars = []
   for key in data:
       if isinstance(data[key], list):
           chars.extend(data[key])
   
   freq = Counter(chars)
   # 保留出现次数 > 10 的字
   filtered = {k: v for k, v in freq.items() if v > 10}
   ```

2. **使用 gzip 压缩** - 服务器启用 gzip，传输大小减少 70-80%
   ```bash
   # Nginx 配置
   gzip on;
   gzip_types application/json;
   gzip_min_length 1000;
   ```

3. **按韵脚分类** - 用户只需要当前输入字的韵脚词库
   ```javascript
   // 仅加载需要的韵脚
   const rhyme = 'an'; // 当前输入字的韵脚
   const url = `./dict_${rhyme}.json`;
   ```

### 📌 性能指标监测

在浏览器控制台检查加载性能：

```javascript
// 打开浏览器控制台（F12），执行：

// 1. 检查词库大小
const cached = JSON.parse(localStorage.getItem('ONLINE_DICT_CACHE'));
console.log('词库字数:', cached.length);
console.log('缓存大小 (KB):', new Blob([localStorage.getItem('ONLINE_DICT_CACHE')]).size / 1024);

// 2. 检查加载时间
const time = localStorage.getItem('ONLINE_DICT_TIME');
console.log('加载时间:', new Date(parseInt(time)).toLocaleString());

// 3. 检查内存占用
console.log('RAM 占用:', performance.memory?.usedJSHeapSize / 1024 / 1024, 'MB');
```

## 使用建议

### 首次加载词库
1. 点击 "📚 加载词库" 按钮
2. 查看进度条和百分比
3. 完成后显示 "✓ 已加载 XXXX 字"
4. 词库缓存在 `localStorage`，下次打开无需重新加载

### 如果还是很慢

1. **检查网络** - 看网络速度是否很慢
2. **减少字库** - 删除不需要的字或使用分块方案
3. **使用压缩格式** - 改用紧凑的字符串格式
4. **启用服务器压缩** - 如果自己部署，配置 gzip

### 浏览器兼容性
- ✅ Chrome/Edge 95+
- ✅ Firefox 79+
- ✅ Safari 14.1+
- ✅ 无 Web Worker 支持的老浏览器 - 自动回退

## 技术细节

### `dict-worker.js` 工作流程
```
主线程 → 发送加载请求 → Worker 线程
                    ↓
                 下载文件 (流式)
                    ↓
                 JSON.parse()
                    ↓
                 提取汉字 (定期报告进度)
                    ↓
主线程 ← 接收字数组 ← 完成
 ↓
更新 UI 和 localStorage
```

### 回退模式 (`loadOnlineDictFallback`)
不支持 Worker 的浏览器使用改进的同步模式：
- 每 5000 项更新进度（减少 UI 重绘）
- 占用更多主线程，但仍比原来好很多

## 问题排查

| 现象 | 原因 | 解决方案 |
|------|------|--------|
| 加载卡住不动 | 词库过大 + 网络慢 | 减少字库 or 使用分块 |
| "Worker 错误" | 浏览器不支持 Worker | 自动降级到回退模式 |
| 加载超时 | 网络连接差 | 检查网络 or 分块加载 |
| localStorage 满了 | 词库太大 | 只保留常用字 |

## 推荐最佳实践

1. **词库大小控制** - 建议 < 10,000 个字（< 500KB JSON）
2. **定期清理** - localStorage 有 5-10MB 限制
3. **分块策略** - 词库 > 500KB 时，考虑分块加载
4. **用户通知** - 加载中显示进度，避免用户误以为卡死
