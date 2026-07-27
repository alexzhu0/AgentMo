# Requirements: AgentMo

**Defined:** 2026-07-11
**Approval:** 2026-07-11 在 interactive requirements gate 获得用户批准
**Core Value:** 开发者能够反复把经过批准的数据与人工决策转化为可安装、可验证的 Agent Package，并清楚知道其来源、能力、运行时行为和剩余风险。

## v1 Requirements

以下需求定义 AgentMo v1 的承诺范围。每项需求在 Roadmap 中必须且只能映射到一个 phase。

### 核心协议与兼容性

- [x] **CORE-01**：开发者在所有新生成的规范工件、schema identity、CLI 产品身份和 Agent Package 标识中只得到 `AgentMo` 与 `agentmo_*`；迁移文档和诊断证据可以在明确标注为 legacy context 时引用旧标识符。
- [x] **CORE-02**：开发者可以读取旧版 `agentmother_*` 工件，并通过幂等迁移得到规范的 `agentmo_*` 工件；迁移器不修改用户原文件，也不把原始内容复制进迁移状态或证据，检测到 secret-shaped material 或 raw private transcript 时会拒绝迁移并只生成 value-blind 失败证据。
- [x] **CORE-03**：开发者看到的 Agent Package 顶层生命周期严格只有 `Discover -> Plan -> Produce`；target/package 的 install、doctor、live smoke、eval、Birth Report 和 Delivery Report 只作为 Produce 内部 gate 出现，而 Codex builder 自身的 setup/doctor/upgrade/uninstall 属于构建端运维生命周期。
- [x] **CORE-04**：开发者可以把任何通过 schema、digest 和 admission 校验的阶段工件交给下游阶段，而不依赖同一会话中的命令调用历史。
- [x] **CORE-05**：adapter 作者可以实现版本化的中立 builder/target adapter contract，其中明确 capability mapping、lifecycle events、context injection、compaction recovery、deduplication、unsupported surfaces 与 evidence level，而不会自动获得“已支持”声明。
- [x] **COMP-01**：开发者可以在 Node.js `>=20` 上运行 AgentMo core；OpenClaw 操作会在任何 target mutation 前探测并强制执行 OpenClaw 当前声明的 Node.js `>=22.19.0 <23 || >=23.11.0` 要求，release matrix 会分别记录 core 与 target runtime 范围。

### Codex Builder

- [ ] **BLDR-01**：开发者可以从打包产物在干净 Codex 环境中安装 AgentMo builder，并获得规范 plugin、skills 及受管的 agents/hooks，而不依赖 AgentMo 源码仓库。
- [x] **BLDR-02**：开发者可以在安装或运行前执行 capability probe，看到当前 Codex host 支持、缺失和不兼容的能力及其版本依据。
- [x] **BLDR-03**：开发者可以使用默认引导式入口完成三阶段流程，也可以由高级用户显式调用单个阶段，二者遵守同一份生命周期契约。
- [ ] **BLDR-04**：开发者在上下文压缩、会话重启或重复事件后可以从持久工件恢复流程，并且同一事件不会被重复应用。
- [ ] **BLDR-05**：开发者可以运行只读 doctor，检查安装来源、active capability、版本、hook/skill 可见性和状态一致性，而不会隐式修复或修改环境。
- [ ] **BLDR-06**：开发者可以升级或卸载 Codex builder；操作只修改由 receipt、marker 和 digest 证明属于 AgentMo 的资产，并保留未知或已被用户修改的资产。
- [ ] **BLDR-07**：开发者可以在 fresh Codex session 中运行 builder behavior eval，验证正确 trigger、non-trigger、人工暂停、压缩/重启恢复与重复事件去重，而不是仅检查安装文件存在。

### Discover

- [ ] **DISC-01**：开发者可以通过当前 Codex 可用的 Web、GitHub、论文和本地文档能力执行有边界的实时研究，并为每个 collector 设置来源、数量、大小和时间限制。
- [ ] **DISC-02**：开发者获得的每条 discovery record 都包含来源身份、检索时间、内容摘要、content digest、provenance、confidence 与原始位置引用。
- [ ] **DISC-03**：开发者可以区分第一手来源、上下文媒体和社区观点；事实性研究默认优先论文、作者材料、官方文档与 release records。
- [ ] **DISC-04**：开发者导入的来源在持久化前经过路径、大小、内容类型、untrusted-input 和 secret-shaped material 筛查，失败时保留有界错误证据而不保存敏感原文。
- [ ] **DISC-05**：开发者可以看到来源去重、新鲜度、冲突和 coverage gaps，且系统不会把关键词覆盖率表述为语义质量证明。
- [ ] **DISC-06**：开发者必须批准同时承诺 exact source-manifest digest 与 derived discovery-database digest 的审批工件后才能进入 Plan；来源、summary、confidence、coverage、版本或清单变化都会使旧审批失效。

### Plan

- [ ] **PLAN-01**：开发者可以基于已批准 discovery database 与 AgentMo 持续对话，形成明确的用户需求、边界、约束和可观察验收标准。
- [ ] **PLAN-02**：开发者可以审阅 decision ledger，其中分别记录事实、推断、未知项、被拒绝方案和人工决定，而不把原始 transcript 当作状态权威。
- [ ] **PLAN-03**：开发者可以从每项需求追溯到支持它的来源和决定，也可以从来源反向查看其影响的需求、能力与 eval。
- [ ] **PLAN-04**：开发者可以在批准 package 之前看到目标 runtime feasibility、所需 capability、权限、信任面、不支持项与替代方案。
- [ ] **PLAN-05**：开发者可以批准绑定 exact digest 的 blueprint 与 Package build contract；任何需求、能力、权限或验收标准变化都会要求重新批准。

### Agent Package

- [ ] **PACK-01**：开发者获得一个版本化的 `agentmo.package.json` 作为 Agent Package 规范入口，其中记录 package identity、contract version、source digests、target compatibility、capabilities 与 build-contract reference。
- [ ] **PACK-02**：开发者可以在 Agent Package 中检查 prompts、skills、tools、hooks、memory policy、evals、target mappings、permissions、evidence references、certification boundary 与 remaining risks。
- [ ] **PACK-03**：开发者对同一份已批准 build contract 进行重复 Produce 时，会得到逻辑内容和逐文件 digest 一致的 package；运输 archive 可由规范目录确定性重建。
- [ ] **PACK-04**：开发者看到的 package 形态由声明能力决定，默认优先 workspace、skill 与 content bundle；需要隔离的外部 tool surface 时可选择 MCP，只有确实需要 OpenClaw 进程内 tool 或 typed hook 时才选择 native plugin，并分别附必要性与信任说明。
- [ ] **PACK-05**：开发者可以在不安装 package 的情况下 inspect manifest、文件摘要、权限、target operations 和证据边界；package 不包含 secret values、auth profiles、session state、runtime database 或 raw private transcripts。

### OpenClaw Target Lifecycle

- [ ] **OCLW-01**：开发者可以在任何目标变更前 probe OpenClaw 的 runtime identity、CLI/JSON contract、workspace/skill/plugin 能力、sandbox/tool policy、permission route 与版本兼容性。
- [ ] **OCLW-02**：开发者可以预览 Produce 计划执行的 managed operations、配置 patch、目标路径、冲突与 rollback 信息，并批准绑定 exact plan digest 的执行工件；operations、patch、路径或冲突状态变化都会使旧批准失效，apply 必须重新校验 digest。
- [ ] **OCLW-03**：开发者安装 package 后获得 install receipt，其中逐项记录 target identity、managed path、原始/安装 digest、ownership marker 和外部依赖。
- [ ] **OCLW-04**：开发者的未知资产或已修改资产在 install、upgrade、rollback、uninstall 时会被保留并阻止破坏性覆盖，除非开发者对确切冲突另行授权。
- [ ] **OCLW-05**：开发者的 workspace 内容、OpenClaw 配置、managed skills 与外部 credentials/session state 始终分离；配置只通过最小字段级 patch 合并。
- [ ] **OCLW-06**：开发者可以运行 package doctor 和隔离 live smoke；doctor 保持只读，live smoke 使用独立 `OPENCLAW_STATE_DIR`，且二者输出不同 evidence type。
- [ ] **OCLW-07**：开发者可以对已安装 package 执行 bounded eval、upgrade、rollback 与 uninstall，并通过 manifest/receipt/digest 验证每一步只影响 AgentMo-owned assets。

### 安全、记忆与证据

- [ ] **EVID-01**：开发者可以分别查看 `declared-ready`、`live-success`、bounded domain eval、delivery aggregation 与 production approval，任一等级都不会自动提升为另一个等级。
- [ ] **EVID-02**：开发者获得的 Birth Report 与 Delivery Report 会重新校验输入工件的 identity、digest、scope、freshness 和 runtime，而不是信任上游 success flag 或报告自身结论。
- [x] **EVID-03**：开发者在 legacy input、迁移输出、恢复状态、Plan ledger、package、install receipt、runtime memory 和 evidence 等任何持久工件中只保存 SecretRef、存在性或脱敏摘要，不保存、复制或输出 secret values、credential-bearing state、raw transcript、raw tool body 或未经清洗的 stdout/stderr；密钥只可由隔离运行时按最小范围临时注入。
- [ ] **EVID-04**：开发者可以从每条 runtime evidence 看到当前 AgentMo/package/OpenClaw identity、版本、执行时间、transport、case scope 和剩余风险，陈旧或不匹配证据会失败关闭。
- [ ] **EVID-05**：开发者可以从每项 tool、hook、plugin 与 side-effect capability 看到 owner、版本范围、digest、permission、approval requirement、failure semantics 和 unsupported behavior；所有敏感副作用必须对 exact action 执行逐动作审批，审批路由缺失、超时、取消或不匹配时失败关闭。
- [ ] **EVID-06**：开发者的 memory 只保存带来源、owner、scope、retention 和 expiry 的允许内容；运行观察只能生成 proposal，不能自动修改 blueprint、package、runtime 或 eval，也不能把一次审批泛化为长期授权。

### `support-triage` 一致性包

- [ ] **FIXT-01**：开发者可以把 `support-triage` 构建为正式 Agent Package，并用它确定性验证 package generation、clean install、idempotency、doctor、upgrade、rollback、uninstall 与 evidence closure。
- [ ] **FIXT-02**：开发者可以运行 `support-triage` 负向矩阵，验证 stale/mismatched evidence、unknown owner、用户修改、partial failure、缺失权限和 rollback failure 均不会产生虚假成功或破坏用户资产。

### 中文 AI 内容写作包

- [ ] **WRIT-01**：中文 AI 开发者可以从已批准来源生成每日趋势与候选选题池，每个候选包含受众价值、新鲜度、核心证据、争议点和风险说明。
- [ ] **WRIT-02**：编辑者必须选择并批准绑定候选版本的主题、角度和目标读者后，智能体才能进入深度研究或写作；关键角度变化会使旧批准失效。
- [ ] **WRIT-03**：编辑者可以查看 claim ledger，其中事实、推断与争议分别标记，事实主张优先绑定论文、作者材料、官方文档或 release record。
- [ ] **WRIT-04**：编辑者可以让智能体比较论文与热点观点、生成大纲和中文草稿，并执行引用、事实、时效、语言与受众适配检查，同时暴露未解决的证据缺口。
- [ ] **WRIT-05**：编辑者可以维护带 owner、来源、适用范围、纠错记录和过期/撤销条件的编辑 memory，而不会保存 raw private transcript 或复用旧授权。
- [ ] **WRIT-06**：开发者可以对中文写作 package 运行经人工批准的 bounded domain case set 与 rubric；只有达到批准阈值且没有 hard failure 才能通过该 gate，通过结果仍只覆盖这些案例，不构成全领域或生产质量认证。

### 发布契约

- [ ] **PUBL-01**：开发者可以使用 provider-neutral publish tool contract 与 test double 验证目标、route、idempotency、approval、timeout、cancel、result 和 receipt，而不预设具体公众号平台或凭据路径。
- [ ] **PUBL-02**：编辑者只有在明确批准 exact draft digest 后才能触发一次发布；draft、route、目标、审批范围或有效期变化，以及缺少审批路由、超时或取消，都会拒绝动作并生成有界失败证据。

### v1 Release Evidence

- [ ] **REL-01**：开发者可以从干净 Codex 会话开始，在隔离 OpenClaw 环境中为 `support-triage` 与中文 AI 内容写作包完成 build、install、doctor、live-success、达到批准阈值的 bounded eval、成功且失败关闭的 Birth/Delivery、upgrade/rollback/uninstall；任一 required gate 失败或阻塞时 v1 不得宣告完成，最终 release ledger 必须明确限制支持声明。

## v2 Requirements

以下能力被记录但不进入 v1 Roadmap。

### Builder 与 Target 扩展

- **ADPT-01**：开发者可以使用生产级 Claude Code、OpenCode、Cursor 或其他 coding-tool adapter。
- **TARG-01**：开发者可以使用生产级 Pi target 或其他 Agent runtime target。
- **PUBL-03**：开发者可以安装并验证一个具体公众号/内容平台的生产发布 adapter，包括真实认证、sandbox、撤销与平台回执。

### 数据与治理扩展

- **DATA-01**：开发者可以运行大规模 crawler、向量索引、流式 ingestion 与增量重建，而不仅是有边界的文件化 discovery database。
- **GOV-01**：组织可以使用多用户、集中式控制平面、角色审批与跨团队治理能力。

## Out of Scope

| Feature | Reason |
|---------|--------|
| 第四个顶层 Birth/Verify 阶段 | 破坏已确认的三阶段职责边界；相关 gate 必须位于 Produce 内部。 |
| 新工件继续写出 `AgentMother` 或 `agentmother_*` | 只允许作为 legacy 输入兼容，不能维持双重产品身份。 |
| Prompt-only Agent Package | 缺失版本、能力、权限、安装、所有权与证据契约。 |
| 自动批准来源、自动选题或长期发布授权 | 人工权威必须分别绑定 exact source、topic/angle 与 publish artifact。 |
| 把 credentials、auth/session state 或 raw transcript 打入 package/evidence | 不可移植且存在泄密风险，必须保持为外部受限状态。 |
| 默认生成 OpenClaw native plugin | plugin 与 Gateway 共享进程信任边界，只能按能力必要性选择。 |
| doctor 自动修复环境 | doctor 是只读诊断；repair 必须是另一个显式批准、可预览和可回滚的动作。 |
| 覆盖或删除未知/用户修改资产 | 不满足所有权证明时必须 preserve + block。 |
| 根据 scaffold、smoke 或报告自我认证生产质量 | 支持与质量声明只能受实际证据范围约束。 |
| v1 硬编码具体公众号 API | 平台与认证路径尚未决定；v1 只交付中立 contract 与 test double。 |

## Definition of Done

v1 只有在以下条件同时满足时才完成：

1. 每个 v1 requirement 在 Roadmap 中恰好映射到一个 phase，并拥有自动化或明确的人工验证证据。
2. `npm run check`、相关 contract/negative/packed-install/runtime tests 与 `git diff --check` 通过。
3. 两个验收包都完成当前版本、隔离环境下的 bounded evidence closure，且没有把局部证据升级为生产认证。
4. 所有架构、schema、package、stage 和 evidence 语义变化都更新对应文档与 `release/YYYY.MM.DD.md`。
5. 最终 merge/release 仍由项目约定的责任人明确批准。

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 1.1 | Complete |
| CORE-05 | Phase 2 | Complete |
| COMP-01 | Phase 1.2 | Complete |
| BLDR-01 | Phase 2 | Pending |
| BLDR-02 | Phase 2 | Complete |
| BLDR-03 | Phase 2 | Complete |
| BLDR-04 | Phase 2 | Pending |
| BLDR-05 | Phase 2 | Partial |
| BLDR-06 | Phase 2 | Pending |
| BLDR-07 | Phase 2 | Pending |
| DISC-01 | Phase 3 | Pending |
| DISC-02 | Phase 3 | Pending |
| DISC-03 | Phase 3 | Pending |
| DISC-04 | Phase 3 | Pending |
| DISC-05 | Phase 3 | Pending |
| DISC-06 | Phase 3 | Pending |
| PLAN-01 | Phase 3 | Pending |
| PLAN-02 | Phase 3 | Pending |
| PLAN-03 | Phase 3 | Pending |
| PLAN-04 | Phase 3 | Pending |
| PLAN-05 | Phase 3 | Pending |
| PACK-01 | Phase 4 | Pending |
| PACK-02 | Phase 4 | Pending |
| PACK-03 | Phase 4 | Pending |
| PACK-04 | Phase 4 | Pending |
| PACK-05 | Phase 4 | Pending |
| OCLW-01 | Phase 4 | Pending |
| OCLW-02 | Phase 4 | Pending |
| OCLW-03 | Phase 4 | Pending |
| OCLW-04 | Phase 4 | Pending |
| OCLW-05 | Phase 4 | Pending |
| OCLW-06 | Phase 5 | Pending |
| OCLW-07 | Phase 5 | Pending |
| EVID-01 | Phase 5 | Pending |
| EVID-02 | Phase 5 | Pending |
| EVID-03 | Phase 1.1 | Complete |
| EVID-04 | Phase 5 | Pending |
| EVID-05 | Phase 4 | Pending |
| EVID-06 | Phase 5 | Pending |
| FIXT-01 | Phase 5 | Pending |
| FIXT-02 | Phase 5 | Pending |
| WRIT-01 | Phase 6 | Pending |
| WRIT-02 | Phase 6 | Pending |
| WRIT-03 | Phase 6 | Pending |
| WRIT-04 | Phase 6 | Pending |
| WRIT-05 | Phase 6 | Pending |
| WRIT-06 | Phase 6 | Pending |
| PUBL-01 | Phase 6 | Pending |
| PUBL-02 | Phase 6 | Pending |
| REL-01 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 53 total
- Mapped to phases: 53
- Unmapped: 0
- Duplicate mappings: 0

---
*Requirements defined: 2026-07-11*
*Last updated: 2026-07-13 after Phase 1.2 verified completion*
