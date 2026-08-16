# AgentMo 当前状态与恢复入口

更新日期：2026-08-16

本页是短期恢复锚点。它只描述当前工作状态；历史决策、审计和发布证据保留在
`release/`，不应被本页改写。旧规划工作区已移除，不是恢复权威。

## 当前结论

AgentMo 的三阶段主线仍是：

```text
Discover -> Plan -> Produce
```

当前权威架构口径已经收敛到 `docs/CONCEPT.md`：

- Discover 连接已授权的数据源，形成 Research DB，并从证据中提炼候选 Agent
  Idea，交由人类确认；
- Plan 为经独立授权的 Idea 生成 Agent 设计与验证义务；
- Produce 由 Coding Agent 按批准的规划编码，并以 Plan 预先定义的测试数据验证；
- OpenClaw 是首个 Runtime Adapter，不是 AgentMo 的永久边界；
- 外部开发工作流、规划框架和插件不属于 AgentMo 产品架构或 runtime 依赖。

这些描述包含目标架构与扩展边界，不得把尚未完成的连接器、自动 Idea 生成、
Plan 消费、Runtime Adapter 或认证能力写成当前已交付能力。通用架构和合同不得
嵌入具体领域 POC。

## 当前分支与未提交收口

当前分支在 `origin/main` 之上已有 7 个本地、尚未 push 或 integrate 的 Candidate
commits。它们记录了批准设计、proposal-only 的
`agentmo.agent-idea-candidate.v1` artifact contract、公开校验、admission/report CLI
及多轮 trust-boundary 加固；该 artifact 不包含 human decision，也不授权 Plan。

在这 7 个本地 commits 之后，当前 worktree 的后续收口批次仍未 commit，包括：

- Candidate CLI 模块拆分、Builder/runtime asset 与 syntax ownership 同步；
- OpenClaw 两个真实 child-process site 的入口前置 guard、spawn-adjacent guard，
  以及 static-import-only、fail-closed 的 child-process site inventory；browser opener
  仍是独立的本地 UI effect；
- Node.js 20.20.2 Darwin arm64 可信 producer receipt 与 post-publication consumer
  闭环。当前 receipt 为
  `release/evidence/2026.08.14-node20-core-receipt.json`，receipt SHA-256 为
  `64fd5deba66e05c94c176934a5472ecdebc15a85ac63d943257d1bc0480be538`，
  command-set digest 为
  `455e7d36ab8eb2334e0854977063637cc79bc9b9734fd3c3df2bfa6ea86894e2`。
  精确 TAP 计数为 syntax `42/0/0/42`、core `62/1/0/63`、stage
  `3/2/0/5`（pass/skip/fail/total）；consumer 为 6 pass、0 fail、exit 0。

这些本地 commits 与未提交收口均不应被假设存在于其他 checkout。Node20 receipt
只证明受限机制与发行输入 provenance，不证明领域质量、生产就绪或更广泛
OpenClaw 兼容。

## 历史 POC

白领研究型 OpenClaw POC 的一次独立、受限验收发生于 2026-08-06。该历史验收和
边界记录在 `release/2026.08.06.md`；它不承诺当时的临时 worktree 或 workspace
仍然存在，也不等于生产可用、完整来源健康、领域认证或自动化发布。

以下仅保留命令形状作为历史说明，不是当前恢复步骤：

```text
node ./bin/agentmo.js poc dashboard <historical-workspace> \
  --profile <historical-profile> \
  --model <historical-model> \
  --runtime-env-file <absolute-runtime-env-file> \
  --port <loopback-port>
```

POC 的 schedule 只曾得到 preview；没有由该历史验收授权 schedule activation、
投递或发布。macOS 的非 Linux 原生文件系统路径仍 fail closed，Linux native
Package Produce/containment 证据仍需相应 Linux gate。

## 当前验证与未完成项

Node20 post-publication consumer 已通过 6/6、exit 0。2026-08-16 的唯一最终
`npm run check` 自然 exit 0，precheck、syntax 与四段 fail-fast test chain 均完整执行：

- main：1051 tests / 996 pass / 55 skip / 0 fail；
- durable-fs：2/2 pass，其中 86-member 为 `34057.646667ms`，producer crash 为
  `20706.853958ms`；
- packed-hook-chain：1/1 pass；
- packed-behavior：8/8 pass。

这些结果只证明本次有界机制与测试集合通过，不认证领域质量、生产就绪或更广泛
OpenClaw 兼容。分支上的 7 个本地 commits 仍未 push/integrate，后续 worktree 收口批次
仍未 commit；当前没有 push、PR、tag 或 GitHub Release，也没有 npm publication。

下一步是最终独立复审；之后仍须等待用户明确授权，才能 commit、integrate 或 push。
当前没有这些授权。

## 新 session 最小恢复步骤

1. 先读 `AGENTS.md`、`docs/SUPERPOWERS_WORKFLOW.md`、本页、
   `release/README.md`、`release/2026.08.14.md`、`README.md`、
   `docs/MVP_RUNBOOK.md` 和 `docs/AGENT_BIRTH_GATE.md`。
2. 在实际工作目录运行以下实时命令，并以输出为准：

   ```text
   pwd
   git status --short
   git branch --show-current
   git rev-parse --short HEAD
   ```

3. 不读取 `.env` 内容、不记录密钥、不操作 sibling projects，除非用户明确授权。
4. 不恢复 OMX/GSD 命令或旧规划工作区；Superpowers 是仓库开发工作流，不是
   AgentMo 产品或 runtime 依赖。
5. 不把 POC 或 Node20 机制证据升级为 OpenClaw 安装、领域质量、生产就绪或发布
   认证。

历史追溯从 `release/PROJECT_HISTORY.md` 和对应日期 release 开始；归档的
`docs/OMX_SESSION_MIGRATION.md` 不是可执行恢复入口。
