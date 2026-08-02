# Roadmap: AgentMo

**Approval:** 2026-07-11 在 interactive roadmap gate 获得用户批准

## Overview

AgentMo v1 通过八个可独立验证的纵向增量，把现有 contract-first CLI 演进为可安装、可恢复、可生成并验证领域 Agent Package 的完整产品：先依次交付规范身份与安全迁移、工件准入与秘密边界、OpenClaw 运行时与发布证据，再把方法论交付为生产级 Codex Builder；随后打通“受控研究 → 人工批准 Package build contract”和“批准 contract → 确定性 package → 所有权安全安装”两条端到端路径；再用 `support-triage` 关闭 OpenClaw 可逆生命周期与非传递证据；最后用中文 AI 内容写作包、受控发布契约和 clean-room 双包证据完成 v1。实施 phase 可以跨越产品能力层，但 Agent Package 的顶层生命周期始终且仅为 `Discover -> Plan -> Produce`，不会新增第四阶段。

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (1.1, 1.2): 已批准的 milestone 拆分增量，用于保持单阶段可执行和可验证

- [x] **Phase 1: 规范内核与安全迁移** - 开发者可得到规范 AgentMo 身份、三阶段契约和显式、原子、value-blind 的 legacy 迁移。 (completed 2026-07-12)
- [x] **Phase 1.1: 工件准入与秘密边界** - 开发者可按 exact digest 交接工件，且所有当前持久化边界保持 value-blind。 (completed 2026-07-13)
- [x] **Phase 1.2: OpenClaw 运行时与发布证据** - AgentMo core 与 OpenClaw target 运行时范围得到独立、不可绕过的验证和证据。 (completed 2026-07-13)
- [ ] **Phase 2: 可安装且可恢复的 Codex Builder** - 干净 Codex 环境可安装、诊断、恢复和验证同一套 AgentMo 工作流。
- [x] **Phase 3: 经批准研究到 Build Contract** - 开发者可从有界实时来源得到经人工批准、可追溯的 Package build contract。
- [ ] **Phase 4: 确定性 Package 与所有权安全安装** - 经批准 contract 可生成可检查 package，并经预览批准后安全安装到 OpenClaw；当前为 Needs Review / gaps_found，等待 04-12～04-19 与 canonical post gate。
- [ ] **Phase 5: `support-triage` 可逆运行与证据闭环** - 一致性包可完成隔离运行、分层证据和不破坏用户资产的完整回退路径。
- [ ] **Phase 6: 中文写作验收与 v1 发布闭环** - 真实写作包以人工 gate 完成领域验收，并与一致性包共同形成 clean-room v1 证据。

## Phase Details

### Phase 1: 规范内核与安全迁移

**Goal:** As a developer using AgentMo, I want to inspect and explicitly migrate supported legacy machine artifacts into canonical AgentMo three-stage copies, so that source files stay unchanged and raw values remain undisclosed.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** CORE-01, CORE-02, CORE-03
**Research:** 不需要完整 research phase；现有 contract、负向测试、Phase 1 context 与三轮计划审计已确定该增量的模式。
**Success Criteria** (what must be TRUE):

  1. 开发者检查新生成的 schema、CLI 输出、当前公开文档和 package/scaffold 文案时只看到 `AgentMo` / `agentmo_*`；旧名称只允许出现在明确标注的 legacy context 中。
  2. 开发者只看到 `Discover -> Plan -> Produce` 三个顶层阶段；既有 conceive/gestate/birth/train/certify/release 词汇若保留，只能明确建模为 Produce 内部 maturity/gate。
  3. 普通 loader 发现 registry 支持的 legacy identity 时返回结构化 `AGENTMO_MIGRATION_REQUIRED` 和有界命令指引，且不自动迁移、不写派生文件、不修改源 bytes。
  4. `agentmo migrate` 默认只预览；只有显式 `--out` 才写入专用目录并生成版本化、确定性、value-blind receipt。整批先校验后写入，任一输入不安全或不支持时零 committed output。
  5. 输出发布对 symlink、父目录替换和 TOCTOU 失败关闭；无法安全回收时只保留可证明归属且不可被当成成功输出的 orphan，不删除无法证明归属的路径。

**Plans:** 4/4 plans complete

### Phase 1.1: 工件准入与秘密边界

**Goal:** As a developer, I want to hand off admitted artifacts safely, so that fresh processes can trust them without retaining secrets.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** CORE-04, EVID-03
**Research:** 不需要完整 research phase；使用 Phase 1 计划审计中已经确认的 loader/writer inventory，并在执行时对 live source 做有界复核。
**Success Criteria** (what must be TRUE):

  1. loader 对同一份 raw `Buffer` 先验证外部强制提供的 SHA-256，再解析、审计和 schema 校验；仅改变空白或 key 顺序也会使旧 digest 失效。
  2. closed identity/validator registry 覆盖当前 Discover、Plan、blueprint、build/run state/index、observation、report/evidence 与 handoff loader；fresh process 不依赖上游命令 ancestry 即可验证和消费工件。
  3. migration、plan ledger、scaffold/package/memory、runtime state/index/eval、report、observation、handoff 与 evidence 的当前 writer 在序列化或输出前执行共同 persistability gate，只允许 `SecretRef`、存在性或脱敏摘要。
  4. secret、host path、raw prompt/transcript/tool body、stdout/stderr 出现在嵌套 value、object key、subject 或 pointer 时均产生 value-blind 诊断和零写入。
  5. 所有当前生成、脚本化和文档化的 durable-input 命令都携带一一对应的 subject+digest binding；declared/live 证据仍不传递领域质量结论。

**Plans:** 13/13 plans complete

### Phase 1.2: OpenClaw 运行时与发布证据

**Goal:** 开发者可以在真实 Node.js 20 lane 运行 AgentMo core，并确保每一条 OpenClaw target mutation 路径在任何进程或文件副作用前经过不可由生产调用者绕过的 target runtime gate。
**Mode:** mvp
**Depends on:** Phase 1.1
**Requirements:** COMP-01
**Research:** 不做宽泛研究；仅复核已固定 OpenClaw 版本的当前 Node range、CLI/spawn seam、live-smoke 脚本和 maintained runbooks。
**Success Criteria** (what must be TRUE):

  1. 一个无 secret 的确定性 Node.js 20 lane 实际执行 AgentMo core check 与关键 contract tests；未执行的矩阵项明确标为 untested，不以声明替代证据。
  2. OpenClaw target range `>=22.19.0 <23 || >=23.11.0` 在最低、不可绕过的 mutation/spawn seam 读取真实 runtime evidence，生产 API 不暴露 version-provider bypass。
  3. scaffold、live run、replay 以及 `scripts/openclaw-live-smoke.sh` 的直接 mutation 都在副作用前执行同一门槛；不兼容时无状态目录、子进程或目标文件变更。
  4. CLI、生成 runbook、维护文档与测试使用同一 runtime contract；core Node floor 与 target Node floor 不混为一谈。
  5. release matrix 分别记录 declared 与实际测试的 core/target 范围、命令、状态和 remaining risk，不把 runtime smoke 升级为领域质量或生产认证。

**Plans:** 12/12 plans complete

**Wave 1**

- [x] 01.2-01-PLAN.md — 建立唯一的运行时契约与有界 `runtime-check` CLI

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01.2-02-PLAN.md — 在 OpenClaw JavaScript mutation/spawn seam 前执行不可绕过的门槛

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01.2-03-PLAN.md — 统一 shell、生成 runbook、target hints 与维护文档的运行时契约

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01.2-04-PLAN.md — 执行真实 Node.js 20 lane 并形成诚实的发布兼容矩阵

**Gap Closure Wave 1** *(依赖均为已完成的 01.2-02/03/04，可并行执行)*

- [x] 01.2-05-PLAN.md — 绑定 Node 20 executable provenance、精确测试计数与 value-blind receipt
- [x] 01.2-06-PLAN.md — 在任何 artifact、message 或 env 摄入前执行 CLI runtime gate
- [x] 01.2-07-PLAN.md — 关闭独立 hint、包装 launcher 与维护文档路径绕过面

**Gap Closure Wave 2** *(blocked on Gap Closure Wave 1 completion)*

- [x] 01.2-08-PLAN.md — 真实重跑并校准 compatibility matrix、release 与 evidence ledger

**Gap Closure Wave 3** *(plans 09-11 touch disjoint production surfaces and may run in parallel)*

- [x] 01.2-09-PLAN.md — 消除真实 Node/shebang launcher 的 `--env-file` 参数冲突
- [x] 01.2-10-PLAN.md — 让 generated shell effects 受 runtime preflight 成功控制边支配
- [x] 01.2-11-PLAN.md — 用 repo-owned trust anchor 与 post-publication consumers 关闭自认证绕过

**Gap Closure Wave 4** *(blocked on Gap Closure Wave 3 completion)*

- [x] 01.2-12-PLAN.md — 重跑真实 Node 20 evidence 并同步 README、AGENTS 与 release records

### Phase 2: 可安装且可恢复的 Codex Builder

**Goal:** As a developer installing AgentMo Builder in Codex, I want to install and run the packaged Builder on a clean Codex host and recover its workflow across pause, compaction, restart, upgrade, and uninstall with provable asset ownership, so that I can use and audit AgentMo Builder safely without depending on the AgentMo source repository.
**Mode:** mvp
**Depends on:** Phase 1.2
**Requirements:** CORE-05, BLDR-01, BLDR-02, BLDR-03, BLDR-04, BLDR-05, BLDR-06, BLDR-07
**Research:** 需要 phase-local research；实施时须以当前 Codex plugin、skill、agent、hook 与 feature contract 为准。
**Success Criteria** (what must be TRUE):

  1. 开发者从正式打包产物在干净 Codex 环境安装后即可使用规范 plugin、skills 与受管 agents/hooks，不依赖 AgentMo 源码仓库。
  2. 开发者可在运行前查看 capability probe，并用只读 doctor 查看 host 支持、缺失或不兼容能力、版本依据、安装来源、hook/skill 可见性和状态一致性；两者都不会隐式修复环境。
  3. 开发者既可使用默认引导式入口，也可显式调用单个阶段；两条路径产生并消费同一套三阶段工件契约。
  4. 开发者在人工暂停、上下文压缩、会话重启或重复事件后可从持久工件恢复，且 behavior eval 能观察正确 trigger、non-trigger、恢复和事件去重。
  5. 开发者升级或卸载 Builder 时只改变 receipt、marker 与 digest 证明属于 AgentMo 的资产并保留未知/已修改资产；adapter 作者也可依中立版本化 contract 声明能力、事件、恢复与不支持面，而不会因此获得支持声明。

**Plans:** 27 total; 24 executed with SUMMARY. Plans 02-25～02-27 remain human-gated and unexecuted. Phase goal remains incomplete until the real UAT branch and independent post-execution verification finish.
**Wave 1**

- [x] 02-01-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md

**Gap Closure Wave 5** *(blocked on 02-04 completion)*

- [x] 02-05-PLAN.md — 投射 fixed import closure 的 receipt-managed 项目本地 runtime/launcher，skill 不依赖源码或全局 PATH

**Gap Closure Wave 6** *(blocked on 02-05 completion)*

- [x] 02-06-PLAN.md — 通过官方 user-host 接口完成激活、selector owner/consumer 所有权与只读 doctor/agent observability

**Gap Closure Wave 7** *(blocked on 02-06 completion)*

- [x] 02-07-PLAN.md — 为 runtime 与 host selector/reference 补齐 sibling-safe upgrade/uninstall 和 last-reference 拒绝

**Gap Closure Wave 8** *(blocked on 02-07 completion)*

- [x] 02-08-PLAN.md — 接通 installed hook → local launcher → canonical event → checkpoint CAS，锁定 replay/二次 compaction 与 UAT observation 接口

**Gap Closure Wave 9** *(blocked on 02-08 completion)*

- [x] 02-09-PLAN.md — 生成并 exact-admit value-blind agentmo.codex-uat.v1 artifact，要求 connected provenance 且关闭 packed import closure

**Gap Closure Wave 10** *(blocked on 02-09 completion)*

- [x] 02-10-PLAN.md — 先维护 README/release，再以 normal-trust/auth fresh Codex 人工 gate 诚实记录成功或失败

以下七个计划取代已删除的 02-11～02-19 多权威草案。D-29～D-31 将 UAT 运行状态收敛为唯一 append-only attempt journal；checkpoint、receipt、host observation、snapshot 与 candidate 都只是被 entry 单向 exact 引用的证据，不再维护 manifest/run/terminal/supervisor 状态或互相回指的 digest DAG。

**Review Repair Wave 11** *(blocked on 02-10 completion)*

- [x] 02-11-PLAN.md — 交付 immutable checkpoint/event authority，关闭 CAS、自签 digest 与 replay poisoning，并迁移全部语义 reader

**Review Repair Wave 12** *(blocked on 02-11 completion)*

- [x] 02-12-PLAN.md — 以 non-destructive exact retirement 与 retained-handle restore 修复 lifecycle/receipt identity races

**Review Repair Wave 13** *(blocked on 02-12 completion)*

- [x] 02-13-PLAN.md — 补齐 fresh marketplace registration、host-add 补偿、owner/consumer identity 与 host/install metadata

**Review Repair Wave 14** *(blocked on 02-13 completion)*

- [x] 02-14-PLAN.md — 修复 doctor retained identity、canonical project visibility、complete-or-reject module closure 与 syntax-aware I/O inventory

**Review Repair Wave 15** *(blocked on 02-14 completion)*

- [x] 02-15-PLAN.md — 建立唯一 attempt journal、candidate-only hook observation、诚实 challenge 语义与完整 public UAT CLI

**Review Repair Wave 16** *(blocked on 02-15 completion)*

- [x] 02-16-PLAN.md — 用可销毁 synthetic packed fixture 准入预启动 continuation，完成 final uninstall observation 与 candidate leaf → candidate-ready 单向发布契约

**Real Codex UAT Wave 17** *(blocked on 02-16 completion)*

- [x] 02-17-PLAN.md — exact successor verifier、真实双版本 tarball 与 bounded public evidence 已交付；唯一实际 attempt 在 baseline setup apply 以 `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED` 终止，未进入 Codex/十一场景/human admission

Wave 11～16 按 shared durable/host authority 顺序执行，每一 wave 都在下一 wave 消费其 identity 前完成 focused/full gate；Wave 17 是唯一 real Codex retry 和 exact human-admission gate。

**Gap Repair Wave 18** *(completed; plans are file-disjoint)*

- [x] 02-18-PLAN.md — 关闭 raw UAT append 与 verifier-decision authority 绕过，并迁移全部旧消费者
- [x] 02-19-PLAN.md — 关闭 shared host root、owner/ledger CAS 与 retained identity 竞争窗口

**Gap Repair Wave 19** *(blocked on 02-18 and 02-19 completion)*

- [x] 02-20-PLAN.md — 交付 receipt-last project install transaction、exact rollback 与显式 recovery CLI

**Gap Repair Wave 20** *(blocked on 02-20 completion)*

- [x] 02-21-PLAN.md — 修复 immutable journal durable commit/cleanup，并迁移 checkpoint/hook/UAT callers

**Gap Repair Wave 21** *(blocked on 02-21 completion)*

- [x] 02-22-PLAN.md — 修复 candidate/observation leaf publication 与 packed continuation durability

**Gap Repair Wave 22** *(blocked on 02-22 completion)*

- [x] 02-23-PLAN.md — 实现 retained prior-attempt preflight 与 fixed private continuation authority，并在 introducing plan 内关闭 I/O/package boundary

**Aggregate Gate Wave 23** *(blocked on 02-23 completion)*

- [x] 02-24-PLAN.md — 运行 focused/full/diff gates、独立 0-Critical review，并校准 VALIDATION、README、runbook、ledger 与 release

**Human UAT Wave 24** *(blocked on 02-24 completion; `autonomous: false`)*

- [ ] 02-25-PLAN.md — operator 本地 stdin exact-admit 旧 failure attempt，并显式批准或拒绝一个新 attempt

**Human UAT Wave 25** *(blocked on 02-25 approval; `autonomous: false`)*

- [ ] 02-26-PLAN.md — 使用 durable private continuation authority 完成 setup/activation、normal trust/auth 与 bounded scenarios

**Human UAT Wave 26** *(blocked on 02-26 bounded outcome; `autonomous: false`)*

- [ ] 02-27-PLAN.md — exact-finalize candidate 或 pre-candidate terminal，并同步 value-blind public records

Cross-cutting constraints:

- 既有两条 failure journal chain 永久只读；任何 locator 都不得进入 Codex prompt、argv、environment、log 或公共 evidence。
- 新 actual attempt 只能在 02-24 的 focused/full/diff 与独立 review 0 Critical 全部通过、旧 attempt exact-admit、且开发者显式批准后创建。
- Plans 02-25～02-27 不得自写 `02-VERIFICATION.md`、STATE、ROADMAP 或 REQUIREMENTS；独立 verifier 与 `phase.complete` 保留 canonical status authority。

### Phase 3: 经批准研究到 Build Contract

**Goal:** As a developer, I want to turn bounded Web, GitHub, paper, and local-source research into a human-approved, exact-digest, traceable blueprint and Package build contract, so that Produce receives explicit construction intent without relying on prompts, session ancestry, or unverified declarations.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05
**Research:** 需要 phase-local research；collector 的 API、许可、限流、内容类型与 provenance contract 必须逐 adapter 复验。
**Success Criteria** (what must be TRUE):

  1. 开发者可为 Web、GitHub、论文和本地 collector 设置来源、数量、大小与时间边界，并得到包含 identity、retrieval time、summary、content digest、provenance、confidence 与原始位置引用的记录；不安全路径、内容类型、untrusted input 或 secret-shaped material 在持久化前失败关闭。
  2. 开发者可区分第一手来源、上下文媒体与社区观点，并查看去重、新鲜度、冲突和 coverage gaps；系统不会把关键词覆盖率描述为语义质量证明。
  3. 开发者必须批准同时绑定 exact source-manifest digest 与 derived discovery-database digest 的工件后才能进入 Plan；来源、摘要、置信度、coverage、版本或清单变化都会让旧批准失效。
  4. 开发者可仅凭经批准 discovery database 恢复持续规划，对需求、边界、约束和可观察验收标准达成决定，并在 ledger 中区分事实、推断、未知、拒绝方案与人工决定，且能双向追溯来源、需求、能力和 eval。
  5. 开发者在批准 exact-digest blueprint 与 Package build contract 前可查看 runtime feasibility、capability、权限、信任面、不支持项和替代方案；需求、能力、权限或验收标准变化会强制重新批准。

**Plans:** 6/6 plans complete

- [x] 03-01-PLAN.md
- [x] 03-02-PLAN.md
- [x] 03-03-PLAN.md
- [x] 03-04-PLAN.md
- [x] 03-05-PLAN.md
- [x] 03-06-PLAN.md

### Phase 4: 确定性 Package 与所有权安全安装

**Goal:** As a developer, I want to deterministically generate an offline-inspectable least-trust Agent Package from an approved build contract and safely install it into OpenClaw after probe, preview, and exact-plan approval, so that I can authorize the exact package, target, and effects before any mutation.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** PACK-01, PACK-02, PACK-03, PACK-04, PACK-05, OCLW-01, OCLW-02, OCLW-03, OCLW-04, OCLW-05, EVID-05
**Research:** 需要 phase-local research；必须按当前 OpenClaw 版本复验 CLI/JSON、bundle/plugin precedence、skill eligibility、sandbox/tool policy 与 permission route。
**Success Criteria** (what must be TRUE):

  1. 开发者对同一份已批准 build contract 重复 Produce 时，会得到相同逻辑内容、逐文件 digest 和规范 `agentmo.package.json`，并能从规范目录确定性重建运输 archive。
  2. 开发者无需安装即可 inspect prompts、skills、tools、hooks、memory policy、evals、target mappings、permissions、evidence references、certification boundary、remaining risks 与 target operations；package 不含 secret、auth/session state、runtime database 或 raw private transcript。
  3. 开发者看到 package 形态由声明能力决定：优先 workspace/skill/content bundle，隔离外部 tool surface 时选择 MCP，仅在确需进程内 tool 或 typed hook 时选择 native plugin；每项 tool、hook、plugin 与副作用都展示 owner、版本、digest、permission、审批与失败语义，敏感动作缺少 exact-action 批准时失败关闭。
  4. 开发者在任何 target mutation 前可 probe OpenClaw runtime、CLI/JSON contract、workspace/skill/plugin、sandbox/tool policy、permission route 与兼容版本，并预览 managed operations、字段级配置 patch、路径、冲突和 rollback；计划内容或冲突状态变化会使批准失效。
  5. 开发者安装后得到逐项 install receipt；workspace、配置、managed skills 与外部 credential/session state 保持分离，未知或已修改资产在 install、upgrade、rollback、uninstall 中均被保留并阻止破坏性覆盖，除非另行批准确切冲突。

**Plans:** 19 total; 18 executed with SUMMARY. Plan 04-19 is pending gap closure. Phase remains Needs Review / gaps_found until execute-phase canonical post-review and verifier pass after 04-19 SUMMARY.
**Wave 1**

- [x] 04-01-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-04-PLAN.md

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 04-05-PLAN.md

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 04-06-PLAN.md

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 04-07-PLAN.md

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 04-08-PLAN.md

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 04-09-PLAN.md

**Wave 10** *(blocked on Wave 9 completion)*

- [x] 04-10-PLAN.md

**Wave 11** *(blocked on Wave 10 completion)*

- [x] 04-11-PLAN.md

**Gap Closure Wave 12** *(blocked on Wave 11 completion)*

- [x] 04-12-PLAN.md — mandatory companion-backed fresh reprobe、private executable/cwd 与 full fingerprint gate

**Gap Closure Wave 13** *(blocked on 04-12 completion)*

- [x] 04-13-PLAN.md — retained-dirfd native kernel、OS no-replace publication、durable build receipt 与 explicit helper admission

**Gap Closure Wave 14** *(blocked on 04-13 completion; plans are file-disjoint)*

- [x] 04-14-PLAN.md — per-authority/per-nonce durable reservation markers、double-writer/crash replay 与 official credential routes
- [x] 04-17-PLAN.md — identity-safe publisher failure semantics、nested recipe paths 与 canonical MVP Goal metadata

**Gap Closure Wave 15** *(blocked on 04-14 completion)*

- [x] 04-15-PLAN.md — observed genesis 与真实 install/upgrade/rollback/uninstall official-route lifecycle

**Gap Closure Wave 16** *(blocked on 04-15 completion)*

- [x] 04-16-PLAN.md — strict receipt completion theorem 与 exact authority/result ledger

**Gap Closure Wave 17** *(blocked on 04-16 and 04-17 completion)*

- [x] 04-18-PLAN.md — exact packed inventory 与 extracted-tarball full lifecycle/adversarial closure

**Gap Closure Wave 18** *(blocked on 04-18 completion)*

- [ ] 04-19-PLAN.md — docs/release、full gates 与 noncanonical pre-verification deep audit

  Current blocker: Tasks 1–2 implementation is present, but both aggregate
  attempts remained non-green (936/938 with one skip and one failure). The
  stale Phase 3 helper-tuple journey is corrected; the successor aggregate
  exposed a load-sensitive immutable-successor hook failure that passes in
  isolation. Task 3 and canonical post gates have not started.

Cross-cutting constraints:

- 04-12～04-19 不得把 fixture/native/packed mechanism evidence 描述为 live-success、domain quality、production readiness、Birth 或 Delivery certification。
- 04-19 不运行 canonical `gsd-verifier`、不自写 canonical REVIEW/VERIFICATION 或 phase status；canonical review/verifier 仅由 execute-phase post gate 在 04-19 SUMMARY 后运行。
- Phase 4 在 canonical post gate pass 前保持 Needs Review / gaps_found，不得标记完成。

### Phase 5: `support-triage` 可逆运行与证据闭环

**Goal:** 开发者可以把 `support-triage` 作为正式 Agent Package 完成隔离运行、分层验证、升级回退与失败关闭报告，从而验证 OpenClaw Produce gate 的完整可逆机制。
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** OCLW-06, OCLW-07, EVID-01, EVID-02, EVID-04, EVID-06, FIXT-01, FIXT-02
**Research:** 需要定向复验；实施时须确认当前 OpenClaw doctor、isolated state、eval 与回退 surface，但不重做宽泛架构研究。
**Success Criteria** (what must be TRUE):

  1. 开发者可对已安装 package 运行只读 doctor 与使用独立 `OPENCLAW_STATE_DIR` 的 live smoke，并得到不同 evidence type；随后可执行 bounded eval、upgrade、rollback 与 uninstall，且每步只影响 AgentMo-owned assets。
  2. 开发者可确定性构建 `support-triage` 并验证 clean install、idempotency、doctor、upgrade、rollback、uninstall 与 evidence closure。
  3. 开发者运行负向矩阵时，stale/mismatched evidence、unknown owner、用户修改、partial failure、缺失权限或 rollback failure 均不会产生虚假成功或破坏用户资产。
  4. 开发者可分别查看 `declared-ready`、`live-success`、bounded domain eval、delivery aggregation 与 production approval；Birth/Delivery Report 会重新校验 identity、digest、scope、freshness 与 runtime，陈旧或不匹配证据失败关闭且不会跨等级传递结论。
  5. 开发者看到 memory 仅保存带来源、owner、scope、retention 与 expiry 的允许内容；运行观察只生成 proposal，不会自动修改 blueprint、package、runtime 或 eval，也不会把一次审批泛化为长期授权。

**Plans:** TBD

### Phase 6: 中文写作验收与 v1 发布闭环

**Goal:** 中文 AI 开发者可以使用经人工 gate 约束的真实内容写作 Agent Package 完成研究、写作、领域验收和一次性发布准备，并在 clean-room 环境为两个参考包取得边界清晰的 v1 release evidence。
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** WRIT-01, WRIT-02, WRIT-03, WRIT-04, WRIT-05, WRIT-06, PUBL-01, PUBL-02, REL-01
**Research:** 需要 phase-local research；发布 provider 尚未选择，本 phase 只实现 provider-neutral contract/test double，并须定义经批准的中文写作 case set、rubric、阈值与 hard failures。
**Success Criteria** (what must be TRUE):

  1. 编辑者可从经批准来源获得每日趋势和候选池，每个候选显示受众价值、新鲜度、核心证据、争议与风险；只有批准绑定候选版本的主题、角度和目标读者后，智能体才进入深度研究或写作。
  2. 编辑者可在 claim ledger 中区分事实、推断与争议，事实优先绑定论文、作者材料、官方文档或 release record；智能体可比较论文与热点观点、生成大纲和中文草稿，并暴露引用、事实、时效、语言、受众检查后的剩余缺口。
  3. 编辑者可维护带 owner、来源、适用范围、纠错记录与过期/撤销条件的 editorial memory，且其中不保存 raw private transcript，也不复用旧授权。
  4. 开发者可让写作包通过经人工批准的 bounded case set 与 rubric，并用 provider-neutral publish contract/test double 验证 route、idempotency、approval、timeout、cancel、result 和 receipt；只有 exact draft digest 的有效一次性批准能触发动作，任何 draft、route、目标、scope 或 expiry 漂移都会被拒绝。
  5. 开发者可从干净 Codex 会话和隔离 OpenClaw 环境为 `support-triage` 与中文写作包取得 build、install、doctor、`live-success`、达到阈值的 bounded eval、成功且失败关闭的 Birth/Delivery、upgrade/rollback/uninstall 证据；任一 required gate 失败都会阻止 v1 完成，release ledger 明确限制支持声明。

**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 1.1 → 1.2 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 规范内核与安全迁移 | 4/4 | Complete    | 2026-07-12 |
| 1.1 工件准入与秘密边界 | 13/13 | Complete    | 2026-07-13 |
| 1.2 OpenClaw 运行时与发布证据 | 12/12 | Complete | 2026-07-13 |
| 2. 可安装且可恢复的 Codex Builder | 24/27 | Local mechanism gate passed; human UAT pending | - |
| 3. 经批准研究到 Build Contract | 6/6 | Complete | 2026-07-28 |
| 4. 确定性 Package 与所有权安全安装 | 16/19 | Needs Review / gaps_found | |
| 5. `support-triage` 可逆运行与证据闭环 | 0/TBD | Not started | - |
| 6. 中文写作验收与 v1 发布闭环 | 0/TBD | Not started | - |
