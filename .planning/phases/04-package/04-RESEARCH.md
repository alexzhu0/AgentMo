# Phase 4: 确定性 Package 与所有权安全安装 - Research

**Researched:** 2026-07-28  
**Domain:** Agent Package 确定性构建、OpenClaw capability probe、exact-plan 安装、所有权安全事务  
**Confidence:** HIGH（仓库内 AgentMo 合同与固定 OpenClaw 源码为主；本机 OpenClaw 漂移与 hook 载体冲突是显式阻塞）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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
- **D-42:** Canonical package directory 是确定性构建权威，但 preview、approval 与 apply 只接受由该目录确定性重建的 archive。每个安装 authority 同时绑定 archive 外部 SHA-256、内部 manifest digest、canonical inventory digest 与完整成员集合；preview/apply 在任何副作用前用 no-follow retained reads 重验 path/type/mode/length/member digest，任一 extra/missing/drift/identity-swap 都失败关闭。

### 继承的安全边界
- Phase 2 的项目级默认 scope、read-only probe/doctor、exact plan approval、逐路径 receipt、三方 digest 比较和 preserve-on-conflict 决策继续生效。
- Phase 3 的 build contract、blueprint、design plan、discovery approval 与 decision-ledger exact admission 必须在 Produce 入口重新验证；plan approval 只允许进入 Produce，不代表 package quality、install success 或 runtime success。
- Package、archive、preview、approval、receipt 和 inspect 输出不得包含 secret values、auth/session state、runtime database、raw private transcript、raw provider payload 或未经脱敏的 stdout/stderr。

### the agent's Discretion
- Canonical archive 的稳定排序、mtime、mode、路径和压缩实现细节，只要同一规范目录可以确定性重建且跨平台差异有明确处理。
- CLI 子命令和内部模块边界，只要 human/JSON surfaces 稳定、exact digest admission 不可绕过、mutation seam 统一受控。
- 根据当前 OpenClaw 源码与本机只读 probe 选择官方 credential handoff、workspace/skill 安装和 plugin/MCP 注册的具体命令；不得退化成直接写 secret 或猜测未验证的配置字段。

### Deferred Ideas (OUT OF SCOPE)
- Phase 5：`support-triage` 的真实隔离运行、schedule 触发、memory/RAG readback、restart recovery、bounded eval、Birth/Delivery closure、upgrade/rollback/uninstall live proof。
- Phase 6：中文 AI 开发者写作 Agent 的领域验收与 provider-neutral publish contract。
</user_constraints>

## Summary

Phase 4 应按“**先修复/重批载体合同（如需要）→ 确定性生成 → 离线 inspect → 影子环境 capability probe → exact preview/approval → 单一事务 seam apply → receipt-last**”来规划。Phase 3 已把 build contract、blueprint 与 plan approval 做成 exact raw-byte authority，Phase 4 不应重新推断需求，而应重新 admission 这些输入并把 resource graph 编译为 canonical package 与 OpenClaw 原生 projection。[VERIFIED: `src/build-contract.js`, `src/plan-approval.js`, `.planning/phases/03-build-contract/03-05-SUMMARY.md`]

D-42 固定两种不同角色：canonical directory 是构建权威，确定性 archive 是 preview/approval/apply 的唯一运输输入。Package producer 必须从已提交目录重建 archive；每个后续 authority 重复绑定 external archive digest、internal manifest digest、canonical inventory digest 与完整 member closure，并在任何 probe/preview/apply 副作用前 no-follow 重验。[VERIFIED: D-42]

最大的规划阻塞不是打包格式，而是两个必须显式处理的兼容性事实。第一，Phase 3 绑定 OpenClaw `2026.6.11`、revision `29d018f0…` 且 `exactRevisionRequired: true`，本机实际 CLI 是 `2026.7.1-2 (0790d9f)`；当前机器不能直接成为被批准的真实安装目标，必须准备 exact 版本 target，或回到 Phase 3 生成并批准新 contract。[VERIFIED: `.reference-repos/openclaw/package.json`, `.reference-repos/openclaw` git HEAD, `src/build-contract.js`, local `openclaw --version`] 第二，Phase 3 的 loop 声明四个真实 hook，却同时选择 bundled plugin lane，并把 external plugin auto-install 标成 unsupported；固定 OpenClaw 源码表明 `before_agent_run`、`after_tool_call`、`before_compaction`、`agent_end` 这类 typed hooks 由 plugin API 提供，当前 contract 没有识别一个 bundled owner。Planner 必须先增加 contract-consistency gate：找到并验证现有 bundled owner，或回到 Phase 3 重新批准 workspace-local native plugin；Phase 4 不能悄悄改变载体。[VERIFIED: `src/build-contract.js`, `.reference-repos/openclaw/src/plugins/hook-types.ts`, `.reference-repos/openclaw/src/plugins/hooks.ts`]

安装层应把“普通 managed writes”“敏感 exact actions”“exact conflict set”做成三种独立 authority artifact，但可由一个 UI 收集。Apply 前重新 probe 并比较完整 fingerprint；每项变更使用 retained-handle/lstat/digest 三方比较，receipt 最后发布。失败只逆序移除本事务创建、AgentMo-owned、仍 pristine 的资产；其余保留并形成 incomplete receipt。[VERIFIED: `04-CONTEXT.md` D-35..D-41, `src/builder-install.js`, `src/persistability.js`]

**Primary recommendation:** Plan 04-01 先建立增量 contract test gate，Plan 04-02 再解决 “OpenClaw exact-version target” 与 “四个 hook 的真实 owner/carrier” 两个 authority gate；随后以 Node.js built-ins 逐 wave RED-first 实现 canonical package、shadow probe、exact plan/approval 和 ownership-safe transaction，禁止把 Phase 5 runtime 证据提前计入完成。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| canonical package 编译与 inspect | AgentMo Produce / CLI | 文件系统 | 由已批准 build contract 决定字节；OpenClaw 不应反向成为 canonical authority。[VERIFIED: `docs/STAGE_CONTRACTS.md`, D-34] |
| OpenClaw workspace、skill、config projection | Target adapter | OpenClaw workspace/config | Adapter 只投影 canonical 语义，workspace/skill 是最低信任载体。[VERIFIED: D-33, `.reference-repos/openclaw/src/skills/loading/workspace.ts`] |
| typed lifecycle hooks | OpenClaw native plugin | AgentMo contract | OpenClaw typed hook surface 是 plugin API；具体 owner 必须在 contract 中先确定。[VERIFIED: `.reference-repos/openclaw/src/plugins/hook-types.ts`] |
| isolated external tool surface（若 contract 需要） | MCP server 进程 | OpenClaw MCP config | MCP 提供进程边界；注册/探测可能启动进程或联网，须 exact-action approval。[VERIFIED: `.reference-repos/openclaw/src/cli/mcp-cli.ts`] |
| capability/runtime probe | AgentMo shadow-probe adapter | 临时 synthetic HOME | 读取目标字节由 AgentMo 完成，OpenClaw CLI 只能在影子 HOME/state/config 中运行。[VERIFIED: `.reference-repos/openclaw/src/config/paths.ts`; local isolated-state observation] |
| install preview 与批准 | AgentMo authority layer | Target adapter | Plan 绑定 package、fingerprint、paths、operations、conflicts；OpenClaw runtime approvals 不是 package-install authority。[VERIFIED: D-36..D-41, `.reference-repos/openclaw/src/cli/exec-approvals-cli.ts`] |
| mutation、回滚、receipt | 单一 AgentMo transaction seam | OpenClaw 官方 config/plugin/MCP route | 统一执行所有 mutation；官方 route 仍受 AgentMo exact authority 与 ownership gate 包裹。[VERIFIED: `src/builder-install.js`, D-38..D-39] |
| credential 设置 | OpenClaw 官方 auth/secrets 边界 | AgentMo setup proposal | AgentMo 只记录 SecretRef、存在性与有界结果，不处理值。[VERIFIED: D-38, installed OpenClaw `models auth`/`secrets` CLI help] |
| real run、schedule trigger、memory readback、eval、Birth/Delivery | **Phase 5** | OpenClaw runtime | 这些是执行与运行证据，Phase 4 package/install receipt 不能认证。[VERIFIED: ROADMAP Phase 5, Deferred Ideas] |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| PACK-01 | 版本化 `agentmo.package.json` 记录 identity、contract version、source digests、target compatibility、capabilities、build-contract reference。 | `package-contract` schema；manifest 不自索引，避免 digest cycle；manifest digest 由 plan 外层绑定。 |
| PACK-02 | 可检查 prompts、skills、tools、hooks、memory policy、evals、target mappings、permissions、evidence refs、certification boundary、risks。 | canonical resource inventory + OpenClaw projection + capability ownership ledger。 |
| PACK-03 | 重复 Produce 的逻辑内容/逐文件 digest 相同，archive 可确定性重建。 | canonical JSON/LF/path/mode/mtime 规则与双构建 byte-for-byte test。 |
| PACK-04 | 最低信任载体选择与理由。 | per-capability carrier compiler；hook owner/carrier consistency gate。 |
| PACK-05 | 不安装即可 inspect；不得包含 secrets/auth/session/db/transcript。 | offline verifier + persistability/value-blind audit + adversarial fixtures。 |
| OCLW-01 | mutation 前 probe identity、CLI/JSON、workspace/skill/plugin、sandbox/tool、permission route、version。 | AgentMo direct-FS target probe + synthetic-HOME OpenClaw shadow probe + normalized fingerprint。 |
| OCLW-02 | preview operations/patch/paths/conflicts/rollback；批准 exact plan；漂移失效。 | plan digest 绑定 package+fingerprint+target+conflict set；apply 即刻 re-probe。 |
| OCLW-03 | receipt 逐项记录 target、path、before/after digest、marker、external deps。 | receipt-last transaction journal 与 per-operation observation。 |
| OCLW-04 | 保留 unknown/modified，除非 exact conflict approval。 | three-way ownership classification、retained handle、whole conflict-set approval。 |
| OCLW-05 | workspace/config/skills 与 credential/session 分离；配置最小字段 patch。 | 分离目录/authority；OpenClaw `config patch --dry-run --json` + exact base hash。 |
| EVID-05 | 每项 tool/hook/plugin/side-effect 有 owner/version/digest/permission/approval/failure/unsupported；敏感动作 fail-closed。 | capability ledger + one decision per exact sensitive action + negative route tests。 |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- 只在 AgentMo 仓库工作；不得读取或修改 sibling projects。[VERIFIED: `AGENTS.md`]
- 永不读取、打印、摘要或复制 `.env`；durable docs/evidence 不得包含 credential value、raw provider payload、raw transcript、credential-bearing OpenClaw state 或未脱敏 stdout/stderr。[VERIFIED: `AGENTS.md`]
- 后续代码变更必须运行 `npm run check` 与 `git diff --check`；Phase 4 触及 Produce/runtime/birth-loop 语义时，还应按 `docs/MVP_RUNBOOK.md` 和 `docs/OMX_SESSION_MIGRATION.md` 运行相应 contract/vertical-slice tests。[VERIFIED: `AGENTS.md`]
- `--runtime-env-file` 保持唯一公开 runtime env-file 选项；不得恢复冲突 launcher alias。[VERIFIED: `AGENTS.md`]
- `scripts/node20-distribution-trust.json` 是不可由 caller/env 覆盖的 trust anchor；Node 20 producer 必须写入新的 absent receipt path，成功后原字节发布，再运行 consumers；consumer 不进入 producer manifest。[VERIFIED: `AGENTS.md`]
- runtime receipts/compatibility rows 只证明有界机制，不认证领域质量、生产 readiness 或更广 OpenClaw compatibility。[VERIFIED: `AGENTS.md`]
- architecture、schema、runtime、Produce、evidence boundary 改动需要维护 `release/YYYY.MM.DD.md`，仅记录摘要路径/命令/hash/status/risk，不写 raw logs。[VERIFIED: `AGENTS.md`]
- `declared-ready`、`live-success`、domain quality、production approval 不可传递；birth-report fail-closed 且 non-self-certifying；`observe-run` 只提案不自动改 blueprint/scaffold/runtime/evals。[VERIFIED: `AGENTS.md`]
- 本研究不提交；若未来用户明确要求提交，必须显式 stage 路径，禁止 `git add .`/`git add -A`。[VERIFIED: `AGENTS.md`]

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|---|---:|---|---|
| Node.js built-ins | current project runtime；本机 `v24.18.0` | `crypto` digest、`fs` retained-handle/lstat、`child_process.spawn`、`path`、`os.tmpdir` | 项目现有 Phase 1–3 均使用 built-ins、手写 validator、canonical JSON 与 atomic publish；Phase 4 无需新增 supply-chain surface。[VERIFIED: `package.json`, `src/artifact-admission.js`, `src/persistability.js`; local `node --version`] |
| AgentMo exact admission | repository modules | 重新 admission blueprint/build-contract/plan-approval/package/probe/plan/approvals/receipt | 已有 raw-byte digest、closed subject registry、non-self-certifying approval 语义。[VERIFIED: `src/artifact-admission.js`, `src/artifact-registry.js`, `src/plan-approval.js`] |
| OpenClaw source snapshot | `2026.6.11`, `29d018f0af5e92ff1c131f08dd9308e6c9e38e59` | projection 与 capability contract 的源码权威 | Phase 3 build contract exact 绑定此版本/revision。[VERIFIED: `.reference-repos/openclaw/package.json`, local git HEAD, `src/build-contract.js`] |
| OpenClaw CLI target | **必须与 approved contract exact 匹配** | shadow probe、官方 config/plugin/MCP/auth route | 版本号不足以判断兼容，必须绑定 normalized fingerprint。[VERIFIED: D-41, `.reference-repos/openclaw/src/cli/*`] |

### Supporting

| Library / Module | Version | Purpose | When to Use |
|---|---:|---|---|
| `src/persistability.js` | repository | value-blind preflight、canonical JSON、atomic publish | 所有 package/plan/approval/receipt 写入前。[VERIFIED: source] |
| `src/builder-install.js` | repository | ownership、three-way digest、attempt/incomplete receipt 经验 | 复用原则与小型 helper；不得复用 Builder host schema 作为 Agent Package schema。[VERIFIED: source, `04-CONTEXT.md`] |
| OpenClaw `config patch --dry-run --json` | snapshot/target capability | 验证最小 merge patch 与 SecretRef schema | config mutation 前；不得用 whole-file overwrite。[VERIFIED: `.reference-repos/openclaw/src/cli/config-cli.ts`] |
| OpenClaw manifest/security scanner | snapshot/target capability | 校验本地 plugin manifests、host/API range、entries 与风险 | 只有 contract 经重批选择 workspace-local native plugin 时；禁止 `--force`/`--link`。[VERIFIED: `.reference-repos/openclaw/src/plugins/install.ts`, plugin loader/security modules] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Node built-ins + project canonical writer | 新增 archive/schema/transaction npm package | 没有必要且增加外部包 legitimacy 与 lifecycle；现有项目已有足够 primitives。[VERIFIED: existing code inventory] |
| workspace/content/skill | MCP | 只有需要隔离进程 tool surface 才使用；`mcp add` 默认会 probe，可能启动进程/联网。[VERIFIED: D-33, `.reference-repos/openclaw/src/cli/mcp-cli.ts`] |
| workspace/content/skill 或 verified bundled owner | native plugin | 仅 typed hook/in-process tool 必需时使用；会扩大加载代码与 plugin ownership surface。[VERIFIED: D-33, OpenClaw plugin API] |
| AgentMo direct whole-config write | OpenClaw minimal `config patch` | whole overwrite会破坏未知字段与并发更新；官方 mutate path带 validation、lock 与 base hash。[VERIFIED: `.reference-repos/openclaw/src/config/mutate.ts`, `.reference-repos/openclaw/src/cli/config-cli.ts`] |

**Installation:** Phase 4 推荐不新增 npm package；无 package legitimacy gate。[VERIFIED: project built-in-only pattern]

## Package Legitimacy Audit

本阶段推荐栈不安装外部 npm/PyPI/crates package，因此 package legitimacy gate 不适用。[VERIFIED: Standard Stack decision] 若为 native plugin 引入第三方依赖，必须在重新批准 build contract 后另行执行 registry、official-doc 与 postinstall 审计；当前计划不得预留“以后自动安装依赖”的模糊权限。[VERIFIED: D-36, D-37]

## Architecture Patterns

### System Architecture Diagram

```text
exact blueprint + recipe-bearing build contract + plan approval
                    |
                    v
          [Produce admission gate]
                    |
 canonical plugin recipe + target valid? -- no --> fail closed / return to Phase 3
                    |
                   yes
                    v
   [target-neutral compiler] ---> canonical package directory
                    |                    |
                    |                    +--> offline inspect (human + JSON)
                    |                    |
                    v                    +--> deterministic archive
        OpenClaw native projection
                    |
                    +------------------------------+
                                   |
                                   v
    [direct-FS probe + synthetic-HOME CLI shadow probe]
                    |
        exact revision/fingerprint valid? -- no --> fail closed
                    |
                   yes
                    v
 [archive-only install preview: ops + minimal patch + conflicts + rollback]
                    |
        +-----------+------------------+
        |                              |
 ordinary plan approval     sensitive-action + conflict approvals
        +-----------+------------------+
                    |
                    v
              [re-probe gate]
                    |
       drift? ------+------ yes --> invalidate approvals
                    |
                   no
                    v
 [archive-only apply revalidation -> journal -> writes/routes -> observe -> receipt-last]
                    |
        failure ----+---- success
          |                  |
 preserve non-pristine   bounded install receipt
 + incomplete receipt        |
                              v
                    Phase 5 runtime execution
```

### Recommended Project Structure

```text
src/
├── build-contract.js                # Phase 3-approved canonical native-plugin recipe
├── package-contract.js              # canonical manifest/resource validators
├── package-produce.js               # exact inputs -> deterministic directory
├── package-archive.js               # deterministic transport encoding/rebuild
├── package-inspect.js               # offline human + stable JSON inspection
├── package-carriers.js              # capability -> lowest-trust carrier + rationale
├── openclaw-target-admission.js      # exact target + approved recipe digest authority
├── openclaw-probe.js                # direct-FS + synthetic-HOME CLI shadow probe
├── openclaw-install-plan.js         # operations/config/conflicts/rollback preview
├── openclaw-install-approval.js     # ordinary/sensitive/conflict authorities
├── openclaw-install-transaction.js  # only Phase 4 target mutation seam
├── openclaw-install-receipt.js      # complete/incomplete receipt validation
├── openclaw-credential-handoff.js   # value-blind official-route proposal
└── targets/
    └── openclaw-package.js          # canonical -> native projection

test/
├── openclaw-build-contract.test.js
├── package-contract.test.js
├── package-produce.test.js
├── package-determinism.test.js
├── package-inspect.test.js
├── package-carriers.test.js
├── openclaw-probe.test.js
├── openclaw-install-plan.test.js
├── openclaw-install-approval.test.js
├── openclaw-install-transaction.test.js
├── openclaw-package.test.js
└── phase4-contracts.test.js
```

模块名可调整，但必须保持“recipe authority / compiler / inspect / probe / plan / authority / mutation / receipt”边界，且所有 target mutation 只经过一个 seam。D-42 要求目录到 archive 的确定性转换发生在 compiler 后；preview/approval/apply 不得回退到 package root 或 manifest-only transport。[VERIFIED: D-34, D-40, D-42, existing repository module pattern]

### Pattern 1: Manifest 索引其他资源，不自我索引

**What:** `agentmo.package.json` 包含 identity、contract version、source bindings、target compatibility、capability ledger 与所有其他文件的 `{path,size,mode,digest}`；manifest 本身的 raw digest 由 inspect result/install plan 外层绑定，避免自引用 digest cycle。[VERIFIED: cryptographic dependency reasoning; project exact-binding pattern]

**Determinism rules:** canonical JSON key order与结尾 LF、UTF-8、固定 mode、稳定 UTF-8 byte-order path、无绝对路径/`..`/反斜线/NUL/case-fold collision、无 symlink/hardlink/device、无 wall-clock/hostname/temp path/random ID。Archive 使用同一排序、`uid/gid=0`、`mtime=0`、固定 mode，且以规范目录为 authority。[VERIFIED: existing canonical JSON behavior in `src/persistability.js`; archive details selected under D-40 discretion]

### Pattern 2: Probe target bytes 与执行 CLI 分离

**What:** AgentMo 自己通过 retained file handles、`lstat`、raw digest 读取 target path/config/conflict state；需要确认 CLI/JSON/sandbox/plugin surface 时，把 package projection 复制到新的临时 synthetic `HOME`、`OPENCLAW_STATE_DIR`、`OPENCLAW_CONFIG_PATH` 后运行 OpenClaw，丢弃整个 shadow tree。[VERIFIED: `.reference-repos/openclaw/src/config/paths.ts`; local observation]

**Why:** 本次只设置临时 `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` 的“只读”CLI 观察仍尝试迁移实际 HOME 下 legacy exec approvals，并在临时 state 创建 device identity、SQLite 与 approval state。因此 CLI command 看起来只读，不等于进程无启动写入；不能对 operator live HOME/state 直接 probe。[VERIFIED: local installed OpenClaw observation; no credential/session/profile contents inspected]

### Pattern 3: 三层 exact authority

**What:**  
1. `agentmo.openclaw-install-approval.v1` 绑定普通 managed operations 的 exact plan digest；  
2. 每个网络/credential/process/external command/user-scope action 有独立 `agentmo.openclaw-sensitive-action-decision.v1`；  
3. 一份 `agentmo.openclaw-conflict-approval.v1` 绑定整个 conflict set，每项含 path/current digest/desired digest/action。[VERIFIED: D-36, D-37]

`apply` 必须同时绑定 package manifest digest、probe fingerprint digest、target identity、conflict-set digest、operation/action digest，并在 mutation 前 re-probe。missing/deny/timeout/cancel/mismatch/expired/reused 一律 fail-closed。[VERIFIED: D-36, EVID-05]

### Pattern 4: Receipt-last 与保守恢复

**What:** 私有 attempt journal 先写，逐操作执行并 post-observe；complete receipt 最后发布。中断时只逆序移除“本事务创建 + AgentMo owner marker + inode/identity 未换 + content 仍是 desired digest”的资产。其他资产保留并列入 incomplete receipt。[VERIFIED: D-39, `src/builder-install.js` ownership/recovery patterns]

### Anti-Patterns to Avoid

- **只生成 declaration/scaffold：** D-32 要求 OpenClaw 真正消费的 workspace、skill、tool binding、hook implementation、memory policy 与 eval resources。[VERIFIED: D-32]
- **用安装审批覆盖 source incompatibility：** installed `2026.7.1-2` 与 exact `2026.6.11` contract 不匹配；install approval 不能升级 Phase 3 authority。[VERIFIED: source and local version checks]
- **在 live HOME 上运行所谓只读 OpenClaw CLI：** 启动迁移可能写 state；必须 synthetic HOME shadow。[VERIFIED: local observation]
- **`plugins install --force`/`--link` 或 runtime inspect 作为 probe：** 会扩大覆盖、外部引用或加载代码；Phase 4 probe 用 manifest-only，runtime load 属 Phase 5。[VERIFIED: installed CLI help, OpenClaw plugin installer/loader source]
- **直接调用 `mcp add` 而未分类副作用：** 默认 probe 可能启动进程/联网；要么 `--no-probe` 安装 disabled config，要么 exact-action approval。[VERIFIED: `.reference-repos/openclaw/src/cli/mcp-cli.ts`]
- **把 OpenClaw exec approvals 当 package-install authority：** 它们面向 runtime exec policy/snapshot，不绑定 AgentMo package/conflict plan。[VERIFIED: `.reference-repos/openclaw/src/cli/exec-approvals-cli.ts`]
- **receipt-first 或破坏性“原子回滚”：** 会把未完成操作宣称为完成，或删除用户修改资产。[VERIFIED: D-39]

## Executable Package Contract

首版 package 应至少生成下列真实资源；manifest declaration 只是索引，不替代这些字节。[VERIFIED: D-32, D-34]

```text
agentmo.package.json
resources/
├── prompts/*.md
├── skills/<skill-id>/SKILL.md
├── tools/*.json
├── hooks/<owner-id>/*                 # 实现字节，而非 hook 名字列表
├── memory/policy.json
├── evals/*.json
├── permissions.json
└── evidence-boundary.json
projections/openclaw/
├── workspace/AGENTS.md
├── workspace/SOUL.md
├── workspace/IDENTITY.md
├── workspace/USER.md
├── workspace/TOOLS.md
├── workspace/MEMORY.md
├── workspace/memory/
├── workspace/skills/<skill-id>/SKILL.md
├── config/openclaw.agent.patch.json
├── capability-map.json
├── runtime-binding.json
├── schedule-proposals/*.json          # proposal only
├── credential-setup-proposal.json     # SecretRef + official route only
├── plugins/<plugin-id>/...            # only after carrier contract approval
└── mcp/<server-id>/...                # only if isolated external tool required
```

OpenClaw workspace skill loader确实消费 `<workspace>/skills/<id>/SKILL.md`，其 precedence 高于 extra、bundled、managed、personal `.agents` 与 project `.agents`；loader还执行 source/candidate/prompt/file-size 与 symlink-boundary checks。因此 projection 必须生成合规 `SKILL.md` 与 bounded asset tree，而不是另造 AgentMo-only skill 格式。[VERIFIED: `.reference-repos/openclaw/src/skills/loading/workspace.ts`, `loading/config.ts`, `loading/frontmatter.ts`]

工具策略必须投影 OpenClaw 的实际 policy pipeline，而不是 Phase 3 中四行概述的自足替代。固定源码的 effective policy 包括 profile、provider profile、global/agent allow、provider-specific allow、group/sender 等层，并可被 trusted plugin policies进一步 block/mutate；package ledger 应记录声明 owner 与预期 policy，而 capability fingerprint/inspect 显示 target 实际组合。[VERIFIED: `.reference-repos/openclaw/src/agents/tool-policy*.ts`, plugin tool policy source]

当前 build contract 的 memory owner 是 bundled `memory-core`，workspace `MEMORY.md` 与 `memory/` 是内容载体；Phase 4 只安装策略/文件与 capability mapping。Embedding/RAG 建库、memory readback 与竞争 slot 的真实行为验证属于 Phase 5。[VERIFIED: `src/build-contract.js`, `.reference-repos/openclaw/extensions/memory-core`, Deferred Ideas]

### Hook carrier gate（必须进入 Plans 04-01/04-02）

Phase 3 声明 `before-attempt`、`after-tool`、`before-checkpoint`、`after-attempt`，但它们不是 OpenClaw API 的原名；可映射候选分别为 `before_agent_run`、`after_tool_call`、`before_compaction`、`agent_end`。这是语义映射，不能仅凭名字自动确认。[VERIFIED: `src/build-contract.js`, `.reference-repos/openclaw/src/plugins/hook-types.ts`] OpenClaw 的这些 typed hooks 通过 plugin API 注册；当前 build contract 同时选择 `plugins.selectedLane: "bundled"`、`automaticExternalInstall: false`，并未指出哪个 bundled plugin 拥有 AgentMo-specific handlers。[VERIFIED: `src/build-contract.js`, OpenClaw plugin API]

因此 Planner 必须设置阻塞式 contract test：

1. 每个 abstract hook 有 exact OpenClaw event mapping、owner、version range、permission、timeout/failure semantics；
2. owner 必须是已验证的 bundled plugin，或经 Phase 3 新 plan approval 批准的 package-local native plugin canonical recipe；recipe 必须包含完整排序的 portable relative paths、fixed modes、exact normalized UTF-8 contents、重算的 per-file SHA-256 与 canonical recipe digest；
3. Plan 04-02 只批准 recipe 与 target authority，不读取或要求 pre-existing plugin implementation file；Plan 04-03 才能 solely from recipe 生成并逐文件重验 bytes；
4. 若没有 owner/recipe，不得以 JSON hook declaration 冒充完成，也不得由 Phase 4 自行猜测实现或映射。

## Requirement → Module / Test / Negative Case / Verification Map

| Req | Primary modules | Required tests | 必测 negative cases | Phase gate verification |
|---|---|---|---|---|
| PACK-01 | `package-contract.js`, `package-produce.js`, artifact registry/subjects | manifest schema、closed fields、exact source binding | missing identity/version/source/build ref；unknown field；manifest path collision；source digest mismatch | inspect JSON 中 manifest valid；重新 admission 原始 blueprint/build contract/plan approval。[VERIFIED: requirement + admission pattern] |
| PACK-02 | `build-contract.js`, `package-contract.js`, `package-carriers.js`, `targets/openclaw-package.js` | recipe-bearing contract；每类 resource 有真实文件与 ledger entry | hook recipe 缺 path/mode/content/digest；声明 capability 但生成文件缺失；extra unindexed file | Plan 04-03 generated bytes 与 Plan 04-02 approved recipe byte-for-byte 相等；capability 与 projection 双向覆盖。[VERIFIED: PACK-02, D-32] |
| PACK-03 | `build-contract.js`, `package-produce.js`, `package-archive.js` | recipe digest canonical；同输入在不同 temp roots/clock/locale 连续构建；目录与 archive byte equal | recipe order/content/digest 漂移；timestamp/absolute path/random id 泄漏；path order/Unicode/case collision；symlink/device | 两次 recipe-derived plugin/manifest/file/archive bytes 完全相同；extract 后 inventory 相同。[VERIFIED: PACK-03] |
| PACK-04 | `package-carriers.js`, `openclaw-target-admission.js`, OpenClaw projection | per-capability lowest-trust selection；hook recipe/carrier gate | 普通 content 被升为 plugin；MCP 无 executable；plugin 要求 pre-existing bytes 或无 exact necessity/recipe/owner | inspect 显示 carrier、recipe digest、necessity、trust、unsupported behavior；contract consistency green。[VERIFIED: D-33, PACK-04] |
| PACK-05 | `package-inspect.js`, persistability audit | directory/archive offline inspect human/JSON stability | secret value/auth profile/session/db/raw transcript/provider payload/stdout fixture；inspect 触发 mutation | temp target unchanged；output value-blind；human/JSON semantic equality。[VERIFIED: PACK-05, AGENTS.md] |
| OCLW-01 | `openclaw-probe.js`, fingerprint normalizer | source snapshot fixture、exact target fixture、drift fixture、synthetic HOME | command exists但 JSON schema/flags drift；live HOME startup write；unknown version/revision | fingerprint 覆盖 binary/version/Node/CLI+JSON/workspace/skills/plugins/MCP/sandbox/tool/permission/paths/conflicts。[VERIFIED: D-41] |
| OCLW-02 | `openclaw-install-plan.js`, `openclaw-install-approval.js` | preview stable；re-probe exact match；config dry-run | operation/path/patch/target/fingerprint/conflict bytes 任一漂移；approval replay/expiry | apply 前 recompute 全部 digest；任何差异零 mutation。[VERIFIED: OCLW-02, D-36..D-37] |
| OCLW-03 | `openclaw-install-transaction.js`, `openclaw-install-receipt.js` | fresh install、post-observe、receipt-last、中断 recovery | receipt 提前出现；before/after digest缺失；marker不匹配；external dep 未记录 | receipt逐操作记录 target/path/before/after/mode/owner/external deps/status；complete仅在全成功后。[VERIFIED: OCLW-03, D-39] |
| OCLW-04 | transaction ownership classifier | unknown/modified/external/AgentMo-pristine matrix；conflict-set approval | blanket overwrite；TOCTOU inode swap；批准后 current bytes变；rollback 删除用户改动 | preserve-on-conflict；whole set drift失效；incomplete receipt列出 preserved assets。[VERIFIED: OCLW-04, D-37..D-39] |
| OCLW-05 | target adapter、config patch route、credential handoff | workspace/skill/config/credential/session separate roots；minimal patch | whole config replace；array unintended replace；secret value进入 plan/argv/log；session/db打包 | `config patch --dry-run --json` 成功且 base digest exact；receipt只有 SecretRef/存在性/route result。[VERIFIED: OCLW-05, D-38] |
| EVID-05 | capability ledger、sensitive decisions、transaction seam | tool/hook/plugin/side-effect field completeness；decision state machine | missing/deny/timeout/cancel/mismatch/target drift/argv drift/env-value leak | 每项 capability 有 owner/version/digest/permission/approval/failure/unsupported；敏感动作逐项 receipt。[VERIFIED: EVID-05] |
| CONTEXT D-42 | `package-archive.js`, `package-inspect.js`, `openclaw-probe.js`, install plan/approval/transaction | directory build authority；archive-only preview/approval/apply；full closure retained revalidation | package-root/manifest-only transport；outer digest drift；extra/missing member；type/mode/content/identity swap | 每个 install authority 重复绑定 archive/manifest/inventory/member closure；preview/apply 在副作用前重验并零 mutation 失败关闭。[VERIFIED: D-42] |

### Suggested wave order

1. **Plan 04-01 — validation/package contract bootstrap:** package、carrier 与可增量扩展的 phase contract RED tests。
2. **Plan 04-02 — recipe + authority checkpoint:** 把 package-local native-plugin canonical byte recipe/content specification 写入 Phase 3 reapproved build contract，plan approval 绑定其 exact bytes，target/carrier admission 重复绑定 recipe digest；不要求 implementation file。
3. **Plans 04-03/04 — deterministic package + inspect:** solely from approved recipe 生成 plugin bytes，完成 canonical resources、OpenClaw projection、D-42 archive 与 human/JSON offline inspect。
4. **Plan 04-05 — read-only compatibility:** direct-FS probe、synthetic-HOME shadow、fingerprint、version/drift fail-closed。
5. **Plans 04-06/07/08 — lifecycle authority:** operations、prior receipt/absent genesis、receipt identity、create-only writers、registry/CLI、ordinary/sensitive/conflict approvals。
6. **Plan 04-09 — apply/recovery:** single mutation seam、journal、ownership-safe rollback、complete/incomplete receipt-last publication、credential handoff。
7. **Plans 04-10/11 — closure:** packed inventory、CLI/help/docs/release、full suite、support-triage declared package/install regression；不运行 Phase 5 领域 agent。

依赖关系必须保持 `recipe authority -> package directory -> D-42 archive -> inspect/probe -> archive-only preview -> archive-bound approval -> re-probe -> archive-only mutation -> receipt`，不能为并行化跨越 exact authority gates。[VERIFIED: D-32..D-42]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| OpenClaw config schema/merge | 自定义 whole-file JSON overwrite | 官方 `config patch --dry-run --json` + base digest +最小 patch | OpenClaw 自带 validation、lock、base-hash conflict，数组/`null` 语义需由官方实现解释。[VERIFIED: config CLI/mutate source] |
| credential secret store | AgentMo secret prompt、env capture、auth profile copy | `models auth ...` 或 `secrets configure/apply` 官方交互 route | Secret value 必须直接进入 OpenClaw boundary；AgentMo 只持有 SecretRef。[VERIFIED: D-38, installed CLI help] |
| OpenClaw skill discovery/precedence | AgentMo 自定义 skill loader | 生成 workspace-native `skills/<id>/SKILL.md` 并用 shadow `skills list --eligible --json` 验证 | OpenClaw 已实现 precedence、eligibility、limits、symlink containment。[VERIFIED: OpenClaw skills source] |
| plugin manifest/API/security validation | 仅检查 package.json 或自行加载 plugin | OpenClaw manifest registry/security scan，且不在 probe 阶段 runtime-load | OpenClaw校验 plugin id、host/API ranges、entries 与安全问题。[VERIFIED: OpenClaw plugin source] |
| runtime exec approval | 用 package approval 模拟 agent run审批 | Phase 4 只定义 install exact-action；Phase 5 使用 OpenClaw runtime approval route | 两种 authority subject 不同，不可互相传递。[VERIFIED: OpenClaw exec approvals source, D-36] |
| archive compression magic | 平台 `tar` 默认输出或用 package root 替代 transport | 小型明确 canonical transport encoder；directory 保持 build authority，archive 保持 preview/approval/apply 唯一 transport | 平台 tar metadata/order/format 会影响 digest；D-42 不允许省略 archive transport。[VERIFIED: PACK-03, D-42] |

**Key insight:** 可以复用 OpenClaw 已有 schema/loader/scanner/auth surface，但不能把它们当 AgentMo install authority；反之，AgentMo exact approval 也不能替代 OpenClaw runtime/tool authorization。[VERIFIED: stage and authority separation]

## Common Pitfalls

### Pitfall 1: Exact source drift 被“版本大致兼容”掩盖
**What goes wrong:** 本机较新 OpenClaw 被直接安装，Phase 3 exact revision binding失效。  
**Why it happens:** 只比较 semver/命令存在。  
**How to avoid:** exact revision required时 fingerprint必须包含 source identity；否则回到 Phase 3重批。  
**Warning signs:** `2026.7.1-2` target 对 `2026.6.11/29d018f0` contract 仍显示 compatible。[VERIFIED: local/source comparison]

### Pitfall 2: 影子 state 仍泄漏到真实 HOME
**What goes wrong:** OpenClaw CLI startup发现/迁移 legacy state，或者使用 real-home default workspace/personal skills。  
**Why it happens:** 只设置 state/config env，没有设置 synthetic HOME。  
**How to avoid:** 新 temp HOME + explicit state/config/workspace；目标读取由 AgentMo direct FS完成；运行后审计只允许 temp tree变化。  
**Warning signs:** probe输出出现 operator personal skills/workspace，或真实 HOME path。[VERIFIED: local observation]

### Pitfall 3: Abstract hooks 被 JSON declaration“实现”
**What goes wrong:** package声称有四个 hook，但 OpenClaw 没有 handler owner。  
**Why it happens:** Phase 3 abstract hook名与 OpenClaw typed event名不同，plugin lane又没有具体 owner。  
**How to avoid:** Plans 04-01/04-02 carrier consistency and exact admission gates；找不到 bundled owner就回到 Phase 3重批包含 canonical byte recipe/content 的 package-local plugin contract。Plan 04-02 不接受 implementation path，Plan 04-03 solely from recipe 生成 bytes。  
**Warning signs:** capability ledger只有 hook names，或 target admission要求一个尚未由 Produce 生成的 plugin file；recipe 缺 exact content/path/mode/digest/version/failure。[VERIFIED: build contract vs OpenClaw hook API]

### Pitfall 4: TOCTOU 与批准漂移
**What goes wrong:** preview后 target file/inode/config/conflict set变化，apply仍覆盖。  
**Why it happens:** approval只绑定展示文本或路径，不绑定 raw current bytes/target identity。  
**How to avoid:** retained handles + lstat + current digest；apply前 re-probe；任意 drift让整套相关 authority失效。  
**Warning signs:** plan无 fingerprint/conflictSetDigest，或 apply不重新计算。[VERIFIED: D-37, D-41]

### Pitfall 5: 官方命令的隐藏副作用未分类
**What goes wrong:** `mcp add` probe启动进程/联网，plugin runtime inspect加载代码，credential command输出被捕获。  
**Why it happens:** 把官方 CLI 误当自动安全。  
**How to avoid:** 无副作用模式优先；每个 process/network/credential action独立 decision；stdout/stderr只保留bounded redacted status。  
**Warning signs:** plan只写 “run OpenClaw setup”，没有 exact argv/params/cwd/scope/target/timeout。[VERIFIED: D-36, OpenClaw CLI source/help]

### Pitfall 6: “回滚成功”靠删除不明资产
**What goes wrong:** 用户在安装过程中修改的文件被删，receipt却宣称atomic。  
**Why it happens:** 仅凭path/marker判断ownership。  
**How to avoid:** created-this-attempt + owner + inode + desired digest 四条件；否则preserve并发 incomplete receipt。  
**Warning signs:** rollback使用recursive delete或`--force`，没有post-failure digest。[VERIFIED: D-39]

## Code Examples

以下模式来自仓库现有 exact-digest/canonical-write 风格，并针对 Phase 4 收敛；不是可绕过 schema validator 的完整实现。[VERIFIED: `src/artifact-admission.js`, `src/persistability.js`, `src/plan-approval.js`]

### Exact install-plan basis

```js
// Source pattern: src/plan-approval.js + D-36/D-37/D-41
const basis = {
  schemaVersion: "agentmo.openclaw-install-plan.v1",
  packageManifestDigest,
  probeFingerprintDigest,
  target: {
    scope: "isolated-project",
    rootIdentity,
    configDigest,
  },
  conflictSetDigest,
  operations: operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    relativePath: operation.relativePath,
    currentDigest: operation.currentDigest,
    desiredDigest: operation.desiredDigest,
    mode: operation.mode,
    owner: operation.owner,
    rollbackEligibility: operation.rollbackEligibility,
    sensitiveActionDigest: operation.sensitiveActionDigest ?? null,
  })),
};
const planDigest = digestRawBytes(canonicalJsonBytes(basis));
```

### Synthetic-HOME shadow CLI

```js
// Source: .reference-repos/openclaw/src/config/paths.ts + local startup-write observation
const shadowHome = await fs.mkdtemp(path.join(os.tmpdir(), "agentmo-openclaw-probe-"));
const shadowState = path.join(shadowHome, ".openclaw");
const shadowConfig = path.join(shadowState, "openclaw.json");

const env = {
  PATH: process.env.PATH,
  HOME: shadowHome,
  OPENCLAW_STATE_DIR: shadowState,
  OPENCLAW_CONFIG_PATH: shadowConfig,
};

// fixed executable + argv; shell:false; bounded/redacted output
const child = spawn(openclawBinary, ["skills", "list", "--eligible", "--json"], {
  env,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
});
```

实现必须过滤 inherited env，只传显式允许的非秘密键；示例中的 `PATH` 也应在实现中记录 normalized tool path/digest，而不是信任 caller replacement。[VERIFIED: D-36, AGENTS runtime trust constraints]

### Ownership-safe rollback predicate

```js
// Source pattern: src/builder-install.js + D-39
function canAutoRollback(observed, journalEntry) {
  return journalEntry.createdByThisAttempt === true
    && observed.ownerMarkerDigest === journalEntry.ownerMarkerDigest
    && observed.fileIdentity === journalEntry.createdFileIdentity
    && observed.contentDigest === journalEntry.desiredDigest;
}
```

任何条件不满足时返回 preserve，不得降级为按 path 删除。[VERIFIED: D-39]

### Capability ledger entry

```json
{
  "capabilityId": "hook:after-tool",
  "carrier": "native-plugin",
  "owner": "agentmo-openclaw-harness",
  "openclawEvent": "after_tool_call",
  "versionRange": "exact-approved-range",
  "implementationDigest": "sha256:...",
  "permission": "observe-tool-result-metadata",
  "approvalRequirement": "contract-and-install-plan",
  "failureSemantics": "fail-closed-or-bounded-stop",
  "unsupportedBehavior": ["automatic external plugin install"]
}
```

只有 owner/carrier 经 upstream approval 后才能生成此条目；不能用示例值补齐当前 contract 缺口。[VERIFIED: PACK-04, EVID-05, hook carrier gate]

## State of the Art

| Old / insufficient approach | Current required approach | When changed / source | Impact |
|---|---|---|---|
| prompts/tool declarations + empty scaffold | 可由 OpenClaw 消费的 workspace/skill/config 以及真实 hook/tool implementation | Phase 4 D-32 | package generation 必须有 executable byte inventory。[VERIFIED: `04-CONTEXT.md`] |
| version/command existence gate | version + CLI/JSON + surfaces + policy + paths + conflicts 的 normalized fingerprint | Phase 4 D-41 | 每次 drift 都重新 probe/preview/approve。[VERIFIED: `04-CONTEXT.md`] |
| 一份批准覆盖所有动作 | ordinary plan、per-sensitive-action、whole exact conflict set 三层 authority | Phase 4 D-36/D-37 | UI 可统一，artifact authority 不合并。[VERIFIED: `04-CONTEXT.md`] |
| 直接写 secret/config | OpenClaw official auth/secrets handoff + minimal config patch | Phase 4 D-38/OCLW-05 | AgentMo receipt value-blind，未知 config preserved。[VERIFIED: context + requirements] |
| “全部删回去”模拟原子失败 | only-created/owned/pristine rollback + incomplete receipt | Phase 4 D-39 | 中断后安全性优先于整洁外观。[VERIFIED: `04-CONTEXT.md`] |
| plugin `before_agent_start` 作为新实现入口 | `before_model_resolve`/`before_prompt_build` 用于新 prompt/model mutation；typed loop gates使用当前明确事件 | current fixed OpenClaw source | 不应给新 plugin 继续使用 legacy fallback；具体事件语义必须逐项验证。[VERIFIED: `.reference-repos/openclaw/src/plugins/hooks.model-override-wiring.test.ts`, `hook-types.ts`] |

**Deprecated/outdated:**

- OpenClaw `hooks install` 已由 plugin installation route取代；Phase 4 不应规划 legacy hook installer。[VERIFIED: installed OpenClaw CLI help]
- OpenClaw `before_agent_start` 对 model/prompt override 是 legacy compatibility fallback；新实现优先更具体事件。[VERIFIED: OpenClaw hook wiring tests]
- Phase 3 `effectivePolicyPipeline` 四项摘要不是 Phase 4 target fingerprint 的完整 tool policy truth；必须读取当前 target surface。[VERIFIED: `src/build-contract.js`, OpenClaw tool policy source]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | 完整 synthetic HOME + explicit state/config/workspace 足以隔离 OpenClaw startup migration。[ASSUMED] | Architecture Pattern 2 | 若仍可发现系统级/legacy paths，probe可能触碰 operator state；Plan 04-05 必须用 fake HOME sentinel 与 filesystem diff 证实。 |
| A2 | 一个小型 canonical transport encoder 比引入新依赖更适合当前 repo。[ASSUMED] | Standard Stack / PACK-03 | 跨平台差异必须由 golden vectors 关闭；D-42 要求 archive 与 directory 同阶段交付，不能用 directory authority 代替 install transport。 |
| A3 | abstract hook 到候选 OpenClaw事件的语义映射可按 `before_agent_run`/`after_tool_call`/`before_compaction`/`agent_end` 实现。[ASSUMED] | Hook carrier gate | 若 lifecycle语义不等价，必须回到 Phase 3修改 contract，不能在 Phase 4猜测。 |

## Open Questions (RESOLVED)

1. **Exact OpenClaw 安装 target**
   - **Resolution:** 当前本机 `2026.7.1-2/0790d9f` 明确不属于已批准 target，Phase 4 不得对它 apply。执行只允许两条路径：提供与现有批准精确匹配的隔离 `2026.6.11/29d018f0…` target，或先回到 Phase 3 为实际 target 生成并人工批准新的 blueprint/build-contract pair。两者都没有发生时，Phase 4 在 target-admission checkpoint fail-closed；这不是可由 install approval 覆盖的开放设计选择。[RESOLVED from exact Phase 3 authority + D-41]

2. **四个 typed hook 的 owner/carrier**
   - **Resolution:** 当前 contract 没有批准一个可证明实现四个 typed hooks 的 bundled owner，因此 bundled-owner 假设不得继续使用。若 Plan 04-01 的 consistency test 不能从已批准 bytes 中证明 owner，唯一合法路径是回到 Phase 3 approval route，明确批准 package-local native plugin 的 deterministic canonical byte recipe/content specification、OpenClaw event mappings、permissions、timeout 与 failure semantics。Recipe 内含完整排序 path/mode/exact UTF-8 content/per-file digest 与 canonical recipe digest；Plan 04-02 的 target/carrier admission 绑定 recipe digest 且不要求 pre-existing plugin bytes，Plan 04-03 solely from recipe 生成并验证 exact bytes。[RESOLVED from D-32, D-33 + current contract/source mismatch]

3. **首版是否需要 MCP**
   - **Resolution:** 当前已批准 resource graph 的 tools 均按 OpenClaw runtime-owned surface 处理，Phase 4 v1 不引入 MCP。只有未来重新批准的 build contract 明确包含 OpenClaw 不提供的 external executable tool 时，才生成完整 MCP server/config，并把 process/network probe 和 activation 作为敏感 exact actions；不得由 Phase 4 carrier compiler自行升级。[RESOLVED from current resource graph + D-33]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| Node.js | build/test/CLI | ✓ | `v24.18.0`; project `>=20` | Node 20 distribution lane按 repo trust policy独立验证。[VERIFIED: local command, `package.json`, AGENTS.md] |
| npm | full suite / packed install | ✓ | `11.16.0` | — [VERIFIED: local command] |
| Git | source revision verification | ✓ | `2.50.1` | raw source snapshot digest inventory [VERIFIED: local command] |
| pinned OpenClaw source | projection research | ✓ | `2026.6.11`, `29d018f0…` | — [VERIFIED: local source] |
| exact approved OpenClaw executable target | real apply | ✗ | installed `2026.7.1-2 (0790d9f)` ≠ approved source | 提供 isolated exact target，或回 Phase 3重批。[VERIFIED: local CLI/source] |
| OpenClaw CLI | shadow capability probes | ✓ but incompatible | `/Users/alexzhu/.local/bin/openclaw` | source-backed fixtures可开发测试，但不能证明 real install compatibility。[VERIFIED: local command] |

**Missing dependencies with no fallback:**

- exact approved OpenClaw executable target：真实 apply 的 blocker；source fixture不能替代运行 target compatibility。[VERIFIED: exactRevisionRequired contract]

**Missing dependencies with fallback:**

- none。

## Validation Architecture

`workflow.nyquist_validation` 为 `true`。最终计划采用逐 wave RED-first：Plan 04-01 建立可增量扩展的 quick gate，Plans 04-02..11 在实现各自 production behavior 前创建并观察 focused RED tests；不存在一个预先创建全部测试的虚构 Wave 0。[VERIFIED: `.planning/config.json`, finalized Phase 4 plans]

### Test Framework

| Property | Value |
|---|---|
| Framework | Node.js built-in `node:test` |
| Config file | none；仓库使用 `node --test` discovery。[VERIFIED: `package.json`] |
| Quick run command | Plan 04-01 bootstrap trio；此后 `node --test test/phase4-contracts.test.js` 加当前 plan focused tests |
| Full suite command | `npm run check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| PACK-01/02/04 | package schema、resource completeness、carrier ledger | unit/contract | `node --test test/package-contract.test.js test/package-carriers.test.js` | ❌ Plan 04-01 RED |
| PACK-03 | repeated build/archive deterministic | integration | `node --test test/package-determinism.test.js` | ❌ Plan 04-03 RED |
| PACK-05 | offline inspect + no sensitive/raw state | security/contract | `node --test test/package-inspect.test.js` | ❌ Plan 04-04 RED |
| OCLW-01 | recipe-bound exact target admission + isolated probe/fingerprint/drift | integration/security | `node --test test/openclaw-build-contract.test.js test/openclaw-target-admission.test.js test/openclaw-probe.test.js` | ❌ Plans 04-02/05 RED |
| OCLW-02 | preview/exact approval/re-probe/archive closure | contract | `node --test test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js` | ❌ Plans 04-06..08 RED |
| OCLW-03/04/05 | receipt admission、receipt-last、ownership、minimal patch、credential separation | integration/security | `node --test test/openclaw-install-transaction.test.js` | ❌ Plans 04-07/09 RED |
| EVID-05 | capability ledger + sensitive action fail-closed + Phase 4/5 boundary | contract/security | `node --test test/phase4-contracts.test.js` | ❌ Plan 04-01 bootstrap then extend |
| all | stage boundary / packed distribution | regression | `node --test test/stage-contracts.test.js test/builder-packed-install.test.js` | ✅ existing, extend assertions |

### Sampling Rate

- **Per task commit:** 新增/受影响 test file 的 `node --test ...`
- **Per wave completion:** Plan 04-01 runs its bootstrap trio；Plans 04-02..11 run `test/phase4-contracts.test.js` plus focused tests.
- **Phase gate:** `npm run check && git diff --check`，并运行 `docs/MVP_RUNBOOK.md` 指定的 Stage 2 contract set 与 support-triage vertical-slice regression（仅 declared package/install boundary，不冒充 Phase 5 live evidence）。[VERIFIED: AGENTS.md]

### Planned RED-First Test Introduction

- [ ] Plan 04-01: package/carrier tests and incremental phase contract gate.
- [ ] Plan 04-02: canonical recipe-bearing build-contract and exact target/carrier admission tests.
- [ ] Plans 04-03..05: package build/determinism/inspect/probe focused tests.
- [ ] Plans 04-06..08: lifecycle plan/approval、receipt admission、writers、registry/CLI and fresh-process tests.
- [ ] Plan 04-09: lifecycle transaction/receipt-last/TOCTOU/archive-member drift tests.
- [ ] Plans 04-10/11: packed distribution、stage boundary and final regressions.
- [ ] Execution checkpoint: exact-version OpenClaw target or newly approved Phase 3 contract before real apply.

## Security Domain

`.planning/config.json` 的 `security_enforcement` 未关闭且 `asvs_level` 为 1，本阶段需要显式 security tests。[VERIFIED: `.planning/config.json`]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---:|---|
| V2 Authentication | limited | AgentMo不认证 provider；只输出 value-blind setup proposal并 handoff到 OpenClaw official auth/secrets route。[VERIFIED: D-38] |
| V3 Session Management | boundary only | session/auth profile/runtime DB 完全排除于 package/inspect/receipt；真实 session属 Phase 5。[VERIFIED: PACK-05, OCLW-05] |
| V4 Access Control | yes | default isolated project scope；ordinary/sensitive/conflict exact authorities；deny missing/stale/mismatch。[VERIFIED: D-35..D-37, EVID-05] |
| V5 Input Validation | yes | closed schemas、raw-byte digest、path normalization、lstat/type/mode/size、OpenClaw official schema dry-run。[VERIFIED: existing admission/persistability + OCLW-02] |
| V6 Cryptography | yes, integrity only | Node `crypto` SHA-256 exact digests；不自制 credential crypto，不把 digest误当身份/生产认证。[VERIFIED: `src/artifact-admission.js`, evidence semantics] |

### Known Threat Patterns for Node/OpenClaw installer

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| path traversal、case/Unicode collision、symlink escape | Tampering / Elevation | relative normalized allowlist、UTF-8 sort、casefold collision reject、retained handle + `lstat`、no links/devices。[VERIFIED: project security patterns; OpenClaw skill containment] |
| plan/target/conflict TOCTOU | Tampering | fingerprint/conflict digest、file identity、re-probe immediately before mutation。[VERIFIED: D-37, D-41] |
| approval replay或扩大 scope | Spoofing / Elevation | subject-specific exact digest、target/scope/action binding、expiry/use count、closed registry。[VERIFIED: D-35..D-37, artifact registry pattern] |
| child process shell/env injection | Elevation / Information Disclosure | fixed executable+argv、`shell:false`、explicit env allowlist、bounded redacted output、per-action decision。[VERIFIED: D-36, AGENTS secret policy] |
| plugin/MCP supply-chain or runtime load | Elevation | package-local exact bytes、manifest/API/security scan、no force/link、no runtime load during probe、separate action approval。[VERIFIED: OpenClaw plugin/MCP source] |
| recipe-to-byte substitution or D-42 archive/member swap | Tampering / Elevation | Phase 3 approval binds canonical recipe content/digest；Plan 04-03 accepts no source path and recomputes generated bytes；preview/approval/apply bind external archive + internal manifest/inventory/member closure and no-follow revalidate before effects。[VERIFIED: D-32, D-33, D-42] |
| secret/raw state泄漏到 artifacts | Information Disclosure | persistability audit、forbidden fixture tests、only SecretRef/presence/bounded result。[VERIFIED: AGENTS.md, D-38] |
| rollback删除用户修改 | Tampering / Denial of Service | created-by-attempt + owner + inode + pristine digest predicate；否则preserve。[VERIFIED: D-39] |
| evidence自我认证 | Repudiation / Spoofing | install receipt只证明bounded install；Phase 5 live/eval/Birth/Delivery独立 authority。[VERIFIED: AGENTS evidence semantics, ROADMAP] |

## Phase 4 / Phase 5 Boundary

| Phase 4 owns | Phase 5 owns |
|---|---|
| exact input/recipe re-admission；recipe-derived真实 package资源；deterministic D-42 archive；offline inspect | actual agent task execution与domain behavior |
| source/runtime capability probe；install preview/approval/apply/receipt | live plugin/hook/MCP behavior与tool execution |
| workspace/skill/config/plugin/MCP bytes与registry/config的安全安装（若contract批准） | schedule实际注册/trigger（当前contract仅proposal） |
| credential setup proposal与官方route handoff，不读取值 | authenticated provider call与session lifecycle |
| memory policy/files/slot mapping安装 | embedding/RAG index、memory readback、restart recovery |
| install mechanism evidence、incomplete recovery evidence | bounded eval、live-success、Birth/Delivery closure、upgrade/rollback/uninstall live proof |

Phase 4 的“loaded”若作为成功标准，只能表示 OpenClaw manifest/registry/skill eligibility 能在 shadow environment解析；不得运行 plugin code、连接 MCP、发起模型调用或声称 domain quality。[VERIFIED: deferred boundary + D-40 evidence semantics]

D-42 的 archive-only preview/approval/apply 是 Phase 4 安装运输与完整性边界，不是 Phase 5 runtime evidence。Directory inspection、manifest validity、archive closure 或 receipt 均不能证明 plugin hooks 实际运行、domain quality、Birth/Delivery 或 production readiness。[VERIFIED: D-42 + deferred boundary]

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` — scope、secrets、validation、runtime trust、release/evidence/commit constraints。
- `.planning/phases/04-package/04-CONTEXT.md` — D-32..D-42、继承边界与 deferred scope。
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — PACK/OCLW/EVID contracts 与 Phase 4/5 boundary。
- `src/build-contract.js`, `src/plan-approval.js`, `src/artifact-admission.js`, `src/persistability.js`, `src/builder-install.js` — exact input、resource graph、canonical write、ownership/recovery patterns。
- `.reference-repos/openclaw` at `29d018f0af5e92ff1c131f08dd9308e6c9e38e59` — package version/Node range、paths、skills、plugins、hooks、MCP、config、approval surfaces。
- local installed OpenClaw command help/version — available CLI surface与 actual version drift；只做 value-blind metadata observation。

### Secondary (MEDIUM confidence)

- `docs/STAGE_CONTRACTS.md`, `docs/OPENCLAW_RUNTIME_NOTES.md`, `docs/MVP_RUNBOOK.md`, `docs/AGENT_BIRTH_GATE.md`, `docs/OMX_SESSION_MIGRATION.md` — project-maintained stage/runtime/evidence guidance，均以本次 source inspection复核关键机制。

### Tertiary (LOW confidence)

- 无网络来源。A1–A3 仅为待测试假设，已列入 Assumptions Log。

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — 不新增包；直接复用仓库 built-ins 与 exact-admission primitives。[VERIFIED: repository]
- Architecture: HIGH — authority/boundary来自 locked decisions 与现有 installer patterns；hook与version冲突已显式阻塞。[VERIFIED: context + source]
- OpenClaw carriers: HIGH for exposed surfaces，LOW for unresolved hook semantic mapping — 固定源码直接验证 API，但 current contract未给出 owner。[VERIFIED: source; A3]
- Pitfalls: HIGH — drift、startup writes、config/plugin/MCP副作用均由 source或本机有界观察支持。[VERIFIED: source/local]

**Research date:** 2026-07-28  
**Valid until:** 2026-08-04（OpenClaw CLI/extension surface变化快；exact snapshot结论对 `29d018f0…` 持续有效）
