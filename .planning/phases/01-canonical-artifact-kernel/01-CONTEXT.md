# Phase 1: 规范内核与安全迁移 - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

本 phase 只交付 AgentMo 的规范身份、三阶段契约和安全 legacy 迁移路径。开发者能够显式检查并迁移当前仓库已知的机器可读 AgentMother 工件，原文件保持不变；新生成工件只使用 AgentMo identity，迁移计划、诊断和 receipt 保持 value-blind。

exact-digest 工件 admission、全 writer persistability gate 与跨进程交接已路由到 Phase 1.1；真实 Node 20 lane、OpenClaw target runtime gate 与 release matrix 已路由到 Phase 1.2。本 phase 也不实现 Codex Builder 安装、实时 Discover、Package compiler、OpenClaw 安装生命周期或领域智能体功能。

</domain>

<decisions>
## Implementation Decisions

### 迁移入口
- **D-01:** legacy 迁移只能由显式 `agentmo migrate` 命令触发。普通读取、validator 和其他命令不得自动归一化或产生隐藏写入。
- **D-02:** 普通读取发现受支持的 legacy identity 时，应失败关闭并返回可操作、结构化的 `migration required` 诊断，引导用户执行显式迁移。

### 输出与 Migration Receipt
- **D-03:** `agentmo migrate` 默认只生成迁移计划/预览；只有用户显式指定 `--out` 后才允许写入。
- **D-04:** 写入目标必须是专用输出目录。不得原地覆盖源文件，也不得在源文件旁自动创建文件。
- **D-05:** 成功写入时生成版本化 migration receipt。Receipt 只记录输入/输出 identity、schema、digest、应用规则、结果和脱敏 warning，不保存原始内容、secret value、raw transcript 或未经清洗的输出。

### 兼容覆盖范围
- **D-06:** Phase 1 的 migration registry 覆盖当前仓库全部已知机器可读 legacy JSON/schema identity，包括 `agentmother_version`、`agentmother_report` 和其他公开持久工件中的旧字段。
- **D-07:** 自然语言 Markdown 不作为数据迁移输入。当前公开文档与生成模板按正常文档/代码变更统一为 AgentMo；历史 release record 可以在明确的 legacy context 中保留旧名称。
- **D-08:** 所有新 emitter、schema identity、CLI product identity 和生成 package 文案只写出 `AgentMo` / `agentmo_*`。

### 失败与批处理
- **D-09:** 批量迁移先只读解析并校验全部输入，再执行任何写入。任一输入不安全、不支持或无法迁移时，整批不写入。
- **D-10:** 失败结果按文件返回 value-blind 状态和脱敏原因；不得回显原始内容、secret-shaped material、raw private transcript 或 host-sensitive path。
- **D-11:** 输入原文件始终由用户拥有且保持不变。修正失败项后，用户重新执行整批迁移。

### 已锁定的阶段边界
- **D-12:** Agent Package 顶层生命周期严格只有 `Discover -> Plan -> Produce`；target/package install、doctor、eval 与报告是 Produce 内部 gate，Codex Builder setup 是独立构建端运维动作。

### the agent's Discretion
- migration registry、plan、apply 与 receipt 的模块边界和内部数据结构。
- CLI 的精确 flag 排列、稳定错误码和 human/JSON formatter，只要保持上述默认预览和显式 `--out` 行为。
- 规范输出文件名与 receipt schema 名称，只要使用版本化 `agentmo_*` identity 且不存在覆盖风险。
- 单文件和批量输入是否共用一个 plan schema，以及测试 helper 的组织方式。
- 以现有 validator/builder 风格实现还是抽取新的通用 contract helper；不得为此引入不必要的第三方依赖。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 已批准的产品与 phase 契约
- `.planning/PROJECT.md` — AgentMo 产品定义、三阶段、迁移、安全和证据边界。
- `.planning/REQUIREMENTS.md` — Phase 1 的 `CORE-01`、`CORE-02`、`CORE-03`；原 `CORE-04`/`EVID-03`/`COMP-01` 已分别路由到 Phase 1.1/1.2。
- `.planning/ROADMAP.md` — Phase 1 goal、scope、依赖和可观察 success criteria。

### 当前 schema 与阶段文档
- `docs/BLUEPRINT_SCHEMA.md` — 当前 `agentmother_version` legacy blueprint contract。
- `docs/STAGE_CONTRACTS.md` — artifact-only stage admission 与三阶段边界。
- `docs/AGENT_BIRTH_GATE.md` — Birth/Delivery fail-closed 与非自认证边界。
- `release/README.md` — 机制语义变化的 release evidence 记录规则。

### 代码库模式与风险
- `.planning/codebase/ARCHITECTURE.md` — contract-first layers、target adapter、managed operations 与 evidence gates。
- `.planning/codebase/TESTING.md` — `node:test`、contract/negative/CLI/vertical-slice 测试模式。
- `.planning/codebase/CONCERNS.md` — stage decoupling、secret handling、Node floor、CLI 与 schema 漂移风险。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/blueprint.js` 与 `src/blueprint-draft.js`：当前 legacy blueprint field 的验证和 emitter，是 migration registry 的首个明确输入/输出 seam。
- `src/report.js` 与 `src/build-state.js`：当前 `agentmother_report` 和 `agentmotherVersion` 持久字段，需要纳入机器工件迁移覆盖。
- `src/secret-redaction.js`：提供 explicit secret 与常见 secret shape 脱敏、host path redaction，可复用于 migration diagnostics。
- `src/evidence-audit.js`：提供 raw-evidence/secret-like 检测，本 phase 只用于 migration plan、receipt 和错误结果的 value-blind 审计；全 writer 接线属于 Phase 1.1。
- `src/targets/operations.js` 及 scaffold dry-run 路径：已有 deterministic operation/plan-before-write 思路，只作为迁移 plan/apply 分离的参考；OpenClaw runtime 接线属于 Phase 1.2。

### Established Patterns
- 每个 durable artifact 使用 schema constant、显式 validator、builder/report functions 和负向测试。
- 文件写入使用隔离临时目录并拒绝不安全或已有内容的目标；不依赖隐式 mutation。
- CLI 在 `bin/agentmo.js` 统一捕获并脱敏 fatal errors；human 与 JSON 输出都需要保持可测试。
- 项目使用 Node built-ins、ESM、`node:test` 和显式字段断言，不使用 opaque snapshots 或 schema framework。
- `test/stage-contracts.test.js` 证明阶段只依赖输入工件；Phase 1 不能让 migration ancestry 成为新的 admission 条件。

### Integration Points
- `src/cli.js`：注册 `migrate` command、参数解析、help、human/JSON 输出和 exit behavior。
- `src/blueprint.js` 及其他 artifact loaders：识别 legacy identity 并返回 migration-required 诊断，但不得自动写入。
- `src/scaffold-files.js`、`src/report.js`、`src/build-state.js` 与 CLI help：清除新生成输出中的 AgentMother identity。
- `package.json`：本 phase 只维护公开 AgentMo product identity；Node 20 实际 lane 与 OpenClaw 独立 runtime gate 属于 Phase 1.2。
- `test/cli.test.js`、`test/report.test.js`、`test/blueprint.test.js`、`test/stage-contracts.test.js` 与新增 migration suites：共同覆盖 happy path、legacy detection、atomic failure、secret rejection 和 canonical-only emitters。

</code_context>

<specifics>
## Specific Ideas

- 面向用户的迁移体验应像一次可审阅的编译：先展示将发生什么，再显式选择输出位置，最后得到可审计 receipt。
- 兼容只意味着“旧机器工件可受控进入”，不意味着新系统继续双写旧 identity。
- 批量迁移宁可整批拒绝，也不能留下半新半旧的 repository state。

</specifics>

<deferred>
## Deferred Ideas

- **Phase 1.1:** D-13 与 `CORE-04`/`EVID-03` — exact-raw-bytes digest admission、closed loader registry、跨进程工件交接与全 writer value-blind persistability gate。
- **Phase 1.2:** D-14 与 `COMP-01` — 真实 Node 20 lane、不可绕过的 OpenClaw target runtime preflight、live-smoke mutation gate 与 release matrix。

</deferred>

---

*Phase: 1-规范工件内核与安全迁移*
*Context gathered: 2026-07-11*
