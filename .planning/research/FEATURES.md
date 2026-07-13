# Feature Landscape

**Domain:** coding 工具中的 AgentMo builder 方法论 + 生成的 OpenClaw Agent Package
**Researched:** 2026-07-11
**Overall confidence:** MEDIUM

> 置信度说明：结论来自当前 AgentMo 代码库及四个固定提交的一手源码镜像，并按 GSD `classify-confidence --provider ref --verified` 的代码级分类标为 `MEDIUM`。这足以指导 roadmap，但 OpenClaw 外部接口、Codex plugin 分发和真实发布平台仍应在各实现阶段重新探测。

AgentMo 有两个必须同时成立的产品平面：

- **Builder plane**：安装在 Codex 中的方法论、协议、skills、hooks、状态与恢复机制，负责执行 `Discover -> Plan -> Produce`。
- **Package plane**：由 Builder 编译生成的版本化 Agent Package，v1 只完整支持 OpenClaw，包含 workspace 内容、skills、按需 tools/hooks/plugin、memory policy、evals、权限与证据。

功能优先级的判断标准不是“命令数量”，而是能否从干净 Codex 会话复现两个包的完整生命周期：`support-triage` 证明机制一致性，中文 AI 内容写作智能体证明真实领域适用性。

## Table Stakes

缺失这些能力时，AgentMo 仍会像脚本集合、prompt 模板或 scaffold 生成器，而不是可信的 Agent builder。

### Builder Plane

| Feature | Why Expected | Complexity | v1/v2 | Status & Notes |
|---|---|---:|---|---|
| 单一 AgentMo 身份与版本化兼容迁移 | 用户必须看到唯一产品名；旧 `agentmother_*` 只能作为受控输入兼容，不能继续污染新工件 | Med | v1 必须 | **部分已有**：新 schema 多为 `agentmo_*`，但包描述和部分旧字段仍需迁移 |
| 严格三阶段生命周期 | `Discover`、`Plan`、`Produce` 是持久职责边界；install、doctor、eval、Birth Report 都是 Produce 内 gate | Med | v1 必须 | **基础已有**：阶段可独立运行；需把新 builder 工作流也锁定为同一生命周期 |
| 工件连接而非会话祖先连接 | fresh context、恢复和不同 coding 工具必须能从已校验工件继续，而不是依赖“刚执行过上一命令” | High | v1 必须 | **已有基础**：当前 Stage 2/3 契约支持独立进入；需扩展到 builder 状态与 package 生命周期 |
| Codex 原生安装包 | v1 的首个构建端必须能通过标准 plugin/skill/hook/agent 机制安装，而不是让用户手工复制仓库文件 | High | v1 必须 | **缺失**：需 package manifest、安装布局、setup/doctor/upgrade/uninstall、packed-install smoke |
| Codex 能力探测与 adapter contract | Codex App、CLI、sandbox、worktree、hooks、subagents 等能力不同；adapter 必须报告真实支持、降级和不支持面 | High | v1 必须 | **缺失**：Codex 做完整 adapter；其他工具只发布中立、版本化契约，不宣称支持 |
| Canonical source 与生成镜像一致性 | skills/prompts/hooks 的源文件、Codex plugin 镜像和发布包不能各自漂移 | Med | v1 必须 | **缺失**：借鉴 OMX SSOT check 与 Superpowers package tests；发布包应可重复构建并带 digest |
| Builder setup / doctor / upgrade / uninstall | 安装型 coding 工具产品的最低运维面；doctor 必须区分只读诊断和有副作用修复 | High | v1 必须 | **缺失**：默认只读 probe/doctor；修复、覆盖或删除必须显式授权且只触碰自有资产 |
| 持久状态、checkpoint 与 compaction 恢复 | 长研究和规划会跨上下文窗口；必须可从规范工件恢复且避免重复 hook/event | High | v1 必须 | **部分已有**：文件工件已存在；缺 builder session 状态、事件去重、恢复测试 |
| 行为评估而非仅文件检查 | skill 存在不代表 coding agent 会按方法论行动；需真实 Codex 会话 eval 验证触发、暂停、恢复和人工 gate | High | v1 必须 | **缺失**：借鉴 Superpowers 将非 LLM 集成测试与真实行为 eval 分开 |
| 中立 adapter 的事件 envelope | hooks、state 和 lifecycle 事件要有规范名称、版本、session/package identity、去重键和降级语义 | High | v1 核心；v2 扩展 | **缺失**：v1 只实现 Codex 映射；避免把 Codex 私有 payload 变成核心协议 |

### Discover

| Feature | Why Expected | Complexity | v1/v2 | Status & Notes |
|---|---|---:|---|---|
| 多来源 discovery adapters | 真实 agent 设计需要 Web、GitHub、论文和本地文档，而非只接受预制 manifest | High | v1 必须 | **缺失**：当前只有 manifest 和获批本地来源；新增 adapter，不削弱现有安全边界 |
| 统一来源记录与 discovery database | 每条材料需记录稳定身份、URL/路径、来源类型、检索时间、作者/发布者、摘要、hash、置信度和引用链 | High | v1 必须 | **部分已有**：现有 discovery DB/source cards 可演进为统一模型 |
| 去重、版本与新鲜度 | 同一论文、release 或观点可能跨来源重复；无版本/时间会造成事实冲突和过期建议 | Med | v1 必须 | **缺失**：先确定性 identity/hash + 显式冲突，不在 v1 自动裁决语义真伪 |
| 来源安全与隐私边界 | 网络内容和本地文档都属于不可信输入；不得摄取 `.env`、凭据、私密 transcript 或越界路径 | High | v1 必须 | **本地路径已有**；网络 adapter 需同等级 redaction、大小限制、内容类型和 provenance gate |
| 人类 source manifest 审批 | Discover 可以建议来源，但未经人审阅的数据不能静默塑造 Plan | Med | v1 必须 | **缺失**：审批应绑定 manifest hash/version；来源变化后旧审批失效 |
| 可审阅覆盖率与证据缺口 | 用户需在 Plan 前看到哪些任务已有证据、哪些只是一手观点、哪些仍未知 | Med | v1 必须 | **部分已有**：coverage/gaps 可复用；不可把 lexical match 当语义认证 |
| 增量刷新与大型语料索引 | 长期维护需要只更新变化来源并支持更大语料 | High | v2 | v1 保持有界集合和内存处理；先建立 benchmark 与 adapter 边界 |

### Plan

| Feature | Why Expected | Complexity | v1/v2 | Status & Notes |
|---|---|---:|---|---|
| 基于已批准数据库的持续人机对话 | Plan 的价值是澄清用户真实需求，不是从资料自动生成 blueprint | High | v1 必须 | **部分已有**：已有 `user-need`/`design-plan`；缺对话状态、问题策略和审批闭环 |
| 决策、约束、未知与拒绝项账本 | 多轮讨论中必须区分用户决定、AgentMo 推断、待定项和明确不做项 | Med | v1 必须 | **缺失**：每项带来源、时间、owner、状态和 supersedes 关系 |
| 需求到证据的双向追踪 | 每个能力、风险和 eval 应指回获批 facts；重要来源也要能看到影响了哪些决策 | High | v1 必须 | **基础已有**：`design-plan` 映射需扩展到 package capability 与领域编辑主张 |
| Blueprint + Package build contract | Plan 结束必须明确产出什么 package 形态、能力、权限、target mapping、eval 和 gate | High | v1 必须 | **部分已有**：现有 blueprint 是基础；需新增规范 Package build contract |
| 明确的人工 Plan 审批 | 未批准的计划不能进入 Produce；批准必须绑定精确版本/hash，修改后重新审批 | Med | v1 必须 | **缺失**：与 source manifest 审批分离，不允许隐式“继续即批准” |
| target-aware 可行性检查 | Plan 阶段应提前发现 OpenClaw 版本、skill/tool/plugin、sandbox 或审批能力不足 | High | v1 必须 | **缺失**：输出 unsupported/degraded capability，不等 Produce 安装后才失败 |
| 计划 review 与 drift guard | Produce 不应静默偏离已批准的 build contract；改变能力/权限时应回到人工决策 | High | v1 必须 | **缺失**：借鉴 GSD plan verification 和 OMX code-level authority |

### Produce and Package Plane

| Feature | Why Expected | Complexity | v1/v2 | Status & Notes |
|---|---|---:|---|---|
| 规范 `Agent Package manifest` | Package 必须描述身份、版本、target、能力、兼容范围、权限、文件 hashes、依赖、证据和风险 | High | v1 必须 | **缺失**：这是 install/upgrade/rollback/evidence 的共同根 |
| 确定性 materialize 与 package archive | 同一 build contract 应生成相同逻辑文件和摘要；发布包必须可检查、可重建 | High | v1 必须 | **部分已有**：managed write plan/scaffold 已确定性；需扩展为正式 archive 和内容清单 |
| 最小信任面 package 选择 | 纯说明优先 workspace/skill；兼容内容用 bundle；只有进程内 tool 或 typed hook 才用 native plugin | High | v1 必须 | **缺失**：不得默认给每个 agent 生成 native plugin |
| OpenClaw workspace 正确映射 | 应生成/管理 `AGENTS.md`、`SOUL.md`、`USER.md`、`IDENTITY.md`、`TOOLS.md`、按需 `HEARTBEAT.md`、memory 与 workspace skills | Med | v1 必须 | **部分已有**：当前 scaffold 已输出核心文件；需与最新 OpenClaw file map 和 ownership 对齐 |
| 配置、workspace、managed skills、凭据和 session 分离 | OpenClaw 明确把 workspace 与 `~/.openclaw` config/auth/session 分开；包不能携带机器状态 | Med | v1 必须 | **部分已有**：证据已排除 secrets/raw transcript；package manifest 需正式声明外部状态 |
| OpenClaw capability/version probe | 安装前确认 host、plugin API、bundle mapping、doctor、sandbox、tools 和审批面是否满足 manifest | High | v1 必须 | **缺失**：probe 结果进入 install plan 与证据，不使用“OpenClaw”单一字符串代替能力矩阵 |
| 所有权安全的 install receipt | install 需记录每个 managed path、原始/安装 hash、target identity、config patch marker 和外部依赖 | High | v1 必须 | **缺失**：未知或用户修改资产必须保留并阻塞覆盖 |
| inspect / doctor / upgrade / rollback / uninstall | Agent Package 是软件单元，必须能检查、修复、升级、回滚和卸载 | High | v1 必须 | **缺失**：每一步依据 manifest/receipt/digest；uninstall 只删除仍可证明归属的内容 |
| 配置 patch merge 与冲突报告 | 不能用完整配置覆盖用户 `openclaw.json`；需最小 patch、预览、冲突和回滚信息 | High | v1 必须 | **部分已有**：当前生成 config patch，但缺真实安装 merge/ownership 生命周期 |
| skill eligibility 与可见性验证 | skill 的位置优先级、agent allowlist、bin/env/config gating 和 session snapshot 都影响是否真正可用 | Med | v1 必须 | **缺失**：package doctor 必须验证 effective skill，不只检查 `SKILL.md` 存在 |
| sandbox、tool policy、exec/elevated 分层权限 | workspace 不是 sandbox；skill allowlist 也不是主机授权；package 必须声明并验证各控制面 | High | v1 必须 | **缺失**：敏感能力默认最小权限，`deny`/不支持时失败关闭 |
| 逐动作审批契约 | 发布、外部写入等副作用既需 discovery-time tool exposure，也需 runtime per-call approval | High | v1 必须 | **缺失**：无审批路由、超时、取消或版本不匹配一律拒绝 |
| hooks 的正确分层 | operator lifecycle side effect 用 internal hook；prompt/tool policy 用 typed plugin hook | High | v1 按需 | **缺失**：每个 hook 声明 owner、event、priority、幂等键、权限和失败语义 |
| memory policy | package 要规定 durable/working memory、来源、保留、隐私、审批/过期边界和提案式学习 | High | v1 必须 | **缺失**：memory 可保存审批上下文但不能替代硬 policy；不得自动改写 package |
| capability lock 与 runtime inventory | tools、skills、agents、hooks、模型/runtime 映射变化应被 digest 检测，避免“安装成功但能力漂移” | Med | v1 必须 | **缺失**：借鉴 OMX capabilities lockfile；外部 schema 不可得时明确 warning/fail policy |
| read-only doctor 与 isolated live smoke | doctor 证明配置/依赖；live smoke 证明一次真实执行，两者不可混用 | High | v1 必须 | **部分已有**：已有 OpenClaw live helper；缺 package install 后的统一 doctor/smoke gate |
| 多层 eval | 机制 conformance、真实 runtime、bounded domain case、生产批准必须独立记录 | High | v1 必须 | **基础已有**：需把 package/adapter 行为 eval 和写作领域 eval 纳入同一证据模型 |
| 失败关闭的 Birth Report / Delivery Report | 报告只能重新验证来源工件并聚合结论，不能自我认证或提升证据等级 | Med | v1 必须 | **已有基础**：必须在新 package schema 和 install 生命周期中保持 |
| bounded evidence ledger | 保存 hashes、状态、命令身份、版本、摘要和风险；不保存凭据、原始 transcript/tool bodies | Med | v1 必须 | **已有基础**：扩展到 builder install、package receipt、approval 和 publishing evidence |

### Acceptance Packages

| Feature | Why Expected | Complexity | v1/v2 | Status & Notes |
|---|---|---:|---|---|
| `support-triage` conformance fixture | 提供稳定、离线、确定性的回归基线，验证三阶段、package、install、upgrade、证据和负向安全 gate | Med | v1 必须 | **已有领域 fixture/live smoke 基础**；需迁移为正式 Agent Package fixture，不扩大领域认证声明 |
| 中文 AI 内容写作 Agent Package | 证明 AgentMo 不只适用于预制客服 fixture，而能构建需要实时研究、人类编辑决策与外部副作用控制的真实 agent | High | v1 必须 | **未实现**：v1 第二个验收包 |
| 每日趋势扫描与候选选题池 | 面向中文 AI 开发者提供论文、产品、趋势和热点观点候选，并说明价值、新鲜度、证据与风险 | High | v1 必须 | 只生成候选池，不自动选题；扫描来源遵循 Discover 审批和第一手来源优先 |
| 人工选题 gate | 主题、角度和受众价值由人决定，避免 agent 被社交热度或单一来源自动驱动 | Med | v1 必须 | 选题批准绑定候选版本；改变主题或核心角度后重新确认 |
| 第一手来源研究与主张账本 | 事实性主张优先论文、作者材料、官方文档/release；媒体与社交材料只作为观点和热议语境 | High | v1 必须 | 每个主张标为 `fact`、`inference` 或 `controversy`，并保留 citation/source refs |
| 对比、大纲、草稿与编辑检查 | 从来源形成观点比较、结构、大纲和中文草稿，并检查引用、事实、时效、语言和受众适配 | High | v1 必须 | 必须暴露证据缺口；不能用“事实检查通过”替代读者/编辑判断 |
| 编辑 memory | 保存经批准的风格偏好、栏目规则、纠错和决策，但不保存 raw private transcript 或把一次批准泛化为长期授权 | Med | v1 必须 | 记忆带 owner、来源、适用范围和过期/撤销条件 |
| 确切工件版本的发布审批 | 只允许发布用户看过并批准的 exact draft hash；草稿变更、审批过期、路由缺失、超时或取消时拒绝 | High | v1 必须 | 平台/API 尚未选择；v1 先定义中立 publish tool contract 与 test double，再接真实平台 |
| 发布回执与可撤销边界 | 外部动作需要目标、时间、工件 hash、审批 ref、结果和失败摘要；撤稿/更新能力依平台显式声明 | High | v1 核心；v2 扩平台 | 不宣称平台支持，直到真实 adapter、sandbox 和审批证据存在 |

## Differentiators

这些能力不是普通 prompt/skill 仓库的默认预期，但它们构成 AgentMo 的产品辨识度。

| Feature | Value Proposition | Complexity | v1/v2 | Notes |
|---|---|---:|---|---|
| `Discover -> Plan -> Produce` 编译链 | 把数据、人的决定和软件产物分离成可检查契约，避免“一次对话生成一个 prompt” | High | v1 核心 | 三阶段严格固定，Produce 内再使用多个 gate |
| Builder plane + Package plane 双平面 | 同一方法论既能安装到 coding 工具，也能稳定生成不同领域 Agent Package | High | v1 核心 | Codex/OpenClaw 完整实现后再扩其他 adapter/target |
| 人类权威链 | source manifest、Plan、选题和 exact publish artifact 分别审批，授权不跨边界继承 | High | v1 核心 | 让“人参与”成为版本化证据，而非聊天中的模糊同意 |
| 非传递证据等级 | `declared-ready`、`live-success`、bounded domain eval、delivery aggregation、production approval 彼此不自动升级 | Med | v1 核心 | 当前代码已有雏形，是必须保留的核心差异 |
| 能力驱动的最小 package 形态 | 根据所需能力选择 workspace、skill、bundle、MCP、config patch 或 native plugin，减少信任面 | High | v1 | 与 OpenClaw 原生边界一致，不制造万能插件 |
| 可证明所有权的可逆安装 | receipt + marker + digest 让 upgrade/rollback/uninstall 只触碰 AgentMo 资产 | High | v1 | 比“重新生成并覆盖目录”更适合真实用户环境 |
| 干净会话可复现 Birth | 从干净 Codex 到隔离 OpenClaw 完成 package 构建和证据闭环，是可重复的验收故事 | High | v1 | 两个参考包都必须通过；结果仍受证据范围限制 |
| 机制 fixture + 真实领域 package 双验收 | `support-triage` 快速定位协议回归，中文写作 agent 暴露研究、编辑和审批的真实复杂度 | High | v1 | 两者缺一都会造成错误信心 |
| 提案式运行学习 | observe/memory 发现改进后只生成 proposal，经人审阅才改变 blueprint/package | Med | v1 | 避免运行时“自我进化”破坏已批准证据基础 |
| 行为、结构与运行时三层测试 | 文件/manifest tests、Codex 方法论行为 eval、OpenClaw isolated runtime/domain eval 各自回答不同问题 | High | v1 | 借鉴 Superpowers 的 behavior eval 与 OMX/GSD 的 contract checks |

## Anti-Features

以下能力应明确不构建，或至少不进入 v1；它们会破坏范围、授权或证据语义。

| Anti-Feature | Why Avoid | What to Do Instead | Complexity | v1/v2 |
|---|---|---|---:|---|
| 第四个顶层 “Birth/Verify” 阶段 | 稀释三阶段职责并让产物与验证分裂 | 将 install、doctor、smoke、eval、Birth/Delivery 都放入 Produce gate | Low | 永不 |
| 新输出继续使用 `AgentMother` / `agentmother_*` | 造成双重身份和 schema 漂移 | 只提供显式 legacy reader/migrator，新写入统一 `AgentMo` / `agentmo_*` | Med | v1 禁止 |
| Prompt-only Agent Package | 无版本、依赖、权限、安装和证据边界 | 交付 manifest + workspace/skills/tools/hooks/memory/evals/receipts | Med | v1 禁止 |
| v1 同时完整支持所有 coding 工具 | 每个工具的 hooks/state/sandbox/安装语义不同，会产生虚假兼容声明 | Codex production-grade；只定义中立 adapter contract | High | v2 候选 |
| v1 完整支持 Pi 或多个 target runtime | 会稀释 OpenClaw 端到端证明 | v1 只完整支持 OpenClaw，Pi 保留历史/未来上下文 | High | v2 候选 |
| 无边界通用 crawler 或大数据平台 | 当前 CLI、内存模型和安全策略并非爬虫/数据湖 | v1 使用有界 discovery adapters；后续独立 ingestion/index contract | High | v2 |
| 自动批准来源 | 未审阅来源可能包含错误、操纵或 prompt injection | AgentMo 提议 manifest，人类批准 exact version 后才进入 Plan | Med | 永不默认 |
| 自动选题 | 热度不等于受众价值，且观点角度属于编辑判断 | 生成候选池，由人选择主题和角度 | Low | 永不默认 |
| 自动发布或“批准一次长期发布” | 外部副作用、草稿漂移和权限扩张风险高 | 每次只批准 exact artifact hash；无路由/超时/变化均 deny | High | 永不默认 |
| 观察结果自动修改 agent | 破坏已批准 package 与证据可重放性 | observe 只产 proposal，走 Plan/Produce review 后应用 | Med | 永不 |
| 把凭据、auth profile、session 或 raw transcript 打包 | 泄密、不可移植且违反 OpenClaw 状态边界 | manifest 只声明 SecretRef/外部要求；证据保存摘要和 hash | Med | 永不 |
| 把 workspace 当作 sandbox | OpenClaw workspace 只是默认 cwd，绝对路径仍可越界 | 独立声明并验证 sandbox、tool policy、exec/elevated 和 OS 边界 | High | 永不 |
| 把 skill allowlist 当作主机授权 | skill 可见性不限制 `exec` 或其他 tool side effects | skill exposure + tool policy + sandbox + per-action approval 分层控制 | High | 永不 |
| 每个 agent 都生成 native plugin | native plugin 与 Gateway 同进程，信任成本过高 | 优先 workspace/skill/bundle；只有 typed hook/in-process tool 必要时生成 plugin | High | 永不默认 |
| doctor 自动修复或覆盖用户配置 | doctor 诊断与修复混用会产生意外变更 | 默认 read-only lint/probe；repair 显式授权并提供 diff/rollback | Med | v1 禁止默认 |
| 根据报告自我认证质量 | scaffold、doctor、smoke 或报告都不能证明全领域/生产质量 | 报告只重验和聚合来源证据，明确剩余风险和审批 owner | Med | 永不 |
| 覆盖/删除未知或用户修改资产 | 会破坏用户工作区和信任 | ownership receipt + digest；冲突时 preserve + block + 请求决定 | High | 永不 |
| 在未选平台前硬编码公众号 API | 当前发布提供方、认证和测试环境尚未决定 | v1 定义中立 publish contract/test double；平台 adapter 单独验收 | Med | v1 禁止；v2 扩展 |
| 企业级多租户控制平面 | 不服务 v1 的个人开发者目标，会显著扩张治理与运维 | 保持本地、文件化、可审计；待真实需求后再设计 | High | v2+ |

## Feature Dependencies

### Core dependency graph

```text
AgentMo identity + schema/migration
  -> artifact contracts + stage invariants
  -> Codex adapter install/state/event envelope
  -> guided Discover -> approved manifest -> discovery database
  -> guided Plan -> approved Package build contract
  -> deterministic Produce -> Agent Package manifest/archive
  -> OpenClaw probe + target mapping
  -> ownership-safe install receipt
  -> read-only doctor
  -> isolated live smoke
  -> mechanism/domain evals
  -> fail-closed Birth Report + Delivery Report
```

```text
OpenClaw capability/version probe
  -> choose workspace/skill/bundle/MCP/native-plugin shape
  -> skill eligibility + tool/sandbox policy mapping
  -> per-action approval support
  -> safe publishing capability
```

```text
Discover provenance + Plan decision ledger
  -> memory policy (source/owner/expiry/action boundary)
  -> observation proposal
  -> reviewed Plan change
  -> new Package version
```

```text
中文 AI 内容写作：
approved sources
  -> daily scan
  -> candidate pool
  -> human topic selection
  -> claim/evidence ledger
  -> outline + draft
  -> citation/fact/editorial checks
  -> exact artifact review
  -> per-call publish approval
  -> publish receipt
```

### Dependency table

| Dependency | Enables | Complexity | v1/v2 | Roadmap implication |
|---|---|---:|---|---|
| 规范名称与 schema migration | 所有新工件、manifest、adapter 和证据 | Med | v1 first | 最先完成，否则后续继续产生 legacy 债务 |
| Package manifest | materialize、install、ownership、upgrade、evidence | High | v1 first | Produce 生命周期的中心契约 |
| Codex adapter + packed install | 用户真正使用三阶段 builder | High | v1 | 与核心 schema 可并行，但必须先于端到端验收 |
| source record + approval artifact | Plan 合法入口、写作主张追踪 | High | v1 | 先扩 Discover，再构建写作 agent |
| approved Package build contract | OpenClaw target 生成和 drift guard | High | v1 | Plan 完成定义，不允许 Produce 自行补关键授权 |
| OpenClaw probe/capability map | package 形态、权限、doctor 和支持声明 | High | v1 | target materialize/install 前置 |
| ownership receipt + digest | upgrade、rollback、uninstall | High | v1 | 不应把卸载留到最后补做 |
| permission mapping + approval route | 发布和其他敏感 tools | High | v1 | 写作 publish tool 的硬前置条件 |
| `support-triage` fixture package | schema、install、upgrade、evidence 的快速回归 | Med | v1 early | 每个基础阶段都先用它锁定确定性 |
| 中文写作 package | 实时 Discover、人工 gates、memory、发布契约的真实验收 | High | v1 late | 在基础 package 生命周期稳定后接入 |
| behavior eval harness | 证明 Codex 会遵守方法论和人工 gate | High | v1 | 与 package runtime eval 分开建设 |

## MVP Recommendation

Prioritize:

1. **统一身份与核心契约**：完成 AgentMo-only 新输出、legacy migration、三阶段 invariant 和 Package manifest。
2. **Codex builder 可安装化**：plugin/skills/hooks/state、能力探测、setup/doctor/upgrade/uninstall、packed-install smoke 和行为 eval。
3. **Discover 扩展**：Web/GitHub/论文/本地 adapter、统一来源记录、去重/新鲜度、source manifest exact-version 人工审批。
4. **Plan 对话与批准**：决策账本、需求—证据追踪、target feasibility、Package build contract 和 drift guard。
5. **OpenClaw Package 生命周期**：最小信任形态选择、materialize、probe、ownership-safe install、doctor、upgrade/rollback/uninstall。
6. **证据闭环**：read-only doctor、isolated live smoke、capability lock、行为/机制/domain eval、Birth/Delivery 非传递证据语义。
7. **先迁移 `support-triage`**：让它覆盖 package archive、clean install、upgrade/rollback/uninstall 和负向安全路径。
8. **再构建中文 AI 内容写作智能体**：以 source/Plan/选题/发布四个人工 gate 验证真实端到端能力。

Defer:

- **Pi target 与其他 coding-tool 完整 adapters**：等 Codex/OpenClaw 纵向闭环有证据后再扩展。
- **具体公众号发布平台 adapter**：提供方、API、认证与 sandbox 未决定；v1 先完成中立契约和 test double。
- **大规模 crawler、流式/向量化 discovery database**：先用有界数据取得真实容量指标。
- **企业多用户治理与集中控制平面**：不属于个人开发者 v1。
- **自动技能/记忆/blueprint 自修改**：保持 proposal-only，除非未来另立安全与审批里程碑。

## Sources

### AgentMo current repository

- `.planning/PROJECT.md` — 已确认的产品范围、三阶段、双平面、两类验收包与人工审批边界。
- `.planning/codebase/ARCHITECTURE.md` — 当前 artifact-first 三阶段、target adapter 与 evidence gate。
- `.planning/codebase/CONCERNS.md` — live discovery、OpenClaw drift、domain-quality 与 ownership 风险。
- `.planning/codebase/TESTING.md` — `node:test` contract/CLI/runtime/vertical-slice 测试边界。
- `docs/MVP_RUNBOOK.md`、`docs/AGENT_BIRTH_GATE.md` — 当前三阶段和 `declared` / `live-success` / bounded domain evidence 语义。
- `src/targets/openclaw.js`、`src/scaffold-files.js`、`src/delivery-report.js` — 当前 OpenClaw scaffold 与非自认证交付聚合实现。
- `examples/support-triage.need.json`、`examples/support-triage.domain-cases.json`、`examples/support-triage.agentmo.json` — 确定性参考 fixture。

### Fixed upstream primary-source mirrors

- [GSD Core @ `b9c8ea143bc0`](https://github.com/open-gsd/gsd-core/commit/b9c8ea143bc0) — `README.md`、`docs/FEATURES.md`、capability trust/install lifecycle、runtime adapter/host integration SDK、installer migrations。用于支持持久工件、fresh-context、能力协商、安装所有权和迁移特性。
- [Oh My Codex @ `5d43a5bf6f00`](https://github.com/Yeachan-Heo/oh-my-codex/commit/5d43a5bf6f00) — `src/capabilities/lockfile.ts`、`src/cli/doctor.ts`、`src/cli/setup.ts`、`src/cli/uninstall.ts`、plugin bundle SSOT tests、hook extensibility。用于支持 capability lock、doctor 与 smoke 分离、canonical source/mirror、状态和 hook 契约。
- [Superpowers @ `d884ae0`](https://github.com/obra/superpowers/commit/d884ae0) — `README.md`、`docs/porting-to-a-new-harness.md`、`docs/testing.md`、Codex package scripts/tests。用于支持方法论核心 + thin harness adapter、行为 eval、可重复 Codex packaging 与 hook 边界。
- [OpenClaw @ `29d018f0af5e`](https://github.com/openclaw/openclaw/commit/29d018f0af5e) — `docs/concepts/agent-workspace.md`、`docs/tools/skills.md`、`docs/plugins/bundles.md`、`docs/plugins/architecture.md`、`docs/automation/hooks.md`、`docs/concepts/memory.md`、`docs/gateway/doctor.md`、`docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`、`docs/plugins/plugin-permission-requests.md`。用于支持 package 形态、运行时信任、权限、memory 和 doctor 边界。

---
*Feature research: 2026-07-11; roadmap input, not a release or certification claim.*
