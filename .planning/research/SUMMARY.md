# Project Research Summary

**Project:** AgentMo
**Domain:** coding agent 驱动的领域智能体构建协议与 OpenClaw Agent Package 工具链
**Researched:** 2026-07-11
**Confidence:** MEDIUM

## Executive Summary

AgentMo 不是 prompt 仓库或 scaffold 生成器，而是一个 contract-first、artifact-driven、local-first 的领域智能体构建系统。它包含 Builder plane 与 Package plane，但产品生命周期始终只有 `Discover -> Plan -> Produce`：Codex adapter 承载构建方法，OpenClaw target adapter 将经批准的 build contract 编译、安装并验证为版本化 Agent Package；阶段之间只通过经校验、经审批且带 digest 的工件连接。

推荐在现有 JavaScript ESM/Node.js CLI 上原地演进，保持低依赖、文件化工件、显式 validator、`node:test` 与 SHA-256 证据链。v1 只对 Codex builder 和 OpenClaw target 作完整支持声明；package 默认选择 workspace/skill/content bundle，只有能力确实要求 in-process tool 或 typed hook 时才升级为 native plugin。Agent Package 的目录与 manifest 是规范源，archive 只是可重建的运输封装。

最大风险不是生成失败，而是“看似成功”：旧名称污染新工件、prompt-only 安装无真实行为、adapter 虚报能力、upgrade/uninstall 破坏用户资产、秘密或原始输出进入证据，以及 doctor/live smoke/bounded eval 被传递成生产认证。缓解手段必须进入架构与 exit gate：exact-digest 人工审批、capability probe、`plan -> apply -> receipt`、最小信任面、value-blind evidence、fresh-session behavior eval，以及非传递、失败关闭的 Birth/Delivery 报告。

## Key Findings

### Core Conclusions

- 规范身份只有 AgentMo；`agentmother_*` 仅可由显式 legacy reader/migrator 接收，新写入必须为 `agentmo_*`。
- 顶层阶段恰好三个；install、doctor、live smoke、eval、Birth Report、Delivery Report、upgrade、rollback、uninstall 均属于 Produce 内部 gate。
- Builder plane 与 Package plane 必须分离，adapter 只做能力映射，不能复制或改写 lifecycle 业务语义。
- 人类权威链分四次独立绑定：source manifest、Package build contract、topic/angle、exact publish artifact；授权不得跨工件继承。
- `declared-ready`、`live-success`、bounded domain eval、delivery aggregation、production approval 是独立事实，不能形成 success cascade。
- `support-triage` 证明 deterministic conformance；中文 AI 内容写作包证明真实领域适用性，两者都不能单独认证全领域质量。

### Recommended Stack

- **Node.js:** 研究建议基线 `>=22.19.0`、开发与 CI 默认 Node 24 LTS，以对齐 OpenClaw 并避开 EOL Node 20；这与项目当前“保留 Node 20+”约束存在需在 Phase 1 明确裁决的兼容决策。
- **JavaScript ESM + Node built-ins:** 继续使用 `fs/promises`、`crypto`、`child_process`、`path`，不做 TypeScript 重写，不让 GSD/OMX/Superpowers/OpenClaw 成为核心依赖。
- **JSON / JSONL / Markdown + SHA-256:** 承载 versioned contracts、ledger、prompts、skills、memory policy、approval 与逐文件 digest。
- **Codex adapter:** Codex plugin manifest 与 skills 负责标准分发；agents/hooks 由带 ownership receipt 的 setup 层管理，并在当前 host 上先 probe 再安装。
- **OpenClaw integration:** 通过外部 CLI、manifest、隔离 `OPENCLAW_STATE_DIR` 和受管 operation 集成；核心不 import OpenClaw 内部模块。
- **Testing:** `node:test` contract/negative tests、packed-install parity、fresh Codex behavior eval、isolated OpenClaw smoke 与 bounded domain eval 分层运行。

### Expected Features

**Must have (table stakes):**

- AgentMo-only 新输出、legacy migration、严格三阶段与 artifact-only admission。
- 可安装的 Codex builder：setup、read-only doctor、upgrade、uninstall、checkpoint、compaction recovery、dedupe 和 behavior eval。
- 有界实时 Discover、统一 provenance/source record、去重/新鲜度、secret screening 与 exact-version source approval。
- 持续人机 Plan、decision ledger、需求—证据双向追踪、target feasibility、approved Package build contract 与 drift guard。
- 规范 Agent Package manifest、capability/trust map、deterministic materialize、ownership receipt 和完整 OpenClaw target lifecycle。
- 分层权限、逐动作审批、memory policy、capability lock、独立 evidence graph 与失败关闭报告。

**Should have (competitive):** 能力驱动的最小 package 形态、可证明所有权的可逆安装、干净会话可复现 Birth，以及 observe/memory 只生成 proposal 的学习闭环。

**Defer (v2+):** Pi 与其他 coding-tool/target 的完整支持、企业多租户控制平面、大规模 crawler/向量化 discovery，以及尚未选定 provider 的具体发布平台 adapter；v1 先交付中立 publish contract 与 test double。

### Architecture Approach

核心采用 canonical contracts + generated projections、capability-negotiated adapters、normalized event envelope、`plan/apply/receipt`、capability-proportional packaging 与 evidence graph 六个模式。

**Major components:**

1. `lifecycle-kernel` + `contract-registry` — 锁定三阶段、schema、validator、migration、hash、恢复与 admission。
2. `artifact-store` + `approval-gate` — 原子工件、append-only refs，以及与 artifact digest 绑定的人类决定。
3. `codex-adapter` + `discover-engine` + `plan-engine` — 构建端安装、研究采集、对话决策和 build contract。
4. `package-compiler` + `openclaw-adapter` — 生成 immutable package，并按能力选择 workspace/bundle/config/MCP/plugin 投影。
5. `managed-executor` + `ownership-ledger` — 声明式 operation、字段级 patch、三方 digest、冲突保留和 receipt。
6. `runtime-verifier` + `evidence-ledger` — probe、doctor、隔离执行、bounded eval 与非传递证据。

### Critical Pitfalls

1. **身份或生命周期漂移** — legacy 只读入并立即归一化；contract tests 禁止新旧双写和第四阶段。
2. **prompt-only builder 与能力虚报** — 结构测试之外必须有 current-host probe、fresh-session trigger/non-trigger/recovery/dedupe eval。
3. **所有权破坏或秘密外泄** — unknown/modified 资产一律 preserve + block；持久工件只记录 SecretRef、清洗摘要和 digest。
4. **OpenClaw 信任面静默扩大** — workspace/skill 优先，MCP/plugin 分支需 capability owner、permission、compat 与 isolated evidence。
5. **人工 gate 被隐式继承** — 每个 approval 绑定 exact digest、scope、actor、route、expiry；变化、超时或缺路由即 deny。
6. **证据自证与过度认证** — report 重验 identity/digest/scope/freshness，并明确每类 evidence 不能证明什么。

## Implications for Roadmap

以下是实现 phase，不是新增产品生命周期阶段；每个 phase 都必须保留 `Discover -> Plan -> Produce` 三阶段 invariant。

### Phase 1: Canonical Identity and Contract Foundation

**Rationale:** 所有 adapter、package、receipt 和 approval 都依赖稳定身份与词汇，后补迁移会把 legacy 债务扩散到全链路。
**Delivers / Addresses:** AgentMo-only emitter、幂等 legacy migrator、三阶段/fresh-context tests，以及 package/capability/approval/operation/receipt/evidence-ref v1 contracts；同时裁决 Node baseline 与兼容迁移策略。
**Avoids:** 名称双轨、第四阶段、隐式兼容、先生成后补 ownership/evidence。
**Exit gate:** 旧 fixture 可读、新输出零 `agentmother_*`，migration round-trip、schema negative tests 与 stage invariants 全部通过。

### Phase 2: Production-grade Codex Builder

**Rationale:** 后续 Discover/Plan 必须从真实可安装、可恢复的构建端运行，而不是继续依赖仓库内命令或 prompt 文本。
**Delivers / Addresses:** plugin/skills、setup-managed agents/hooks、capability probe、durable state/event dedupe、setup/doctor/upgrade/uninstall、packed-install parity 与 behavior harness，完成 Builder plane 产品化和 neutral event envelope。
**Avoids:** prompt-only 方法论、plugin-local hook 假设、fail-open 降级和“文件存在即行为生效”。
**Exit gate:** 干净 Codex 安装可完成 trigger、non-trigger、人工暂停、恢复与重复事件场景；doctor 保持 read-only。

### Phase 3: Guided Discover and Source Approval

**Rationale:** Plan 的合法输入必须先从有边界的 Web/GitHub/论文/本地材料形成统一、可审阅的 discovery database。
**Delivers / Addresses:** collector adapters、provenance、identity/hash、去重/新鲜度、untrusted-input/secret/size screening、coverage gaps 与 exact manifest approval，建立第一手来源优先的基础。
**Avoids:** 自动批准来源、无边界 crawler、敏感内容持久化和 lexical coverage 冒充语义质量。
**Exit gate:** manifest 任一字节或 source version 改变都会使旧 approval 失效；Plan 对未批准/断链输入失败关闭。

### Phase 4: Human-guided Plan and Approved Build Contract

**Rationale:** Package 能力、权限与 eval 必须来自已批准事实和人的明确决定，不能由 Produce 临时补齐。
**Delivers / Addresses:** 对话 checkpoint、decision/constraint/unknown/rejection ledger、双向 traceability、target feasibility、blueprint、Package build contract、Plan approval 与 drift guard。
**Avoids:** 会话祖先依赖、“继续即批准”、原始 transcript 成为状态权威和 Produce 静默扩权。
**Exit gate:** 仅凭 approved discovery digest 可恢复 Plan；仅 approved build-contract digest 可进入 Produce，变化后必须重新批准。

### Phase 5: OpenClaw Package Compiler

**Rationale:** 先冻结不可变、可检查的 package，再允许任何真实 target mutation。
**Delivers / Addresses:** deterministic compiler、`agentmo.package.json`、逐文件 digest、workspace/skill/bundle/config/MCP/plugin 选择、memory/session exclusion 与 manifest-only inspect，建立 Package plane SSOT 和最小信任面。
**Avoids:** prompt-only package、native plugin 默认化、bundle 风险隐身、runtime DB/auth/session 混包。
**Exit gate:** 相同 build contract 生成相同逻辑摘要；plugin 分支必须有必要性、权限、兼容区间和独立安全审查。

### Phase 6: Owned OpenClaw Lifecycle and Evidence Closure

**Rationale:** install、升级与验证共享 package digest、ownership 和 evidence vocabulary，应作为一个可逆的 Produce 纵向切片完成。
**Delivers / Addresses:** probe/plan/materialize/install/inspect/read-only doctor/smoke/evaluate/upgrade/rollback/uninstall、三方 digest 冲突、capability lock、Birth/Delivery aggregation 与 `support-triage` 正式 conformance package。
**Avoids:** 覆盖用户配置、doctor 自动修复、原始输出落盘、success cascade 和 fixture 被表述为领域认证。
**Exit gate:** `support-triage` 覆盖 clean install、idempotency、用户修改、unknown owner、partial failure、rollback/uninstall 与 stale/mismatched evidence 负向矩阵。

### Phase 7: Chinese AI Writing Acceptance Package

**Rationale:** 基础 package 生命周期稳定后，才用真实研究、编辑记忆与外部副作用暴露领域复杂度。
**Delivers / Addresses:** 趋势候选池、人工 topic/angle gate、第一手来源 claim ledger、对比/大纲/草稿/检查、bounded eval、exact-draft publish contract/test double，以及 source/Plan/topic/publish 四类独立人工权威。
**Avoids:** 自动选题、弱来源归一化为事实、memory 复用旧授权、草稿漂移后发布和 bounded eval 过度认证。
**Exit gate:** mutation tests 改变 source、angle、draft、route 或 expiry 均拒绝动作；事实、推断、争议保持可追溯区分。

### Phase 8: Clean-room v1 Release Evidence

**Rationale:** 支持声明只能来自当前版本的端到端证据，不能复用开发机状态或陈旧 probe/smoke。
**Delivers / Addresses:** Node 22.19/24 CI、packed install、干净 Codex builder、隔离 OpenClaw 两包 birth、upgrade/rollback/uninstall、bounded ledger 与 release wording review，形成可复现 v1 支持边界。
**Avoids:** 固定提交被当永久兼容、真实 home/credentials 污染、报告自证与生产质量过度声明。
**Exit gate:** 两包均有当前 runtime identity、doctor、live-success、bounded eval、fail-closed Birth/Delivery 和剩余风险；production approval 仍保持独立。

### Phase Ordering Rationale

- Phase 1 先冻结身份与跨阶段契约；否则任何 adapter 或 package 工作都会制造迁移债务。
- Phase 2 先证明 Builder 能真实安装和恢复，Phase 3→4 再按数据审批到人类规划的因果链推进。
- Phase 5 先生成 immutable package，Phase 6 才触碰 target；ownership/rollback 不能留到发布末期补做。
- `support-triage` 先锁定机制回归，中文写作包后验证领域与人工 gate，最终才做 clean-room 支持声明。

### Research Flags

Phases likely needing `$gsd-plan-phase --research-phase <N>`:

- **Phase 2:** Codex plugin manifest、agents/hooks 安装面与 feature flags 漂移快，必须以实施时 current host contract 为准。
- **Phase 3:** Web/GitHub/论文 collector 的 API、许可、限流、内容类型和 provenance 需要 adapter-specific 调研。
- **Phase 5–6:** OpenClaw CLI JSON、bundle/plugin precedence、skill eligibility、permission request 与 doctor surface 需按当前版本复验。
- **Phase 7:** 发布平台未选；若范围超出中立 contract/test double，必须先研究 provider API、认证、sandbox、撤销与审批路由。

Phases with established patterns (skip full research-phase):

- **Phase 1:** 当前 repo contracts、negative tests 和固定研究已给出明确模式。
- **Phase 4:** artifact admission、decision ledger、digest approval 与 drift guard 可由现有 contract-first 架构扩展。
- **Phase 8:** 主要是验证与证据收集；仍须 re-probe 当前 surfaces，但不需要重新做宽泛领域研究。

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Node/core 与 OpenClaw 边界有官方/固定版本证据；Codex hook packaging 细节为 MEDIUM |
| Features | MEDIUM | table stakes 与依赖一致，但真实用户反馈、发布平台和规模指标尚缺 |
| Architecture | MEDIUM | 当前三阶段/evidence 边界为直接事实；推荐组件拆分与 phase 粒度仍属推导 |
| Pitfalls | HIGH | repo 约束、负向测试策略及四份研究对关键失败模式高度一致 |

**Overall confidence:** MEDIUM — 核心方向和依赖顺序可信，外部 host/runtime surface 与领域发布细节必须 phase-local 验证。

### Gaps to Address

- **Node baseline 冲突:** Requirements 必须在“核心整体升级到 `>=22.19.0`”与“核心保留 Node 20、OpenClaw adapter 单独要求 22.19+”之间作显式选择；推荐前者，但需 migration note 与 CI/packed-install 证据。
- **Codex exact contract:** 当前 plugin validator fields、agent 安装位置、hook merge/refresh 与 feature lifecycle 需实施时 probe。
- **OpenClaw compatibility matrix:** CLI flags/JSON schema、skill snapshot、bundle/native precedence、plugin SDK 和 permission flow 仍会漂移。
- **Publishing target:** 平台、API、测试环境、approval service、idempotency 与撤销语义未定；不得在 Requirements 中假设公众号 provider。
- **Package transport:** directory + manifest 的 SSOT 已确定，zip/tgz 格式、reproducible archive 细节仍需 packed-install 验证。
- **Domain evaluation:** 中文写作 case set、rubric、hard failures、evaluator provenance 与质量阈值尚未定义，必须保持 bounded claim。
- **Operational scale:** discovery 容量、并发 session、lock 策略和增量索引没有真实基准；v1 应保持有界文件模型并采集指标。

## Sources

### Primary (HIGH confidence)

- [PROJECT.md](../PROJECT.md)、[AGENTS.md](../../AGENTS.md) — 产品范围、三阶段、双平面、安全、证据与协作约束。
- [STACK.md](./STACK.md)、[FEATURES.md](./FEATURES.md)、[ARCHITECTURE.md](./ARCHITECTURE.md)、[PITFALLS.md](./PITFALLS.md) — 本 summary 的四份直接研究输入。
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)、[Node.js EOL policy](https://nodejs.org/en/about/eol) — runtime 生命周期。
- [Codex repository](https://github.com/openai/codex) — skill、plugin/app-server 与当前实现契约。
- [OpenClaw 官方仓库](https://github.com/openclaw/openclaw) — workspace、skills、bundle/plugin、hooks、memory、doctor 与权限边界；本地固定基线记录在 `STACK.md`。

### Secondary (MEDIUM confidence)

- [GSD Core 官方仓库](https://github.com/open-gsd/gsd-core) — capability manifest、trust、host adapter 与 ownership migration 模式；固定基线记录在详细研究文件中。
- [Oh My Codex 官方仓库](https://github.com/Yeachan-Heo/oh-my-codex) — SSOT/mirror、capability lock、doctor、setup/uninstall 与 packed-install 模式；固定基线记录在详细研究文件中。
- [Superpowers 官方仓库](https://github.com/obra/superpowers) — thin harness adapter、Codex packaging 与 behavior eval 模式；固定基线记录在详细研究文件中。

### Tertiary (LOW confidence)

- 无；未用社区二手文章填补关键决策。所有 current-surface 推断均保留 MEDIUM 并要求 phase-local re-probe。

---
*Research completed: 2026-07-11*
*Ready for roadmap: yes*
