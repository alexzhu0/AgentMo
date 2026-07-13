# Phase 1: 规范工件内核与安全迁移 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-11
**Phase:** 1-规范工件内核与安全迁移
**Areas discussed:** 迁移入口, 输出与回执, 兼容覆盖范围, 失败与批处理

---

## 迁移入口

| Option | Description | Selected |
|--------|-------------|----------|
| 显式 `agentmo migrate` | 普通读取只提示迁移，只有专用命令可以生成迁移计划或输出 | ✓ |
| 读取时自动归一化 | validator/loader 遇到旧工件时自动转换 | |
| 显式默认、可 opt-in 自动迁移 | 默认专用命令，同时提供自动转换开关 | |

**User's choice:** 接受建议 — 只使用显式 `agentmo migrate`。
**Notes:** 用户不需要理解内部实现；核心偏好是避免隐藏副作用。

---

## 输出与回执

| Option | Description | Selected |
|--------|-------------|----------|
| 专用输出目录并先预览 | 默认只展示计划，指定 `--out` 后写入并生成 receipt | ✓ |
| 原文件旁生成新文件 | 自动在每个输入旁创建规范副本 | |
| 默认只输出 stdout | 不提供受管目录或持久 receipt | |

**User's choice:** 接受建议 — 默认预览，显式 `--out` 写入专用目录。
**Notes:** 原文件永不覆盖；receipt 必须 value-blind。

---

## 兼容覆盖范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全部已知机器工件 | 使用 registry 覆盖当前全部 legacy JSON/schema identity | ✓ |
| 仅 blueprint 与 report | Phase 1 只支持两个最明显的旧契约 | |
| 按工件逐步增加 | 每个后续 phase 再补一类迁移 | |

**User's choice:** 接受建议 — 一次覆盖当前全部已知机器工件。
**Notes:** Markdown 自然语言不作为数据迁移输入；公开文档通过正常更新改名。

---

## 失败与批处理

| Option | Description | Selected |
|--------|-------------|----------|
| 整批原子化 | 先验证全部输入；任一失败则整批不写入并返回逐项脱敏结果 | ✓ |
| 安全文件部分成功 | 合法输入继续写入，失败项单独跳过 | |
| 首错即停 | 遇到第一个错误后不再检查其余输入 | |

**User's choice:** 接受建议 — 整批校验通过后才写入。
**Notes:** 避免半新半旧状态；失败报告不包含原始敏感内容。

## the agent's Discretion

- migration registry、plan/apply/receipt 的代码拆分。
- CLI 的稳定错误码、formatter 和精确输出文件名。
- 单文件/批量 plan schema 复用方式与测试 helper 组织。

## Deferred Ideas

None.
