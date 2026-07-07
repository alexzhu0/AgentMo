# AgentMo Release Records

本目录记录 AgentMo 每个阶段性大版本的设计动机、实际能力、验证证据和剩余风险。

命名规则：

```text
YYYY.MM.DD.md
```

每个日期文件按以下结构维护：

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

| 日期 | 阶段 | 状态 | 记录 |
| --- | --- | --- | --- |
| 2026.07.07 | Stage 3 delivery closure：domain-eval + delivery-report | 已提交并发布到 GitHub Release `v0.1.0` | [`2026.07.07.md`](./2026.07.07.md) |
| 2026.07.06 | MVP birth-loop：discover -> need -> draft -> handoff -> birth-report | 已提交到 `83dc9e5`，后续安全修复到 `e287988` | [`2026.07.06.md`](./2026.07.06.md) |
| 2026.07.05 | DeepSeek/OpenClaw live POC 与产品化规划 | POC/规划完成；记录为历史阶段证据 | [`2026.07.05.md`](./2026.07.05.md) |
| 2026.07.03 | AgentMo v0.1 baseline + runtime evidence spine | 已提交到 `93da9b5` | [`2026.07.03.md`](./2026.07.03.md) |

## 当前恢复锚点

- 当前项目：`/home/alex/DTAlex/learningGitHub/AgentMo`
- 当前 release tag：`v0.1.0`（已 push，GitHub Release 已发布）
- GitHub Release：<https://github.com/alexzhu0/AgentMo/releases/tag/v0.1.0>
- Stage 3 功能提交：`3dfb597`，release baseline 提交：`3e3592b`
- 当前重点：AgentMo 第三阶段交付闭环已实现并通过本地验证，日期型 release 记录已作为 GitHub release assets 同步。
- 当前主线：继续只在 AgentMo 内维护，不把 sibling projects 的工作混入本仓库 commit。
- 当前恢复入口：`docs/OMX_SESSION_MIGRATION.md`、仓库根目录 `AGENTS.md`、`docs/MVP_RUNBOOK.md`。
