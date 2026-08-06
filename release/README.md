# AgentMo Release Records

本目录记录 AgentMo 每个阶段性大版本的设计动机、实际能力、验证证据和剩余风险。

产品目标、项目演进和当前/未来方向的总览见
[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)。各日期记录仍是精确实现与验证事实的
权威来源。

命名规则：

```text
YYYY.MM.DD.md
```

每个日期文件按以下结构维护，并在 GitHub Releases 中作为对应日期 release 的正文使用（不是 asset 附件）。历史日期 release 使用 `release-YYYY.MM.DD` tag；`2026.07.07` 同时承载 `v0.1.0` release baseline tag：

- 背景：为什么进入这个阶段。
- 范围：本阶段新增或确定了什么。
- 架构决策：哪些路线被采用，哪些被拒绝。
- 代码/文档入口：后续 agent 应该从哪里恢复上下文。
- 验证证据：只记录命令、结果、路径、hash、摘要。
- 非认证边界：明确哪些能力还不能宣称生产可用或领域认证。
- 后续风险：下一轮必须注意什么。

禁止写入本目录的内容：

- `.env` 内容或任何密钥值。
- OpenClaw credential-bearing state。
- 原始 stdout/stderr 全量日志。
- 原始对话 transcript。
- 未脱敏 tool body 或 provider payload。

## 日期索引

Release 记录按日期倒序维护（最新在前），不要按版本号排序。版本号只作为某个日期记录下的发布标签。

| 日期 | 阶段 | 状态 | 记录 | GitHub Release |
| --- | --- | --- | --- | --- |
| 2026.08.06 | 白领 Research DB / OpenClaw 独立黑盒 POC | 验收运行 PASS：首次 20 条、二次 0 重复、重启恢复、8 证据/0 缺口 brief 与证据约束问答通过；schedule、完整来源健康与生产认证仍未完成 | [`2026.08.06.md`](./2026.08.06.md) | [`release-2026.08.06`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.08.06) |
| 2026.08.05 | 白领 Research DB / OpenClaw POC 与全量检查单飞门禁 | POC 专项、Builder 生命周期与 tarball 安全验证通过；真实采集、scheduler activation 与完整无竞争全量 gate 仍待完成；未发布 release | [`2026.08.05.md`](./2026.08.05.md) | 待发布 |
| 2026.08.04 | Phase 4：native authority race closure 与 POC 前最终 Linux gate | fresh review 的最终 2 Critical / 1 Warning 已完成源码与聚焦 Linux 修复；精确 commit、完整 8/8 CI 与零缺陷 re-audit 待完成；未发布 release | [`2026.08.04.md`](./2026.08.04.md) | 待发布 |
| 2026.08.03 | Phase 4：exact-candidate Linux/full gate 与 gap-closure pre-audit 证据 | `d943bc0` run `30799041760` 8/8 jobs green；fresh noncanonical audit 3 Critical / 1 Warning，Phase 4 blocked；未发布 release | [`2026.08.03.md`](./2026.08.03.md) | 待发布 |
| 2026.08.02 | Phase 4：authority-root、named candidate 与 Linux supervisor 多轮对抗加固 | remediation 已进入 `codex/phase2-poc-baseline` Linux CI 候选；Darwin 聚焦 gate 6 pass / 0 fail / 11 Linux skip；精确 commit 的 Linux gate 后再复审，未发布 release | [`2026.08.02.md`](./2026.08.02.md) | 待发布 |
| 2026.07.31 | Phase 4：8 Critical / 2 Warning post-audit remediation，canonical ledger、producer-auth evidence、Linux retained-candidate config、bounded process group、nested closure 与 recoverable evidence | current-source full/pack/diff 已绿；fresh re-audit Critical 3 / Warning 0，Phase 4 blocked；未提交或发布 | [`2026.07.31.md`](./2026.07.31.md) | 待发布 |
| 2026.07.30 | Phase 4：fresh reprobe、retained-dirfd helper、durable authority、four lifecycle、strict receipts 与 extracted source-only distribution | 04-19 最终 lane-structured gate exit 0：main 935 pass/0 fail、两条负载敏感场景各 1/1；pack 99 entries 与 diff-check exit 0；noncanonical/canonical review 仍待执行，未提交或发布 | [`2026.07.30.md`](./2026.07.30.md) | 待发布 |
| 2026.07.29 | Phase 4：deterministic Agent Package、D-42 archive-only authority 与 ownership-safe receipt-last lifecycle | canonical 40-member package；四 lifecycle mechanism 与 packed closure 已完成；real OpenClaw/Phase 5 evidence absent；未提交或发布 | [`2026.07.29.md`](./2026.07.29.md) | 待发布 |
| 2026.07.28 | Phase 3：bounded discovery、exact Plan authority、append-only ledger 与 strict Package build contract | 03-05 affected aggregate 165/165；未运行 live Internet/OpenClaw，未提交或发布 | [`2026.07.28.md`](./2026.07.28.md) | 待发布 |
| 2026.07.27 | Independent AgentMo-only POC：artifact contract 可发现性、字段诊断与 Plan 证据语义修复 | 增量 POC 到达 Produce scaffold；Stage 2 63/63，通过真实 POC 输入重放；live collector/package runtime 未实现 | [`2026.07.27.md`](./2026.07.27.md) | 待发布 |
| 2026.07.23 | Phase 02 Builder hardening：hook graph、append-only recovery、UAT authority 与 bounded projection batch | 本地 aggregate 760/0 通过；fresh review Critical/Warning 0；real UAT 未运行 | [`2026.07.23.md`](./2026.07.23.md) | 待发布 |
| 2026.07.22 | Phase 02 review-fix：10 Critical + 1 Warning 的 Builder v1 mechanism closure | 本地 aggregate 712/712 通过；independent review / real UAT pending | [`2026.07.22.md`](./2026.07.22.md) | 待发布 |
| 2026.07.21 | Phase 02 transaction-bound publication 与 deactivation continuation recovery | 本地 bounded mechanism gate 通过 | [`2026.07.21.md`](./2026.07.21.md) | 待发布 |
| 2026.07.20 | Phase 02 verifier boundary 与首次 verifier-inclusive bounded failure | 合法 fail-closed outcome；Phase 02 incomplete | [`2026.07.20.md`](./2026.07.20.md) | 待发布 |
| 2026.07.17 | Phase 02 installed Codex hook recovery bridge | 本地 bounded mechanism gate 通过 | [`2026.07.17.md`](./2026.07.17.md) | 待发布 |
| 2026.07.16 | Phase 02 Builder projection、activation 与 lifecycle | 历史实现记录；后续 v1 append-only contract 已取代 destructive surface | [`2026.07.16.md`](./2026.07.16.md) | 待发布 |
| 2026.07.15 | Phase 02 Codex Builder first bounded-failure record | 合法 fail-closed outcome；非 UAT success | [`2026.07.15.md`](./2026.07.15.md) | 待发布 |
| 2026.07.13 | Phase 01.2 runtime compatibility：Node 20 receipt + pre-effect OpenClaw gates | 有界复跑通过；记录与实现须同一 `main` checkpoint | [`2026.07.13.md`](./2026.07.13.md) | 待发布 |
| 2026.07.12 | Phase 01.1 blueprint-to-handoff exact admission closure | 本地 evidence gate 通过 | [`2026.07.12.md`](./2026.07.12.md) | 待发布 |
| 2026.07.11 | Phase 01.1 canonical legacy migration apply | 本地 retained-handle mechanism gate 通过 | [`2026.07.11.md`](./2026.07.11.md) | 待发布 |
| 2026.07.10 | Stage 2 design-plan contract：DB+need -> design-plan -> blueprint | 本地验证通过，待提交/发布 | [`2026.07.10.md`](./2026.07.10.md) | 待发布 |
| 2026.07.07 | Stage 3 delivery closure：domain-eval + delivery-report | 已提交并发布到 GitHub Release `v0.1.0` | [`2026.07.07.md`](./2026.07.07.md) | [`v0.1.0`](https://github.com/alexzhu0/AgentMo/releases/tag/v0.1.0) |
| 2026.07.06 | MVP birth-loop：discover -> need -> draft -> handoff -> birth-report | 已提交到 `83dc9e5`，后续安全修复到 `e287988` | [`2026.07.06.md`](./2026.07.06.md) | [`release-2026.07.06`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.06) |
| 2026.07.05 | DeepSeek/OpenClaw live POC 与产品化规划 | POC/规划完成；记录为历史阶段证据 | [`2026.07.05.md`](./2026.07.05.md) | [`release-2026.07.05`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.05) |
| 2026.07.03 | AgentMo v0.1 baseline + runtime evidence spine | 已提交到 `93da9b5` | [`2026.07.03.md`](./2026.07.03.md) | [`release-2026.07.03`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.03) |

## 当前恢复锚点

- 当前项目：`$AGENTMO_REPO`
- 当前短期恢复入口：先读 `docs/CURRENT_STATUS.md`，再读本索引与 `release/2026.08.06.md`。该页区分已验收的隔离白领 Research DB / OpenClaw POC、尚未提交的 Dashboard worktree，以及仍需独立证明的 Linux native / 生产化边界。
- Phase 4 maintained records：`release/2026.07.29.md` 至 `release/2026.08.04.md` 保留 deterministic package、Linux gate 与审计历史；它们不被 2026-08 POC 结果覆盖。`release/2026.08.05.md` 与 `release/2026.08.06.md` 记录独立 POC lane 与其边界。
- 历史已记录的 published baseline：`v0.1.0`；当前日期记录不推断新的 tag、GitHub Release、npm publication 或 deployment。
- 当前重点：隔离 POC 已能通过 Dashboard 与 DeepSeek 对本地 Research DB 对话；schedule、投递、默认 OpenClaw 安装、完整来源健康、领域质量与生产认证均未获授权或证明。Linux native evidence 仍是 Phase 4 的独立 future gate；Mac POC 不需要迁移到 Linux。
- 当前迁移规则：projected-v2 canonical receipt 不允许原位替换为 activated-v4；保留 genesis，并使用 immutable version-qualified lifecycle successor。`deactivate` 追加 tombstone，`reactivate` 追加 successor；不提供 purge、selector removal 或 physical delete。
- 当前 UAT authority：`preview` 只读；`decide approve|reject` 仅 caller-reported 且 nonterminal。独立 external human decision authority 尚未实现，不得声称 11/11、domain 或 production certification。
- 当前主线：继续只在 AgentMo 内维护，不把 sibling projects 的工作混入本仓库 commit。
- 当前恢复入口：`docs/CURRENT_STATUS.md`、`release/2026.08.06.md`、`docs/OMX_SESSION_MIGRATION.md`、仓库根目录 `AGENTS.md`、`README.md`、`docs/MVP_RUNBOOK.md`；需要追溯 Phase 4 时再读相应 `.planning/phases/04-package/` 与 2026.07.29–2026.08.04 release records。
