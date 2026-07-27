# Phase 2: 可安装且可恢复的 Codex Builder - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

本 phase 把现有 contract-first AgentMo 核心产品化为可从正式打包产物安装到干净 Codex 项目的 Builder。它交付 builder adapter contract、Codex adapter、单一引导入口、capability probe、只读 doctor、持久 checkpoint、行为评估以及所有权安全的 setup/upgrade/uninstall。

本 phase 不实现 Phase 3 的实时研究能力，不生成 Phase 4 的 OpenClaw Agent Package，也不宣称 Codex 以外的 coding tool 已获完整支持。

</domain>

<decisions>
## Implementation Decisions

### 中立核心与 Codex 首发适配器
- **D-15:** AgentMo 的 `Discover -> Plan -> Produce` 协议、工件 schema、checkpoint、事件 envelope、去重和证据语义必须 coding-tool-neutral。Codex 是 v1 首个完整 builder adapter，而不是核心内部的特殊分支。
- **D-16:** Phase 2 同时定义版本化 builder adapter contract，覆盖 capability mapping、lifecycle events、context injection、compaction/restart recovery、deduplication、unsupported/degraded surfaces 与 evidence level。未来接入 Claude Code、OpenCode、Cursor 等工具时应新增 adapter，而不是复制方法论。
- **D-17:** “存在 adapter contract”不等于“已支持”。只有完成真实安装、宿主可见性和行为证据的 adapter 才能获得支持声明；Phase 2 只声明 Codex 完整支持。

### 安装与首次入口
- **D-18:** 用户只面对一个正式 AgentMo Builder 发行版本和一次显式 setup。打包产物必须自包含运行所需的 core 与 Codex 资产，安装后不得依赖 AgentMo 源码仓库，也不得让 Plugin 与 CLI 成为用户需要分别管理的两个产品。
- **D-19:** 默认安装范围是当前项目；用户级安装只能通过显式 scope 选择。setup 先执行只读 probe 并展示精确安装计划，经批准后原子应用并写逐路径 receipt、marker、installed digest、发行摘要和 capability snapshot。
- **D-20:** 人的主要入口只有 `$agentmo`：存在可恢复 checkpoint 时展示摘要并请求恢复确认；不存在时引导开始 Discover。`discover`、`plan`、`produce` 等直接阶段入口是 adapter、自动化、测试和故障恢复所需的协议面，不作为“高级用户模式”宣传，也不得形成第二套工作流。

### Checkpoint 与恢复
- **D-21:** 在有效工件形成、人工批准和阶段切换等稳定边界自动写 checkpoint，同时允许用户随时显式 pause。不得逐轮保存原始聊天，也不得把 Codex transcript 当作 Builder 工作流权威。
- **D-22:** checkpoint 至少绑定 schema/version、workflow identity、当前三阶段位置、权威工件路径与 exact digest、待人工决定、下一合法动作、安装 receipt digest、capability snapshot、event cursor/dedup key 和暂停原因；不得保存 secret、raw transcript、raw tool body 或未经脱敏的输出。
- **D-23:** SessionStart、Pre/PostCompact 等宿主 hook 只负责持久化已验证状态、发现 checkpoint 和提示恢复。hook 不得自动批准、自动跨阶段推进或成为唯一恢复入口；显式 `$agentmo` 必须始终可以恢复。

### 能力、诊断与生命周期安全
- **D-24:** adapter 必须区分 required 与 optional capability。缺少恢复、状态、安全所有权等 required capability 时失败关闭；optional capability 只能使用 adapter 明确声明且已测试的 fallback，或显式禁用并报告影响，绝不静默假成功。
- **D-25:** capability probe 与 doctor 都严格只读。doctor 报告安装来源、版本依据、active/missing/degraded capability、skill/hook/agent 可见性、receipt/marker/digest 所有权和 checkpoint 一致性；任何修复都必须是独立、显式批准的操作。
- **D-26:** 升级只由用户显式触发，必须先展示 exact plan 再批准；不进行后台或启动时自动升级。更新和卸载采用三方比较：receipt 中的 installed digest、当前 bytes、新版本 desired digest。只有 pristine AgentMo-owned 资产可修改；已修改、未知或 receipt 损坏时保留资产并失败关闭。

### 行为证明
- **D-27:** fresh Codex behavior eval 必须观察正确 trigger、non-trigger、人工 pause、稳定边界 checkpoint、compaction/session restart 恢复和重复事件 no-op。文件存在性、合成 hook payload 或 doctor 成功不能替代真实行为证据。
- **D-28:** declared installation、observed host visibility、verified behavior 与更高层的 Agent Package/domain quality 证据必须分开，不能相互自动认证。

### Gap closure 证据边界
- **D-29:** Codex 当前没有提供可由 AgentMo 独立验证的 hook 来源签名；在同一用户权限下，project-local runner、隐藏 CLI 或模块入口都不能形成密码学上的“真实 Codex 来源”证明。实现必须删除不必要的 caller-controlled authority minting，并让合成输入无法自我升级，但真实 session 结论仍只能是经人工确认的 `value-blind-operator-observation-candidate`，不得宣称为不可伪造的 host attestation。
- **D-30:** Phase 2 UAT 只允许一个 append-only、predecessor-bound 的 attempt journal 作为运行状态权威。setup、activation、trust/auth、scenario、upgrade、uninstall、failure/interruption 与 human admission 都追加为有序 entry；checkpoint、receipt、host observation、terminal result 和最终 candidate 只以 exact digest 被 journal entry 单向引用，任何派生产物不得反向绑定 journal head 或互相构成 digest 环。
- **D-31:** 真实 UAT 的成功来自三部分同时成立：确定性机制测试通过、fresh isolated normal-trust/auth Codex 中的人类实际观察、以及对同一 attempt journal/candidate exact bytes 的人工批准。任一部分失败都只生成有界失败或 interruption；不会自动关闭 domain quality、Agent Package quality、production readiness 或更广 Codex compatibility。

### the agent's Discretion
- 根据 phase-local current Codex research 决定正式运输载体是 npm one-shot setup、Codex native plugin distribution 或二者由同一发行物生成的组合；用户体验必须保持单一版本、一次 setup、无源码仓库依赖。
- Codex adapter 的具体目录名、manifest 字段和 hook fallback 形式由当前官方能力决定，但 canonical source 必须只有一份，所有生成投射需要 parity/hash 测试。
- checkpoint 的 JSON 字段名、文件布局与原子写入 helper 可沿用现有 artifact patterns，只要满足上述权威、秘密和恢复边界。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### AgentMo 范围与既有契约
- `.planning/PROJECT.md` — 两个产品平面、三阶段生命周期、支持声明与安全边界。
- `.planning/REQUIREMENTS.md` — `CORE-05` 与 `BLDR-01` 至 `BLDR-07`。
- `.planning/ROADMAP.md` — Phase 2 goal、依赖、research 要求和 success criteria。
- `.planning/phases/01-canonical-artifact-kernel/01-CONTEXT.md` — artifact-only 阶段边界和 Builder setup 与 Package Produce 的区分。
- `.planning/phases/01.1-artifact-admission-persistence-safety/01.1-CONTEXT.md` — exact-byte admission、fresh-process handoff 与 value-blind writer 边界。
- `.planning/phases/01.2-openclaw-runtime-release-evidence/01.2-CONTEXT.md` — core/runtime 分离与证据不升级原则。
- `CONTRIBUTING.md` — Alex、Echo 与 Codex 的协作和发布职责。

### GSD Core：canonical core、宿主投射与恢复
- `.reference-repos/gsd-core/capabilities/codex/capability.json` — Codex capability descriptor 与支持/降级声明模式。
- `.reference-repos/gsd-core/src/runtime-artifact-install-plan.cts` — canonical artifact 到安装计划的分离。
- `.reference-repos/gsd-core/src/capability-ledger.cts` — capability 安装 ledger 与失败关闭状态。
- `.reference-repos/gsd-core/gsd-core/workflows/pause-work.md` — 结构化 handoff/checkpoint 参考；不得照搬自动 Git commit。
- `.reference-repos/gsd-core/gsd-core/workflows/resume-project.md` — artifact-first 恢复优先级参考。

### Superpowers：薄适配与确定性 Plugin 打包
- `.reference-repos/superpowers/.codex-plugin/plugin.json` — Codex 原生 skill discovery 与显式 hook surface。
- `.reference-repos/superpowers/scripts/package-codex-plugin.sh` — clean-ref、确定性 archive 和 SHA 打包模式。
- `.reference-repos/superpowers/.pi/extensions/superpowers.ts` — session/compaction 后注入与 marker 去重参考。
- `.reference-repos/superpowers/scripts/sync-to-codex-plugin.sh` — canonical source 到宿主投射的 preview/sync 模式。

### Oh My Codex：Codex setup、probe、hooks 与 doctor
- `.reference-repos/oh-my-codex/plugins/oh-my-codex/.codex-plugin/plugin.json` — Codex Plugin bundle surface。
- `.reference-repos/oh-my-codex/plugins/oh-my-codex/hooks/hooks.json` — SessionStart、Pre/PostCompact 等事件参考。
- `.reference-repos/oh-my-codex/docs/plugin-bundle-ssot.md` — canonical source 与生成 Plugin mirror 规则。
- `.reference-repos/oh-my-codex/docs/codex-native-hooks.md` — native hook 与 fallback 机制参考。
- `.reference-repos/oh-my-codex/src/cli/setup.ts` — scoped setup、feature probe 与受管资产安装参考。
- `.reference-repos/oh-my-codex/src/cli/doctor.ts` — doctor 检查面参考；AgentMo 不采用其中的隐式修复行为。
- `.reference-repos/oh-my-codex/src/cli/uninstall.ts` — 卸载面参考；AgentMo 不采用按名称无 digest 删除。
- `.reference-repos/oh-my-codex/src/capabilities/lockfile.ts` — capability/behavior observation lockfile 参考。

### OpenClaw：目标运行时边界参考
- `.reference-repos/openclaw/docs/plugins/manage-plugins.md` — install/inspect/update/uninstall 与 cold/runtime 证据区分。
- `.reference-repos/openclaw/docs/plugins/manifest.md` — cheap manifest 与 runtime loading 分离。
- `.reference-repos/openclaw/docs/reference/session-management-compaction.md` — session、transcript 与 persistent compaction；仅作目标运行时参考，不能成为 Builder checkpoint 权威。
- `.reference-repos/openclaw/src/plugins/installs.ts` — 安装来源、版本与 integrity 记录参考。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/agentmo.js` 与 `src/cli.js`：现有单一 Node CLI、统一错误脱敏和公开命令入口，可承载 builder setup/probe/doctor/lifecycle commands。
- 现有 artifact builders/validators、admission registry 与 persistability gate：可用于 adapter descriptor、install plan/receipt、checkpoint 和行为 evidence 的版本化契约。
- `src/targets/registry.js`、`src/targets/operations.js`：可借鉴 registry 与 deterministic operation plan 形状，但 builder adapter 与 target adapter 必须保持不同类型和支持声明。
- 现有 atomic temp-write/rename、digest 和 evidence audit helpers：可复用于 receipt/checkpoint 的原子发布与 value-blind 失败。

### Established Patterns
- 核心保持 Node.js 20+、ESM、低依赖、手写 validator 和 `node:test`；除非当前 Codex integration 确实要求，否则不引入框架。
- 每个 durable artifact 由 schema identity、builder/validator、exact digest 与负向测试组成；成功标志不能自我认证。
- 计划与实际 mutation 分离，未知所有权、用户修改、秘密材料和不兼容 runtime 均在首次副作用前失败关闭。

### Integration Points
- `package.json`：正式 packed artifact、bin/files/scripts 与 packed-install smoke。
- `src/cli.js`：`setup`、`probe`、`doctor`、`upgrade`、`uninstall`、默认 `$agentmo` 与直接阶段入口。
- 新的 builder adapter/core 模块：host-neutral descriptor、Codex projection、receipt/checkpoint/event contracts 和 behavior evidence。
- `test/`：clean temporary Codex home、packed artifact、ownership conflict、restart/compaction/dedup 与 trigger/non-trigger behavior cases。

</code_context>

<specifics>
## Specific Ideas

- 产品体验参考 GSD、Superpowers 与 OMX，但组合为“一份 canonical Builder、一个正式发行版本、一个 setup、一个恢复权威”，不复制它们的多宿主历史兼容复杂度。
- OpenClaw 是 Phase 4 以后生成 Agent Package 的首个完整 target；Codex 是 Builder 的首个完整 host。这两条 adapter 轴不得混淆。
- 用户要求快速进入真实实现，因此规划应采用少量可运行纵向切片，每个切片都附带测试，而不是继续扩写宽泛设计文档。

</specifics>

<deferred>
## Deferred Ideas

- Claude Code、OpenCode、Cursor 和其他 coding tool 的生产级 adapter 实现属于后续版本；Phase 2 只交付中立 contract 与 Codex conformance proof。
- OpenClaw Agent Package 的生成、安装和运行生命周期分别属于 Phase 4 与 Phase 5。

</deferred>

---

*Phase: 2-codex-builder*
*Context gathered: 2026-07-15*
