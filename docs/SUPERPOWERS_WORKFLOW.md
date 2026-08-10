# AgentMo Superpowers 协作与恢复

AgentMo 后续开发只使用 Superpowers。每个新的 AgentMo Codex 开发 session 都必须先调用
`superpowers:using-superpowers`，再按任务选择并使用适用的 Superpowers skills。不要调用
GSD 命令、恢复 GSD runtime，或按旧规划工作流的待办执行。`docs/superpowers/` 保留
Superpowers 的设计与计划文档，是当前协作过程的唯一专用目录。

## 新 session 的最小阅读顺序

1. `AGENTS.md`
2. 本文与 `docs/CURRENT_STATUS.md`
3. `release/README.md`、`release/2026.08.06.md`、`release/PROJECT_HISTORY.md`
4. `README.md`；涉及机制或运行时再读 `docs/MVP_RUNBOOK.md`、
   `docs/AGENT_BIRTH_GATE.md` 与 `docs/STAGE_CONTRACTS.md`
5. 在实际工作目录运行 `pwd`、`git status --short`、`git branch --show-current`、
   `git rev-parse --short HEAD`，再以源码和相关测试核实要改动的行为。

不读取 `.env` 或输出密钥；不操作 sibling projects；不提交、push、创建 Release，除非
用户明确授权。

## 当前产品与 POC

AgentMo 的规范主线是 `Discover -> Plan -> Produce`：把有边界的发现证据、经人确认的
规划和可验证的 Agent Package 连接成可复现的软件产物。当前白领研究 OpenClaw POC
已完成受限验收：首次收集 20 条、二次收集 0 条重复、重启后 DB/brief 可读，并能让
DeepSeek/OpenClaw 仅依据本地证据短答或在缺证据时拒答。它仍是隔离、临时 workspace
中的 POC，不是默认 OpenClaw 安装、持续服务或生产发布。

## 未完成项与人工授权边界

- 当前 Dashboard/测试/文档改动仍在隔离 worktree；先由人审阅并决定是否分组提交。
- Phase 4 的 Linux native 机制证据、审计历史和 POC 结果互不替代。Linux CI、真实
  OpenClaw 生命周期、schedule activation、delivery、完整来源健康、领域质量和生产
  认证都需要单独的明确授权与证据。
- 不得因 `declared-ready`、`live-success`、短问答、POC 或 release 记录而推断领域
  质量、生产就绪或更广泛 OpenClaw 兼容性。
- `observe-run` 仅能提出变更建议，不能自动改动 blueprint、scaffold、runtime 或 eval。

## 历史追溯

从 `release/PROJECT_HISTORY.md` 定位阶段，再读相应日期 release 获取当时的精确证据、
摘要、哈希和非认证边界。旧 release 可能保留当时的旧规划路径以忠实记录历史；这些路径
在迁移删除后不再是工作入口。需要一个可执行的未来计划时，在
`docs/superpowers/specs/` 和 `docs/superpowers/plans/` 新建并维护 Superpowers 文档，
而不是重建旧规划工作区。
