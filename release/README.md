# AgentMo Release Records

本目录记录 AgentMo 每个阶段性大版本的设计动机、实际能力、验证证据和剩余风险。

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
- 当前 repository release record：日期索引首行的 2026.07.27 entry。它记录 independent AgentMo-only POC 暴露的 artifact contract 可发现性、字段诊断与 Plan 证据语义修复；增量黑盒已到达 declaration-only scaffold，live collector 与可执行 Package 仍未实现。
- 历史已记录的 published baseline：`v0.1.0`；当前日期记录不推断新的 tag、GitHub Release、npm publication 或 deployment。
- 当前重点：让独立 POC 确认 manifest declarations 不再得到 `supported`，然后依据真实证据进入 allowlist-bound live collector；不要把 contract export、manifest metadata、scaffold declarations 或 aggregate success 升格为 real UAT、domain certification 或 production certification。
- 当前迁移规则：projected-v2 canonical receipt 不允许原位替换为 activated-v4；保留 genesis，并使用 immutable version-qualified lifecycle successor。`deactivate` 追加 tombstone，`reactivate` 追加 successor；不提供 purge、selector removal 或 physical delete。
- 当前 UAT authority：`preview` 只读；`decide approve|reject` 仅 caller-reported 且 nonterminal。独立 external human decision authority 尚未实现，不得声称 11/11、domain 或 production certification。
- 当前主线：继续只在 AgentMo 内维护，不把 sibling projects 的工作混入本仓库 commit。
- 当前恢复入口：`release/2026.07.27.md`、`release/2026.07.23.md`、`.planning/phases/02-codex-builder/02-FINAL-RELEASE-REVIEW.md`、`docs/OMX_SESSION_MIGRATION.md`、仓库根目录 `AGENTS.md`、`README.md`、`docs/MVP_RUNBOOK.md`。
