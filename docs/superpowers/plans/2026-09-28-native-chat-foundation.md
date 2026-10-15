# Native Chat Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if selected by the user. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让明确不需要工具的单 Agent 需求能够生成合法、可追溯的 Plan、Blueprint 和精简 OpenClaw workspace，不再虚构工具或子 Agent。

**Architecture:** 复用 `user-need → design-plan → blueprint-draft → scaffold`。以显式 `execution_profile: "native-chat"` 表达窄范围选择，缺省维持旧行为；此批不改正式 Package/安装协议，也不让 scaffold 获得运行授权。

**Tech Stack:** 现有 Node.js ESM、`node:test`、OpenClaw workspace 文件；零新增依赖。

**Spec:** [已批准概念设计](../specs/2026-09-28-agentmo-concept.md)

状态：用户已要求直接实施。任务 1–3 已按 TDD 实施；独立审查的唯一 Important 问题已修复。2026-09-29 已修复 I/O 清单问题，完整五段 `npm run check` 退出 0；记录见 `release/2026.09.29.md`。这不是实际原生入口验收。

执行结果：125/125 聚焦测试通过；scaffold/CLI 10/10 包含强制复用旧目录的拒绝与原文件保留回归。native-chat 即使指定 `--force` 也要求空输出目录。Node 20 与发布后消费者证据见 `release/2026.09.28.md`；不安装、激活、调用付费 API 或 commit/push。

## Global Constraints

- 保留 Discover → Plan → Produce 及精确工件授权；设计批准不是 enter-Produce、安装、激活或 runtime 批准。
- 不读 `.env`，不保存凭据、原始对话或原始 provider payload。
- 不添加新 UI、LLM 编排器、RAG、插件、后台调度或第三方依赖。
- 保留现有 Course Wiki 改动和证据；不操作用户服务 18789/17893，不 commit/push。
- 会议文字助手后续验收要求：每条 8,000 字符、缺失字段“未说明”、纠正/追问、新会话隔离、重启、注入、可见失败和不自动付费重试；本批不得声称这些运行时行为已通过。
- 付费预算继续使用原累计 CNY 100 账本，本批零付费调用。

## Review Focus

1. 缺省/未知 profile：旧需求行为不变，拼写错误必须拒绝，不能悄悄切换权限（任务 1、2）。
2. 声明 native-chat 却带工具或 specialist：校验失败，而非丢掉冲突字段继续（任务 1）。
3. 中文需求和硬失败条件：保留原文；不能将中文 slug 化成空串或丢失边界（任务 2、3）。
4. 工件被修改或缺少授权：旧 approval 不可复用；native-chat 不能进入尚不支持它的正式 Build Contract（任务 2）。
5. 生成成功被误当作可聊天：产物不能声称安装、有效工具权限或 runtime 成功，旧场景生成不退化（任务 3）。

## 为什么先交这个批次

已追踪实际调用：`design-plan.js` 和 `blueprint-draft.js` 都把任务映射成工具/子 Agent；
`blueprint.js` 又强制工具非空。`scaffold-files.js` 可复用，但默认生成技能、记忆和示例路由。
正式 `package-carriers.js` / `targets/openclaw-package.js` 要求插件 owner，且投影有固定领域内容。
因此不能删一个校验就宣称已实现“一句话创建”。先修复定义到生成这个可独立验证的缺口，
不在同一批里重构 22 类正式资源、安装事务和模型运行链。

## Task 1：显式无工具定义，不改变旧合同默认值

**Files:** Modify `src/user-need.js`, `src/artifact-contract.js`, `src/blueprint.js`; Test `test/user-need.test.js`, `test/blueprint.test.js`, `test/artifact-contract.test.js`。

**Interfaces:** 现有 `validateUserNeed(need)` / `validateBlueprint(blueprint)` 返回类型不变。
新增可选顶层 `execution_profile`，唯一接受的显式值为 `"native-chat"`；缺省仍走原逻辑。
Blueprint 的该 profile 仅适用于 `runtime: "openclaw"`，要求 `tools: []` 和 `architecture.specialists: []`。

- [x] 写 `accepts explicit native-chat and rejects conflicting capabilities` 参数化测试：合法空数组通过；缺失 tools、非数组、非空工具、非空 specialists、未知 profile、非 OpenClaw runtime 全部失败；无 profile 的空工具仍失败。
- [x] 写 `keeps user-need contract and validator aligned for native-chat`：公开 contract 声明同一枚举，旧 need 保持有效，未知/null profile 拒绝，秘密值检查保持原样。
- [x] 运行 `node --test test/user-need.test.js test/blueprint.test.js test/artifact-contract.test.js`；确认新增正向测试因旧非空工具规则/缺少 profile 规则而 RED，不是环境错误。
- [x] 修改上述既有校验器；同步 `tool_contracts_defined` quality gate，只有合法 native-chat 空工具能通过，保留其他 profile 的逐项工具验证。
- [x] 重跑相同命令，要求退出码 0；记录 RED/GREEN 用例名与退出码，不另加测试框架。

## Task 2：Plan / Draft 继承明确选择，不自动创造能力

**Files:** Modify `src/design-plan.js`, `src/blueprint-draft.js`, `src/build-contract.js`; Test `test/design-plan.test.js`, `test/blueprint-draft.test.js`, `test/build-contract.test.js`。

**Interfaces:** 保持 `buildDesignPlan(discoveryDb, userNeed, options)` 与 `draftBlueprint(discoveryDb, userNeed, options)` 签名。
native-chat 时输出同名 `execution_profile`；Plan 的 `architecturePlan.specialistPlans` 和 `toolContractPlan.tools` 为空；Draft 的 `architecture.specialists` 和 `tools` 为空。
`buildBuildContract(...)` 暂对该 profile 抛出 `BuildContractError("AGENTMO_NATIVE_CHAT_BUILD_CONTRACT_UNSUPPORTED")`，发生于持久化前。

- [x] 写 `propagates native-chat without invented capabilities`：复用已有 admitted-input helpers，用中文会议需求生成 Plan/Draft，断言四个数组为空、profile 一致、中文 purpose/hard_failures 未丢失、draft 非权威；旧 support-triage 仍有原工具。
- [x] 写 `rejects profile disagreement and unsupported native-chat build contract`：Plan/need profile 不一致时 draft 拒绝；正式 Build Contract 不得为 native-chat 输出带虚构插件/记忆/调度的合同。
- [x] 运行 `node --test test/design-plan.test.js test/blueprint-draft.test.js test/build-contract.test.js`，确认对应 RED。
- [x] 在原生成函数按已验证 profile 分支；native-chat 保留中文任务/硬失败原文，不依赖 slug 生成不存在的能力；draft 比较 need 与 Plan profile。继续通过现有 admission/write 函数，不创建旁路 writer。
- [x] 同步 `validateDesignPlan(plan)`：显式 profile 必须合法，native-chat 的工具和 specialist 数组必须为空；缺省原工件行为不变。增加篡改上述数组被拒绝的断言。
- [x] 加入上述 Build Contract fail-closed guard，重跑聚焦测试及 `node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`，均要求退出码 0。

## Task 3：生成精简 workspace，证明离线链路与边界

**Files:** Modify `src/scaffold-files.js`, `docs/MVP_RUNBOOK.md`, `release/2026.09.28.md`; Test `test/scaffold.test.js`, `test/cli-mvp.test.js`。不新增运行服务或新工件体系。

**Interfaces:** 保留 `buildTargetFiles(blueprint, targetId)`、`scaffoldAgent(blueprint, outputDir, options)`。
native-chat 的 OpenClaw 投影保留身份/任务/行为和运行边界；不生成 workspace skills、memory 目录或示例 channel binding，不附加虚构 skills 配置。
配置仍只是待审阅片段，不宣称已禁用原生工具；本批不猜测原生权限字段。

- [x] 写 `scaffolds native-chat without invented runtime capabilities`：精确 admitted Blueprint 生成 AGENTS/SOUL/IDENTITY 等必要文件，包含中文 purpose/硬失败条件；无 skills、memory 或示例绑定；build-state 保留同一 agentId、Blueprint 来源摘要和真实生成文件集合。
- [x] 写离线组合用例 `native-chat planning remains non-authoritative`：从已有 admitted Discovery helpers 和新的中文 user-need 走实际 Plan/Draft writer、CLI validate；拒绝修改后旧摘要；只在测试隔离域验证 scaffold，不伪造真实用户批准或注册 Agent。
- [x] 运行 `node --test test/scaffold.test.js test/cli-mvp.test.js`，确认 RED；只在现有渲染器中做 profile 分支。native-chat 文档明确：无工具定义不是原生运行权限证据，尚未安装/激活。
- [x] 重跑相同测试，要求退出码 0；确认旧 OpenClaw target 用例中的技能/记忆等既有输出保持不变。
- [x] 更新 runbook/release：声明本批只完成 definition/scaffold 支持，记录 changed files、命令、退出码、剩余 native binding 缺口，不加入“可使用”入口。
- [x] 运行 `npm run check` 和 `git diff --check`。2026-09-29 旧锁已不存在，未删除或绕过锁；沙箱回环权限失败后，在允许本机模拟端口的环境复测，完整五段自然退出 0。
- [x] 按现有 Node 20 producer 流程生成全新 absent receipt，成功后才发布原字节并跑消费者；核对被改模块受覆盖。实施核对发现 `artifact-contract.js` 和 `build-contract.js` 原未纳入 syntax 清单，已补齐，详见 release ruling。

## 交付后下一批，不冒充本批已完成

本批合并前后均不能宣称会议助手已经可用。概念设计第 5、6 节剩余工作是：
将 native-chat 定义映射到真实目标版本允许的最小 runtime binding，决定正式合同如何表达
“原生循环、无自定义插件”，再通过已授权注册/激活路径生成新 Agent；最后从实际原生聊天入口
执行全部既定验收并交付入口。需读目标安装版本的实际代码/配置，不能拿线上最新字段直接写入。

这部分将在本批接口稳定后形成独立的短计划；不得借本计划新增自定义 harness 或绕过安装授权。
一句话需求由现有 Codex builder 转换成用户可审阅工件，不另造关键词识别器或第二个 LLM 编排器。

## 自审与完成定义

- 概念设计 3、4、7 节的无工具定义/规划/生成缺口由任务 1–3 覆盖；完整入口与 runtime 验收明确未纳入本批。
- 五项 Review Focus 均有对应测试；同名 profile 在 need、Plan、Blueprint 一致，无跨任务隐藏参数。
- 没有 commit 步骤、真实安装步骤或付费步骤。最终独立审查只检查本批显式文件，不整理他人未提交改动。
- 验收产物为可复用源码改动与离线证据，不是会议纪要助手的完成宣告。
