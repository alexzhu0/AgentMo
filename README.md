# AgentMo

**v0.1 Alpha：核心建设能力已实现，端到端可用性验收中。**

AgentMo通过 **Discover → Plan → Produce**，把明确需求和授权资料构建成可复现的Pi CLI Agent：保留来源、设计、构建合同、安装包和可审计的运行证据。

首版面向本机单用户文字任务，使用Codex构建、Pi原生provider与SessionManager运行，保留薄CLI入口。当前固定MiniMax M3；会议助手方向已停止，浏览器不是首版交付条件。

## 目前能做什么

| 环节 | 已实现的行为 |
| --- | --- |
| Discover | 有边界地记录来源、授权资料和证据缺口 |
| Plan | 生成Design Plan、Blueprint和Build Contract，保留用户批准 |
| Produce | 生成Pi Package与.d42归档，按精确计划安装 |
| 使用 | CLI逐请求展示预览、确认、发送文字和选择原生会话 |

2026-11-09实测：首条M3请求及独立内容评审通过；同会话追问遇到ECONNRESET，已停止且没有补跑；会话隔离和最终恢复尚未验收。累计本地预留48.98元，原100元上限保留；预留不是供应商账单。全仓检查仍未完整通过，Alpha状态不代表生产就绪。详见[当前状态](docs/CURRENT_STATUS.md)。

## 开始使用与阅读

1. 从[Pi CLI运行手册](docs/CORE_MVP_RUNBOOK.md)了解输入、确认、会话和费用边界。
2. 向Codex提供明确任务、输入输出要求和授权文字或本地资料，按三阶段生成工件。
3. 新的真实安装、激活和模型请求分别先看具体预览再批准；历史预览和已消费批准不能重放。

Node.js要求20以上。可以用 `node ./bin/agentmo.js --help` 和 `node ./bin/agentmo.js pi-chat --help` 查看入口；help不会启动SDK或调用模型。新电脑只clone代码，不能凭仓库恢复本机预算、批准存储或已安装状态。

| 要了解的内容 | 入口 |
| --- | --- |
| 产品概念与范围 | [CONCEPT](docs/CONCEPT.md) |
| 当前事实、限制和下一步 | [CURRENT_STATUS](docs/CURRENT_STATUS.md) |
| 文档分类 | [文档索引](docs/README.md) |
| 控制器、协作角色和TODO | [交接入口](docs/handoffs/README.md) |
| 精确三阶段契约 | [STAGE_CONTRACTS](docs/STAGE_CONTRACTS.md) |
| CLI、Builder/UAT、OpenClaw机制 | [技术参考](docs/reference/CLI_REFERENCE.md) |
| 历史版本与脱敏证据 | [release索引](release/README.md) |

## 契约与证据边界

Discover使用`discover-live`、`discovery-approve`等已有入口；Plan使用`decision-ledger`、`design-plan`、`blueprint-draft`、`build-contract`和`plan-approve`。契约包括`agentmo.discovery-approval.v1`、`agentmo.build-contract.v1`、`agentmo.plan-approval.v1`。

Phase 3 specifies and approves the plan. Phase 4 generates and installs artifacts. Phase 5 executes runtime and recovery. `extraction_field` is a declarative extraction requirement. Approvals record local operator intent, not authenticated organizational identity. Mechanism evidence does not certify domain quality or production readiness.

`declared-ready`证明确定性机制接线，`live-success`证明有界运行；birth-report仍须fail-closed、不能自证。`observe-run`只能提案，不能自动修改蓝图、运行时或评测。

## Session recovery and current handoff

新会话按顺序读取：

1. `AGENTS.md`（由本机提供时）
2. `docs/SUPERPOWERS_WORKFLOW.md`
3. `docs/CURRENT_STATUS.md`
4. `release/README.md`
5. `docs/MVP_RUNBOOK.md`

从仓库根核对git状态、分支和HEAD，再读[角色与TODO](docs/handoffs/README.md)。不读取.env内容，不操作兄弟项目。旧OMX迁移页仅为历史。

## Why this exists

领域Agent应当是有来源、工件、运行边界和证据的软件，不是一条无法复现的提示词。范围和协作规则见[CONTRIBUTING](CONTRIBUTING.md)。

## 项目结构与检查

`src/`为机制实现，`bin/`为CLI，`test/`为回归；`docs/`存当前手册、规格和参考，`release/`存按日期的事实与脱敏证据。`.agentmo/`、`.superpowers/`、`.env`及本机工作树不属于上传内容。

源码检查使用`npm run check`，提交前运行`git diff --check`。完整检查的未解决缺口见当前状态；不能用定向通过代替全仓通过。
