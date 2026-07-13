# AgentMo

## What This Is

AgentMo 是一套面向个人开发者与 AI 工程师的方法论、协议和工具链，用于借助 coding agent 将可复现的领域智能体构建为软件产物。它运行一条由 Discover、Plan、Produce 组成的三阶段生命周期，主要产物分别是可追溯的发现数据库、经人工确认的智能体规划，以及可安装、可评估、可发布的版本化 Agent Package；单独的提示词或系统自行生成的报告不能作为质量证明。

v1 首个完整支持的构建端是 Codex，首个完整支持的目标运行时是 OpenClaw。AgentMo 保持对运行时边界的明确感知：它为未来的 coding 工具定义中立适配器契约，同时尊重 OpenClaw 真实的 workspace、配置、bundle、plugin、memory、权限与证据边界。

## Core Value

开发者能够反复把经过批准的数据与人工决策转化为可安装、可验证的 Agent Package，并清楚知道其来源、能力、运行时行为和剩余风险。

## Current State

Phase 1.1（工件准入与秘密边界）已于 2026-07-13 验证完成：当前阶段工件通过 exact raw-byte digest、闭合 subject/identity registry 与 source-authentic companion admissions 在 fresh process 间交接；所有当前 durable read/write/output surface 受共同 persistability 与 value-blind 失败边界约束。下一阶段是 Phase 1.2（OpenClaw 运行时与发布证据）。

## Business Context

- **目标用户**：使用 Codex 构建 OpenClaw 领域智能体的个人开发者与 AI 工程师。
- **商业模式**：尚未决定；v1 优先证明机制开放、可复现，并获得真实使用证据。
- **成功指标**：一个干净的 Codex 环境能够使用 AgentMo，在隔离的 OpenClaw 环境中构建、安装并验证 `support-triage` 一致性样例和一个真实的中文 AI 内容写作智能体。
- **协作说明**：根据 `CONTRIBUTING.md`，Alex 负责产品方向与最终合并/发布决定；Echo 负责实现、测试、PR 和技术反馈；Codex 协助规划、审查、文档与发布工作。

## Requirements

### Validated

- ✓ 一个低依赖的 Node.js CLI 已通过显式阶段契约实现由工件驱动的 Discover、Plan、Produce 流程 — 已存在。
- ✓ Discover 能接收有边界的清单和已批准的本地来源，生成通过校验的发现数据库及来源证据，并拒绝不安全路径和疑似密钥的材料 — 已存在。
- ✓ Plan 能把有效的发现数据库与经过校验的用户需求工件结合，生成可审计的设计方案和 blueprint 契约 — 已存在。
- ✓ Produce 能独立接收有效 blueprint，而不依赖命令调用历史，并生成确定性的交接、scaffold、构建状态、运行计划和运行证据工件 — 已存在。
- ✓ OpenClaw target 已能生成 workspace 提示词文件、领域 skill、配置补丁、runtime contract 与 evidence-first runbook — 已存在。
- ✓ 运行与交付证据已区分声明式接线、隔离的真实执行、有边界的领域案例、交付聚合和生产批准 — 已存在。
- ✓ Birth Report 默认失败关闭且不能自我认证；Delivery Report 会重新校验输入，而不是信任上游成功标记 — 已存在。
- ✓ 运行观察仅能形成变更提案，不能自动修改 blueprint、scaffold、runtime 或 eval — 已存在。
- ✓ 仓库已有广泛的确定性契约测试和负向测试，覆盖当前三阶段闭环及 OpenClaw 纵向切片 — 已存在。
- ✓ AgentMo 已成为新生成的公开界面、schema、CLI 输出、维护文档、active examples 和生成包中的唯一规范产品身份；旧名称仅存在于明确 legacy context — Phase 1 验证完成。
- ✓ 三类已知 legacy 机器工件已具备闭合 schema registry、ordinary-loader migration-required gate、默认只读 preview 和显式、失败关闭的专用目录 apply；源文件保持不变，raw/credential-shaped material 整批拒绝 — Phase 1 验证完成。
- ✓ Agent Package 顶层生命周期严格只有 Discover、Plan、Produce；安装、eval、live smoke、Birth/Delivery 与发布证据仅作为 Produce 内部 gate 或 maturity — Phase 1 验证完成。
- ✓ 当前 Discover、Plan、blueprint、handoff、build/runtime state、observation 与 report/evidence 工件可凭 exact bytes、subject digest 和必要的 authentic companion set 在 fresh process 中独立准入；不存在同会话 ancestry 依赖 — Phase 1.1 验证完成。
- ✓ 当前持久化与输出边界只接受闭合 SecretRef/SecretPresence/RedactedSummary 或安全 portable refs；host path、secret、raw transcript/tool body/stdout/stderr 在首次副作用前 value-blind 失败，I/O inventory 为 183/183 且无 pending/unclassified surface — Phase 1.1 验证完成。

### Active

- [ ] 把方法论产品化为可安装的构建端能力，包含规范的工作流规则、skills、hooks、prompts、state、恢复机制和行为评估，而不是只依赖提示词文本。
- [ ] 基于 Codex 原生 plugin、skill、hook、agent 与安装机制，交付生产级 Codex adapter，并提供 setup、doctor、upgrade、uninstall 与打包安装验证。
- [ ] 定义版本化、coding-tool-neutral 的 adapter contract，覆盖能力映射、生命周期事件、上下文注入、压缩恢复、去重、不支持的能力面和证据等级，但不宣称其他工具已获得完整支持。
- [ ] 扩展 Discover，使其可通过 Codex 可用的 Web、GitHub、论文和本地文档能力进行引导式实时研究；记录来源身份、检索时间、摘要、置信度、来源链和内容摘要，并要求人工批准 source manifest 后才能进入 Plan。
- [ ] 让 Plan 成为基于已批准发现数据库的人机持续对话，产出明确的需求、决策、约束、验收标准、blueprint、能力要求和经批准的 Package build contract。
- [ ] 将 Produce 的主要产物定义为版本化 Agent Package，其中包含规范的 package manifest、源码摘要、prompts、skills、tools、hooks、memory policy、evals、target mappings、权限、安装回执、证据引用、认证边界和剩余风险。
- [ ] 分离可移植 workspace 内容、兼容的 content bundle、OpenClaw 配置补丁、可选 native plugin 与外部凭据/session state，使每个包只请求其声明能力真正需要的信任面。
- [ ] 端到端实现 OpenClaw target 生命周期：probe、materialize、inspect、install、doctor、隔离 live smoke、evaluate、report、upgrade、rollback、uninstall，并且不覆盖或删除不属于 AgentMo 的用户资产。
- [ ] 对生成的 tools、hooks、plugins 和发布动作要求明确的能力归属、兼容版本、hash、权限 gate 与失败关闭行为。
- [ ] 保留 `support-triage` 作为确定性一致性样例，用于 package 生成、安装、升级、证据和回归测试。
- [ ] 构建一个面向中文 AI 开发者的真实 OpenClaw AI 内容写作 Agent Package，覆盖每日趋势扫描、候选选题生成、人工选题、第一手来源研究、论文与观点对比、起草、引用与事实检查、编辑记忆、审批和经批准的发布。
- [ ] 强制执行第一手来源优先的编辑证据规则：事实性主张由论文、作者材料、官方文档和发布记录支撑；媒体与社交讨论用于提供观点语境；事实、推断和争议必须保持清晰区分。
- [ ] 真实发布必须经过批准：智能体只有在用户明确批准某一确切版本后，才能为该版本准备并调用发布工具；缺少发布路由、超时、草稿发生变化或批准过期时，动作必须被拒绝。
- [ ] 从干净的 Codex 会话出发，在隔离的 OpenClaw 安装中为两个参考包取得 doctor 证据、live-success 证据、有边界的领域 eval、失败关闭的 Birth Report 和交付账本，以此证明 v1。

### Out of Scope

- v1 不提供完整 Pi target 支持 — OpenClaw 是唯一获得端到端实现和支持声明的目标运行时。
- v1 不完整支持 Claude Code、OpenCode、Cursor 或其他 coding 工具 — 只有 Codex 达到生产级；其他工具仅获得供后续实现的中立 adapter contract。
- 不包含企业级多用户治理、集中式控制平面和组织级审批路由 — v1 服务个人开发者和 AI 工程师。
- 不自动批准 Discover 找到的来源 — 实时发现可以提出 source manifest，但人工批准后才能进入 Plan。
- 不允许完全自主的选题和发布 — 主题由人选择，最终可发布工件的确切版本必须由人明确批准。
- Agent Package 或常规证据中不包含凭据、OAuth 材料、原始私密记录、OpenClaw auth profile 或 session state — 这些属于外部、受约束的运行时状态。
- 不把 workspace 邻近性当作 sandbox，也不把 skill allowlist 当作主机授权 — OpenClaw sandbox、tool policy、权限和进程信任是彼此独立的控制面。
- 不根据 scaffold、doctor、live smoke、fixture eval、Birth Report 或 Delivery Report 单独作出全领域或生产质量认证 — 所有声明都必须受实际收集证据的边界约束。
- 不建立平行的 legacy/vNext 实现，也不进行彻底重写 — v1 在现有 contract-first 代码库中原地演进。
- 不根据观察结果自动修改 blueprint、package、skill 或 runtime 配置 — 观察和学习到的变化在审核并应用之前都只是提案。

## Context

AgentMo 已拥有一个可工作的 contract-first CLI 和一个以证据为中心的 OpenClaw 纵向切片。其架构已经分离工件校验器、三个阶段、target adapter、受管写入操作、运行时执行和闭环报告。因此，当前代码是继续演进的基础，而不是应当丢弃的原型。

项目包含两个相互关联的产品平面：

1. **Builder plane（构建平面）** — 安装到 coding 工具中的 AgentMo 方法论与协议。它规定构建端如何发现数据、与人沟通、规划目标智能体、生成 package 并收集证据。
2. **Package plane（包平面）** — 生成的领域 Agent Package。它包含目标智能体的提示词工程、skills、tools、hooks、memory policy、evals、配置及 plugin 材料、来源信息和发布证据。

规范生命周期严格只有三个阶段：

1. **Discover** 查找、收集、筛选并结构化数据，形成可追溯的发现数据库。
2. **Plan** 基于该数据库与人持续沟通，确定需求、边界、架构、能力、验收标准和 Package build contract。
3. **Produce** 生成 Agent Package，并完成其 install、doctor、live smoke、eval、Birth Report 与交付证据 gate。

对参考项目的审阅确定了以下设计方向：

- GSD Core 展示了持久文件工件、轻量编排、fresh-context worker、能力清单、runtime transform 和基于所有权的安装迁移。
- Oh My Codex 展示了代码级工作流权威、规范源与生成镜像、标准化 hook envelope、状态协调、能力 lockfile，以及 doctor 证据与认证执行之间的区别。
- Superpowers 展示了单一方法论源、轻量 harness adapter、自动激活契约、原生打包和 skill 行为测试。
- OpenClaw 确立了目标运行时的真实边界：一个 agent 横跨 workspace 提示词文件和 skills、agent-scoped 配置与状态、可选 bundle 或 native plugin、memory、tool 与 sandbox policy、生命周期 hooks、channel bindings 和明确的 runtime ownership。

AgentMo 应借鉴这些架构原则，但不能把它们累积的大量命令目录、tmux/team 机制、激进激活规则、自动提交假设或运行时专属内部实现复制进核心协议。

真实验收智能体是一个面向中文 AI 开发者的 AI 内容写作智能体。默认每日流程为：扫描趋势；生成带价值与风险说明的候选池；等待人工选题；研究经批准的来源；比较主张和观点；提出大纲；生成草稿；执行引用、事实和编辑检查；请求审核；最后只发布经过批准的确切版本。

具体发布平台和 API 尚未选择。规划必须显式定义发布工具契约及其测试环境，不能默认某个公众号提供方或生产凭据路径。

## Constraints

- **架构**：保持仅通过工件连接阶段的边界 — 下游阶段依赖经过校验的工件，而不依赖某个上游命令是否刚刚执行。
- **生命周期**：顶层严格只有三个阶段 — Birth Gate 和交付闭环属于 Produce。
- **迁移**：原地演进，并通过显式兼容路径继续读取旧工件；不得让旧标识符扩散到新输出中。
- **目标支持**：v1 只有 Codex 是完整支持的构建端，只有 OpenClaw 是完整支持的 target — 更广泛的支持声明必须具备相应 adapter 与运行时证据。
- **OpenClaw 信任边界**：能力足够时优先输出 workspace/content bundle；只有需要进程内 tools 或 typed hooks 的能力才生成 native plugin，因为 native plugin 与 Gateway 共享进程信任边界。
- **安全**：绝不读取、持久化、输出或打包密钥值；凭据、auth profile、生产状态和原始记录必须留在常规工件与证据之外。
- **权限**：敏感 tools 既需要发现时的暴露策略，也应按需具备逐动作审批；无法执行审批时必须失败关闭。
- **证据**：`declared-ready`、`live-success`、有边界的 domain eval、delivery aggregation 与 production approval 彼此独立，不能自动传递结论。
- **所有权**：install、update、rollback、uninstall 只能修改由 manifest、marker 和 digest 证明属于 AgentMo 的资产；用户修改过或归属未知的资产必须保留。
- **来源完整性**：Discover 记录来源链和置信度；人工批准 source manifest 之前不能进入 Plan。
- **编辑完整性**：事实性主张在可用时应使用可追溯的第一手来源；无法验证的主张、推断和争议观点必须明确标注，不能被归一化为事实。
- **兼容性**：除非经审核的能力确实需要新的运行时依赖，否则保留现有 Node.js 20+ CLI 和确定性校验姿态。
- **协作**：Alex 负责产品方向与最终合并/发布决定；Echo 负责实现、测试、PR 和技术反馈；Codex 协助规划、审查、文档与发布工作。
- **验证**：代码变更运行 `npm run check` 与 `git diff --check`；涉及架构、package、stage 或 evidence 的变更还必须更新相关文档和 `release/YYYY.MM.DD.md`。

## Key Decisions

| 决策 | 原因 | 结果 |
|------|------|------|
| 只使用 AgentMo 作为产品与机制名称 | 一个规范身份可以避免构建端和其输出之间产生混淆 | ✓ Phase 1 已验证 |
| 只保留 Discover、Plan、Produce 三个顶层阶段 | 数据、人工规划和 package 生成是三个持久的职责边界 | ✓ Phase 1 已验证 |
| 将安装、eval、live smoke、Birth Report 和交付闭环置于 Produce 内部 | 它们用于证明和包装生成的工件，不是独立生命周期阶段 | ✓ Phase 1 已验证 |
| 在现有仓库中原地演进 | 现有契约、安全边界、测试和 OpenClaw 证据是有价值的基础 | — 待验证 |
| 首先完整支持 Codex | 一个生产级构建端 adapter 能形成可证伪的 v1，同时让核心保持可移植 | — 待验证 |
| 首先完整支持 OpenClaw | 聚焦输出平面可以完成一个真实、完整的 Agent Package 生命周期 | — 待验证 |
| 为其他 coding 工具定义中立 adapter，但不宣称已经支持 | 可移植性属于协议；支持声明则必须来自实现和证据 | — 待验证 |
| 默认使用带显式来源、规划和动作 gate 的引导式工作流 | 在不妨碍高级用户按阶段使用的前提下，让人工决策保持权威 | — 待验证 |
| 允许实时研究，但要求批准 source manifest | 当前信息是必要的，但未经审阅的来源不能静默塑造目标智能体 | — 待验证 |
| 将 Agent Package 作为 Produce 的主要工件 | 产品必须交付可复现的软件单元，而不仅是 blueprint 或 prompt | — 待验证 |
| 根据声明能力选择 package 形态 | workspace 内容、bundle、MCP、配置与 native plugin 具有不同的信任和生命周期成本 | — 待验证 |
| 使用两个 v1 参考包 | `support-triage` 证明确定性一致性；写作智能体证明方法可复用于不同的真实领域 | — 待验证 |
| 发布前要求人工选题并批准确切工件 | 编辑自主权和外部副作用必须处于人的控制之下 | — 待验证 |
| 编辑证据以第一手来源为优先 | 目标受众需要及时分析，也需要可靠的事实来源链 | — 待验证 |
| 运行观察只形成提案 | 运行时学习不能静默重写活跃智能体或其证据基础 | — 待验证 |
| Durable handoff 以 exact raw bytes 与 source-authentic companions 为权威 | 单独的 schema-valid JSON 或自写成功报告不能证明来源关系与派生结果 | ✓ Phase 1.1 已验证 |
| 当前 durable writer 与输出必须先通过共同 persistability gate | 统一 fail-closed boundary 才能防止 secret、host path 与 raw runtime material 经新 sink 漏出 | ✓ Phase 1.1 已验证 |

## Evolution

本文档在阶段切换和里程碑边界持续演进。

**每次阶段切换后**：
1. 需求失效了吗？→ 移入 Out of Scope 并写明原因。
2. 需求已验证了吗？→ 移入 Validated 并标注对应阶段。
3. 出现了新需求吗？→ 加入 Active。
4. 有需要记录的决策吗？→ 加入 Key Decisions。
5. What This Is 是否仍然准确？→ 如果已经漂移则更新。

**每个里程碑完成后**（通过 `$gsd-complete-milestone`）：
1. 全面审阅所有章节。
2. 检查 Core Value 是否仍是正确优先级。
3. 检查 Business Context 中的目标用户、成功指标和交付策略是否仍然准确。
4. 审核 Out of Scope 及其理由是否仍然成立。
5. 使用当前证据、反馈与已知风险更新 Context。

---
*Last updated: 2026-07-13，Phase 1.1 验证完成*
