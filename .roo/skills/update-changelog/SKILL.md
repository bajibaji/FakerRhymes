---
name: update-changelog
description: 自动分析 git 变更并更新 `./README.md` 中的更新日志部分。
---

# When to use
- 当你需要将最近的代码变更（Git diff）记录到 `./README.md` 的更新日志中时。
- 每次发布新版本（例如更新 `src/constants/version.ts` 中的版本号）之后。

# When NOT to use
- 不要用于更新 `plans/` 目录下的规划文档（请使用 `update-plan` 技能）。
- 不要用于非更新日志性质的内容修改。

# 核心原则 (Core Principles)
1. **数据驱动**：更新内容必须基于 `git diff` 的真实结果。
2. **格式一致性**：严格遵守 `./README.md` 第 67 行后的 `## vX.X.X` 和 `> ` 引用块格式。
3. **精炼表达**：日志应简短、直接、技术导向，避免冗长描述。

# 工作流 (Workflow)

## 1. 差异分析 (Diff Analysis)
使用 `git` 工具获取变更内容。优先查看未提交变更，若无则查看最近一次提交。
```bash
git diff HEAD || git diff HEAD~1 HEAD
```

## 2. 内容提炼 (Extraction)
分析变更并提炼为 3-5 条简短的中文更新点。
*   *参考格式*：`> 功能/组件名：具体改进点`

## 3. 定位与更新 (Locate & Update)
读取 `./README.md`，找到 `<p align="center"><font color="gold" size="3"> # 更新日志</font></p>` 标记。
在标记下方的第一个版本号之前插入新版本块。

## 4. 示例格式 (Example Format)
```markdown
## v1.2.0

> 模块名：更新要点1

> 模块名：更新要点2
```

# 关联检查 (Cross-Check)
*   **版本号同步**：检查 `src/constants/version.ts` 中的 `APP_VERSION` 是否已更新。
*   **预览确认**：在执行 `apply_diff` 前，先向用户展示提炼后的更新点并获得确认。
