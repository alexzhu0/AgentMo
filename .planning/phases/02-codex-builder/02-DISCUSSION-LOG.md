# Phase 2: 可安装且可恢复的 Codex Builder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 2-codex-builder
**Areas discussed:** 参考架构、跨工具边界、首次入口、安装范围、checkpoint、能力降级、升级与所有权

---

## 跨工具架构

| Option | Description | Selected |
|--------|-------------|----------|
| Codex-specific core | 将 Builder 核心直接绑定 Codex Plugin/Hooks | |
| Host-neutral core + adapters | Canonical AgentMo core 与版本化 adapter contract；Codex 为首个完整 adapter | ✓ |
| 同时实现多个 host | v1 同时完成 Codex、Claude Code、OpenCode 等 | |

**User's choice:** Codex v1 首发可以，但必须从一开始为后续 coding agent 对接保留真实架构边界。
**Notes:** 参考 GSD、Superpowers 和 OMX 的 canonical source + host adapter 逻辑；不能以未来重写核心为代价换取当前速度。

---

## 首次入口

| Option | Description | Selected |
|--------|-------------|----------|
| 智能路由 | `$agentmo` 根据 checkpoint 新建或恢复，直接阶段命令作为协议入口 | ✓ |
| 固定菜单 | 每次先展示操作菜单 | |
| 只允许显式阶段命令 | 用户必须指定阶段或 resume | |

**User's choice:** 智能路由。
**Notes:** 用户质疑“高级用户”概念，因此直接阶段命令不作为用户等级，而作为 adapter、测试、自动化和恢复接口。

---

## 安装范围

| Option | Description | Selected |
|--------|-------------|----------|
| 项目级默认 | 默认隔离到当前项目，用户级必须显式选择 | ✓ |
| 用户级默认 | 安装一次后所有项目共享 | |
| 仅项目级 | 不提供用户级作用域 | |

**User's choice:** 项目级默认。
**Notes:** 保留显式 user scope，但不能成为默认或隐式副作用。

---

## Checkpoint 时机

| Option | Description | Selected |
|--------|-------------|----------|
| 稳定边界自动 + 手动 pause | 工件、批准、阶段切换自动保存，也允许随时暂停 | ✓ |
| 仅手动 pause | 只在用户主动暂停时保存 | |
| 每轮对话保存 | 将每轮上下文持久化 | |

**User's choice:** 稳定边界自动保存并支持手动 pause。
**Notes:** 不持久化原始对话；hook 不得自动批准或推进阶段。

---

## 缺失宿主能力

| Option | Description | Selected |
|--------|-------------|----------|
| Required fail-closed、optional explicit degrade | 必需能力阻断；可选能力只能使用声明过的 fallback 或禁用 | ✓ |
| 任一缺失都拒绝 | 所有 capability 缺失均阻断 | |
| 始终 best-effort | 无论缺失什么都尽力安装 | |

**User's choice:** 必需能力失败关闭、可选能力显式降级。
**Notes:** 支持声明必须绑定真实 capability 和 behavior evidence。

---

## 升级策略

| Option | Description | Selected |
|--------|-------------|----------|
| 显式升级 | 用户触发、预览 exact plan、批准后更新 pristine owned assets | ✓ |
| 启动时提醒 | 自动检查版本但仍等待批准 | |
| 自动升级 | 后台或启动时直接修改 | |

**User's choice:** 仅显式升级。
**Notes:** 用户修改、未知所有权或损坏 receipt 必须保留资产并失败关闭；doctor 严格只读。

---

## the agent's Discretion

- 依据当前官方 Codex capability 研究选择单一发行物的技术运输形式。
- 在不改变用户决策的前提下确定 manifest、checkpoint 与 receipt 的内部字段和模块边界。

## Deferred Ideas

- Codex 之外 coding tool 的生产级 adapter 实现。
- OpenClaw Agent Package target 生命周期与领域质量认证。
