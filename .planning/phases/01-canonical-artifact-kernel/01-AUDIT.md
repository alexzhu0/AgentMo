# Phase 1 原始计划审计与拆分记录

**Date:** 2026-07-11
**Status:** Superseded by approved split
**Scope:** 原 Phase 1（CORE-01/02/03/04、COMP-01、EVID-03）

## Outcome

原 Phase 1 把规范身份、legacy migration、跨进程 artifact admission、全 writer 秘密边界、真实 Node 20 证明、OpenClaw runtime gate 与 release evidence 放进同一个执行阶段。计划虽然可被拆成结构合法的小文件，但跨计划契约和 current-surface coverage 持续扩大，已经不再是可高置信执行的单一 vertical increment。

用户批准将其拆分为：

1. **Phase 1 — 规范内核与安全迁移：** CORE-01、CORE-02、CORE-03。
2. **Phase 1.1 — 工件准入与秘密边界：** CORE-04、EVID-03。
3. **Phase 1.2 — OpenClaw 运行时与发布证据：** COMP-01。

旧的 13 份 `01-*-PLAN.md` 已被移除，避免 GSD 将未通过 checker 的候选计划视为可执行输入。本文件保留审计结论，不保留原始智能体 transcript 或未经清洗的工具输出。

## Revision Gate History

| Check | Plan shape | Result | Interpretation |
|------|------------|--------|----------------|
| Initial | 4 plans | 7 blockers, 3 warnings | scope、digest authority、runtime bypass、identity sweep、TOCTOU 与 hostile diagnostics 不闭合 |
| Revision 1 | 13 plans / 7 waves | 5 blockers, 3 warnings | scope 与部分安全项改善，但 official callers、writer gates、D-02 loader matrix 仍不闭合 |
| Revision 2 | 13 plans | 8 blockers, 1 warning | issue count 回升；依赖图、current writer/caller inventory 与执行准备度证明该 phase 过宽 |

所有候选计划在被 supersede 前均通过：

- `frontmatter.validate --schema plan`
- `verify.plan-structure`
- `git diff --check -- .planning/phases/01-canonical-artifact-kernel`

结构有效不代表计划能够实现 phase goal；最终 Revision Gate 未通过，因此没有运行 `$gsd-execute-phase`，没有据此修改产品源码，也没有把 STATE/ROADMAP 标记为 planned/complete。

## Risk Routing

### Phase 1 必须闭合

- 当前新输出、CLI、schema、公开文档和生成文案只使用 AgentMo identity。
- 顶层生命周期只有 `Discover -> Plan -> Produce`；旧长生命周期仅能是明确的 legacy context 或 Produce 内部 maturity/gates。
- 每个适用 ordinary loader 在 canonical admission 前做 closed legacy inspection，并返回精确 `AGENTMO_MIGRATION_REQUIRED`。
- `agentmo migrate` 默认 preview、显式 `--out`、全批先验证、源文件不变、versioned value-blind receipt。
- 输出发布必须对 symlink/parent swap/TOCTOU 失败关闭；不得声称 pathname recheck 能提供不存在的原子保证。

### Phase 1.1 必须闭合

- exact raw bytes 的独立强制 digest，单次读取后 hash-before-parse。
- closed durable-artifact identity/validator registry 与 fresh-process handoff。
- `SecretRef`/presence/redacted-summary policy 和每个当前 writer 的 pre-write persistability gate。
- generated scaffold、live-smoke helper 与 maintained runbooks 的 per-subject digest binding。
- hostile nested key/value/subject/pointer/raw prompt/transcript/tool/stdout/stderr 的 value-blind zero-write matrix。

### Phase 1.2 必须闭合

- 真实 Node 20 lane，不以 `engines` 或 mocked version 代替执行证据。
- OpenClaw target range 在最低、不可绕过的 production mutation/spawn seam 强制执行。
- `scripts/openclaw-live-smoke.sh` 等直接 mutation 路径不能形成旁路。
- release matrix 分开记录 core/target 的 declared、tested、untested 与 remaining risk。

## Planning Guardrail

后续每个拆分 phase：

- 只规划当前 phase requirements，不提前展开后续 phase。
- 不重复 phase research；只对 live source 做有界 seam/inventory 核对。
- 计划必须小到可以在通过一次独立 checker 后立即执行。
- checker 若发现跨 scope 问题，记录到对应后续 phase，不把当前 phase 再膨胀成原始大包。
