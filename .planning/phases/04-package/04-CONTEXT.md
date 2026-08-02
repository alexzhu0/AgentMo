# Phase 4: 确定性 Package 与所有权安全安装 - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段把 Phase 3 中经 exact `agentmo.plan-approval.v1` 批准的 build contract，确定性生成成可离线检查、可运输、可安全安装的真实 Agent Package，并完成 OpenClaw target probe、安装预览、逐动作授权、所有权保护和 install receipt。Phase 4 必须生成可执行资源而非只有声明的 scaffold。

真实 Agent 运行、定时任务实际触发、重启恢复、领域评测、Birth/Delivery closure 和生产声明属于 Phase 5，不得由 Phase 4 的 package/install evidence 自动认证。

</domain>

<decisions>
## Implementation Decisions

### 可执行 Package 与能力载体
- **D-32:** Phase 4 必须生成真实可执行资源，包括 prompts、skills、tool bindings、hooks、memory policy、evals 和 OpenClaw workspace；只有 declarations、文档或空 scaffold 不算完成。
- **D-33:** 一个 Agent Package 可以组合 workspace/content、skill、MCP、native plugin 与 hook。每项能力分别选择满足需求的最低信任载体：优先 workspace/content/skill，需要隔离外部 tool surface 时使用 MCP，仅在普通 OpenClaw surface 无法满足进程内 tool 或 typed hook 时使用 native plugin。
- **D-34:** Canonical `agentmo.package.json` 保持 target-neutral 的 AgentMo 语义，同时生成完整、可直接安装的 OpenClaw 原生 projection。未来 target 通过新增 projection 接入，不重写 canonical package contract。

### 安装范围、批准与冲突
- **D-35:** 默认真实安装目标是隔离、项目级 OpenClaw state。普通用户 OpenClaw state、用户级目录或共享组件必须生成独立 exact plan 并再次批准，不能由项目级批准隐式授权。
- **D-36:** 安装可以在一个审批界面中统一展示并一次提交，但普通 managed writes 与敏感动作保持不同授权语义。每个网络、凭据、进程启动、外部命令和用户级变更都必须有独立 exact-action decision；任一 action、参数、scope、digest、target 或 conflict state 变化都会使对应批准失效。
- **D-37:** 多个冲突可以作为一个 exact conflict set 一次审核。批准必须逐项绑定 path、current digest、desired digest 和拟执行动作；集合或任何 current bytes 变化时整体批准失效。禁止 blanket overwrite 或可复用于未来冲突的授权。

### Credentials、失败恢复与检查面
- **D-38:** AgentMo 可以协助 credential/profile 设置，但只能检测缺失项、生成独立 setup proposal，并调用或引导 OpenClaw 官方 credential/auth route。Secret value 直接进入 OpenClaw 的官方管理边界；AgentMo 不读取、不复制、不持久化 secret，receipt 只记录引用、存在性和有界动作结果。
- **D-39:** 中途失败时，只自动回滚本次创建、由 AgentMo 拥有且仍保持 pristine 的资产。未知、已修改、外部拥有或所有权不明的资产必须保留；失败写入 bounded incomplete receipt，不能通过破坏性清理伪造原子成功。
- **D-40:** `package inspect` 同时提供适合人的稳定摘要和适合自动化的稳定 JSON。默认检查必须覆盖 manifest、逐文件 digest、能力载体、permissions、敏感副作用、target operations、冲突、证据边界与 remaining risks。
- **D-41:** OpenClaw 安装兼容性绑定只读 probe 形成的 runtime/CLI/capability fingerprint，而不只检查命令存在或版本号。Fingerprint 至少覆盖版本、CLI/JSON contract、workspace/skill/plugin surface、sandbox/tool policy、permission route、目标路径和 conflict state；变化后必须重新 probe、preview 和批准。
- **D-42:** Canonical package directory 是确定性构建权威，但 preview、approval 与 apply 只接受由该目录确定性重建的 archive 作为安装运输输入。每个安装 authority 必须同时绑定 archive 外部 digest、内部 manifest digest 和完整成员 inventory；preview/apply 在任何副作用前以 no-follow retained reads 重验成员集合、type、mode 与逐成员 digest，extra/missing/drift/identity-swap 均失败关闭。

### 继承的安全边界
- Phase 2 的项目级默认 scope、read-only probe/doctor、exact plan approval、逐路径 receipt、三方 digest 比较和 preserve-on-conflict 决策继续生效。
- Phase 3 的 build contract、blueprint、design plan、discovery approval 与 decision-ledger exact admission 必须在 Produce 入口重新验证；plan approval 只允许进入 Produce，不代表 package quality、install success 或 runtime success。
- Package、archive、preview、approval、receipt 和 inspect 输出不得包含 secret values、auth/session state、runtime database、raw private transcript、raw provider payload 或未经脱敏的 stdout/stderr。

### the agent's Discretion
- Canonical archive 的稳定排序、mtime、mode、路径和压缩实现细节，只要同一规范目录可以确定性重建且跨平台差异有明确处理。
- CLI 子命令和内部模块边界，只要 human/JSON surfaces 稳定、exact digest admission 不可绕过、mutation seam 统一受控。
- 根据当前 OpenClaw 源码与本机只读 probe 选择官方 credential handoff、workspace/skill 安装和 plugin/MCP 注册的具体命令；不得退化成直接写 secret 或猜测未验证的配置字段。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and contracts
- `.planning/ROADMAP.md` — Phase 4 goal、边界、依赖和五项成功标准。
- `.planning/REQUIREMENTS.md` — PACK-01..05、OCLW-01..05 与 EVID-05 的验收合同。
- `.planning/phases/03-build-contract/03-RESEARCH.md` — OpenClaw 资源图、载体选择依据和 Phase 3/4/5 责任边界。
- `.planning/phases/03-build-contract/03-05-SUMMARY.md` — exact build contract 与 plan approval 的已实现交接面。
- `.planning/phases/03-build-contract/03-VERIFICATION.md` — Phase 3 通过的输入权威与剩余非认证边界。

### Runtime and evidence boundaries
- `docs/STAGE_CONTRACTS.md` — Discover → Plan → Produce 的正式输入输出和 non-transitive evidence 语义。
- `docs/OPENCLAW_RUNTIME_NOTES.md` — 当前记录的 OpenClaw runtime、agent resource、loop、memory、tool 和安全边界；研究阶段必须对照当前源码复验。
- `docs/MVP_RUNBOOK.md` — 当前 CLI、runtime gate、测试与 operator workflow。
- `docs/AGENT_BIRTH_GATE.md` — declared-ready、live-success、domain eval 与 production approval 的不可传递边界。
- `AGENTS.md` — `.env`、runtime trust anchor、验证、release record 和 commit hygiene 约束。
- `CONTRIBUTING.md` — 项目维护、协作和发布责任。

### OpenClaw source of truth
- `.reference-repos/openclaw/package.json` — 被研究版本、Node runtime 要求和 package identity；Phase 4 研究必须重新确认当前 checkout。
- `.reference-repos/openclaw/src/agents/` — workspace、prompt、tool policy、runtime plan、loop 和 harness 的当前实现依据。
- `.reference-repos/openclaw/src/skills/` — skill loading、eligibility、precedence、snapshot 与同步规则。
- `.reference-repos/openclaw/src/plugins/` — plugin manifest、安装、加载、安全扫描与 native capability surface。
- `.reference-repos/openclaw/src/cron/` — schedule mutation 与持久化 surface；Phase 4 只生成/批准计划，Phase 5 才执行验证。
- `.reference-repos/openclaw/extensions/` — memory/MCP/plugin 载体与 slot ownership 的当前实现依据。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/build-contract.js`: Phase 3 已生成完整 OpenClaw resource graph 和 evidence obligations，Phase 4 应将其作为唯一 generation input，而不是重新推断需求。
- `src/artifact-admission.js`, `src/artifact-registry.js`, `src/plan-approval.js`: 可复用 exact raw-byte admission、closed subject registry 和 non-self-certifying approval 模式。
- `src/persistability.js`, `src/evidence-audit.js`, `src/secret-redaction.js`: 可复用 value-blind secret/raw-evidence gate。
- `src/targets/openclaw.js`, `src/targets/operations.js`: 已有 deterministic target-operation 模式，可演进为 canonical package 到 OpenClaw projection。
- `src/builder-package.js`, `src/builder-install.js`: 已有 Builder 自身 package/install 的 ownership、receipt 和 transaction 经验；可复用原则，但不能把 Codex Builder host 安装合同直接当成 OpenClaw Agent Package 合同。
- `src/openclaw-runtime.js` 与 runtime-check surface: 已有 core/target runtime 分离和 target mutation 前置门。

### Established Patterns
- 依赖仅使用 Node.js built-ins，durable artifacts 使用手写 schema/validator、canonical JSON、exact digest 和 atomic publish。
- 所有持久化证据在写入前重新审计，不信任上游 `ok` 或自带 digest。
- Mutation 与 declared planning 分离；read-only probe/inspect 不创建 target state。
- Release 与测试记录只证明实际观察到的有界机制，不升级领域、runtime 或生产声明。

### Integration Points
- `src/cli.js`：新增 Produce/package/probe/preview/approve/apply/inspect public surfaces。
- `src/artifact-contract.js`, `src/artifact-subjects.js`, `src/artifact-registry.js`：注册 package、probe、install-plan approval 与 receipt 的公开合同。
- `src/builder-package.js` 与 `package.json`：保证正式 Builder 发行物包含所有新增 Phase 4 runtime modules。
- `test/openclaw-*`, `test/artifact-*`, `test/stage-contracts.test.js`：形成 target projection、negative authority、packed install 和 stage-boundary 回归。

</code_context>

<specifics>
## Specific Ideas

- 首版必须实际解决黑盒 POC 的核心阻塞：生成的 Package 不能再只有 prompts/tool declarations，而没有可执行 resource、binding 和安装路径。
- 用户希望首版专注 OpenClaw 并快速落地，但 AgentMo 的 canonical package 不应因此失去未来 target adapter 的扩展能力。
- 审批体验应尽量一次完成：在一个页面审核普通写入、敏感动作和 exact conflict set；底层 artifact 仍保持逐动作、逐冲突的独立绑定。

</specifics>

<deferred>
## Deferred Ideas

- Phase 5：`support-triage` 的真实隔离运行、schedule 触发、memory/RAG readback、restart recovery、bounded eval、Birth/Delivery closure、upgrade/rollback/uninstall live proof。
- Phase 6：中文 AI 开发者写作 Agent 的领域验收与 provider-neutral publish contract。

</deferred>

---

*Phase: 4-确定性 Package 与所有权安全安装*
*Context gathered: 2026-07-28*
