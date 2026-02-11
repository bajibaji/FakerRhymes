# 押韵查询逻辑检查与修复报告

## 1. 概述
本次调试针对 `js/main.js` 中的核心押韵查询函数 `queryDict` 进行了详细的代码审查和逻辑分析。主要目标是识别并修复可能导致查询结果不完整或错误的问题。

## 2. 问题发现
在分析降级查询逻辑（即当无法找到与输入词同长度的押韵词时，系统尝试减少查询字数）时，发现了一个关键的逻辑漏洞。

### 漏洞描述
当 `queryDict` 进行降级查询（递归调用自身）时，虽然它成功获取了较短字数的查询结果，但它**仅使用了递归结果中的 `sameLength`（同长匹配）部分**，而**忽略了 `moreLengths`（长词匹配）部分**。

### 具体场景
假设用户输入一个 4 字词（如 `ABCD`），且词库中没有直接押韵的 4 字词。
1. 系统降级查询，尝试用最后 3 个字（`BCD`）去查。
2. 假设词库中有与 `BCD` 押韵的 3 字词（如 `XYZ`）和 4 字词（如 `XYZW`）。
3. 递归调用 `queryDict('BCD')` 会返回：
   - `sameLength`: [`XYZ`]
   - `moreLengths`: [`XYZW`]
4. **修复前**：主函数只取回 `XYZ`，而丢弃了 `XYZW`。用户只能看到 3 字的押韵词，却看不到可能更有价值的 4 字押韵词。

## 3. 修复方案
修改了 `js/main.js` 中处理降级查询结果的代码块。

### 代码变更
在 `queryDict` 函数的降级查询逻辑中（约 594 行），添加了对 `shorterResult.moreLengths` 的处理逻辑：

```javascript
// 修复：保留降级查询中发现的长词
if (shorterResult.moreLengths && shorterResult.moreLengths.length > 0) {
    console.log(`[Debug] Recovering ${shorterResult.moreLengths.length} longer words from degraded query...`);
    for (const phrase of shorterResult.moreLengths) {
        const pLen = Array.from(phrase).length;
        
        // 如果这个长词的长度等于原始查询长度，把它算作“同长匹配”
        if (pLen === sourceLength) {
            if (!sameLengthResults.includes(phrase)) {
                sameLengthResults.push(phrase);
            }
        }
        // 如果真的比原始查询还长，放入“更多匹配”
        else if (pLen > sourceLength) {
            if (!moreLengthResults.includes(phrase)) {
                moreLengthResults.push(phrase);
            }
        }
    }
}
```

## 4. 验证方法
1.  打开浏览器控制台 (F12)。
2.  输入一个生僻的 4 字或 5 字词，确保其没有直接的同长押韵词，但其后缀（后2-3字）有长词押韵。
3.  观察控制台输出。
    - 如果修复生效，你将看到类似 `[Debug] Recovering ... longer words from degraded query...` 的日志。
    - 生成结果区域将显示出原本可能会丢失的长词。

## 5. 其他检查项
- **Bloom Filter**: 确认在内存模式下未使用 Bloom Filter 进行过滤，这避免了哈希冲突导致的误判。
- **Suffix Index**: 后缀索引逻辑用于加速长词查找，经检查逻辑正确。
- **Web Worker**: 项目中包含 `dict-worker.js` 但未被实际引用，目前使用的是主线程加载。建议后续考虑迁移到 Worker 以避免阻塞 UI，但这不影响查询准确性。

## 6. 结论
核心查询逻辑中的降级丢失问题已修复。现在的查询算法在处理无直接匹配的情况时，能更全面地召回所有相关的长词结果。
