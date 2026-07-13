# Domain Pitfalls

**Project:** AgentMo
**Domain:** coding 工具中的 AgentMo builder 方法论 + OpenClaw Agent Package 工具链
**Researched:** 2026-07-11
**Overall confidence:** HIGH（上游 Codex/OpenClaw 的当前接口细节为 MEDIUM）

本文件只提炼现有 AgentMo 项目材料与已完成的一手研究；它不新增外部扫描或更宽的支持声明。以下问题之所以列为 Critical，是因为每一项都要求 roadmap 中存在明确的 phase ordering、admission gate 或 release gate。

## Critical Pitfalls

### Pitfall 1: 名称漂移把兼容迁移变成双重产品身份
**What goes wrong:** `AgentMother`、`agentmother_*` 与 `AgentMo`、`agentmo_*` 同时出现在新 schema、CLI 输出、package、receipt 和 evidence 中，调用方无法判断哪个是规范身份。
**Why it happens:** 为了“保持兼容”而让旧字段直接穿透新写入路径，或在 renderer、fixture、文档中分别手工改名，却没有单一 canonical emitter。
**Consequences:** digest、审批引用和 adapter 映射分裂；后续每个 phase 都要维护两套语义，迁移永远无法结束。
**Prevention:** 只在显式 legacy reader/migrator 接受 `agentmother_*`，立即归一化到版本化内部契约；所有新写入只允许 `agentmo_*`，并记录 migration provenance 与 approval invalidation。
**Detection:** 用 legacy golden fixtures 验证“旧输入可读、新输出无旧标识符、迁移幂等”；对所有 canonical emitters 增加 forbidden-token contract test。
**Roadmap gate:** Identity & invariant foundation 未通过兼容读取、canonical output 和 migration round-trip 前，不开始 Package manifest 与 adapter 投影。

### Pitfall 2: 三阶段边界漂移或重新依赖命令祖先
**What goes wrong:** install、doctor、eval、Birth Report、Delivery Report 或 Observe 被提升为第四阶段；或者 Plan/Produce 依赖“刚运行过上一条命令”的 sidecar 与内存状态。
**Why it happens:** CLI 流程图比 artifact contract 更直观，新功能容易按命令顺序接线；验证步骤数量多，也容易被误当成生命周期阶段。
**Consequences:** fresh-context 恢复失败，adapter 各自复制 lifecycle 逻辑，阶段无法独立重放，现有 Stage 2/3 contract 被侵蚀。
**Prevention:** 在代码与 schema 中锁定恰好 `Discover -> Plan -> Produce`；Plan 只接收已批准 discovery artifact，Produce 只接收已批准 Package build contract，所有安装与证据动作均为 Produce 内 gate。
**Detection:** `stage-contracts` 必须从独立进程和仅有输入工件的目录运行；任何新增顶层 stage label、上游命令 ancestry 检查或 Stage 3 discovery sidecar 读取均视为失败。
**Roadmap gate:** 每个后续 phase 都要通过 stage-invariant regression；新增命令不能改变顶层生命周期计数。

### Pitfall 3: 方法论退化为 prompts/skills 文件集合
**What goes wrong:** 安装包包含漂亮的 `SKILL.md` 和 prompts，但 Codex 在真实会话中不触发流程、不等待人工 gate、压缩后忘记状态，或重放 hook 造成重复副作用。
**Why it happens:** 文件存在性和 manifest lint 容易自动测试，方法论行为、恢复、non-trigger 和事件去重却需要 fresh-session eval。
**Consequences:** AgentMo 看似可安装，实际只是 prompt 模板仓库；`Discover -> Plan -> Produce` 无法作为可复现软件机制交付。
**Prevention:** 以 code-authoritative lifecycle kernel、durable checkpoint、normalized event envelope 和 dedupe key 承载方法论；skills 是入口与说明，不是唯一状态权威。
**Detection:** 分开运行 packed-install/parity tests 与干净 Codex 会话 behavior eval，覆盖 trigger、non-trigger、人工暂停、compaction recovery、resume 和 duplicate event。
**Roadmap gate:** Codex builder phase 必须同时取得结构安装证据与行为证据，单有 `doctor` 或文件清单不得进入 clean-room acceptance。

### Pitfall 4: Adapter capability 虚报与 fail-open 降级
**What goes wrong:** 中立 adapter contract 被宣传成多工具已支持，或仅凭 host 名称推断 hooks、sandbox、subagents、approval 等能力；未知 surface 被默认为可用。
**Why it happens:** 抽象接口“能描述能力”容易被误写成“已实现能力”，静态 manifest 也无法证明当前 host 版本会实际执行该 surface。
**Consequences:** Plan 批准了 target 无法满足的 build contract，敏感动作失去 gate，运行失败被错误归因于领域 agent。
**Prevention:** v1 只将 Codex builder 与 OpenClaw target 标为完整支持；probe exact version/features，区分 required/optional、supported/degraded/unsupported，未知或 removed surface 失败关闭。
**Detection:** support claim 必须能追到 capability matrix、probe digest、packed install、behavior smoke 与 tested baseline；缺任一证据时只能发布协议或 unsupported 状态。
**Roadmap gate:** 每个 adapter 实现单独获得 clean-room evidence 后才能升级支持声明；neutral contract phase 不授予 production-grade 标签。

### Pitfall 5: 安装所有权破坏用户资产
**What goes wrong:** setup/upgrade 用全量配置覆盖，rollback 恢复过期快照，uninstall 按路径猜测删除；read-only doctor 暗中执行 repair。
**Why it happens:** 生成期只看到期望目录，忽略共享 config、用户修改、并存插件以及 install 后的实际状态。
**Consequences:** 用户 hooks、skills、OpenClaw config 或手工修改丢失；升级不可逆，用户不再信任 AgentMo。
**Prevention:** 采用 `plan -> apply -> receipt`；记录 marker、字段级 ownership、before/after digest 与 package digest，用“上次安装/当前实际/新期望”三方判断，unknown 或 modified 一律 preserve + block。
**Detection:** conformance fixtures 必须覆盖 idempotent install、共享字段 merge、用户改写、unknown owner、partial failure、upgrade、rollback 和 uninstall；doctor 的文件系统 diff 应为空。
**Roadmap gate:** ownership schema 与冲突语义必须先于真实 install；不能把 uninstall/rollback 安全性留到 release phase 补做。

### Pitfall 6: Secrets、原始输出和私密记录进入持久证据
**What goes wrong:** `.env` 值、provider payload、stdout/stderr、auth profile、session state、原始 transcript 或本地敏感文件被打包、写入 receipt/evidence，或出现在错误信息中。
**Why it happens:** live execution 必须临时接触凭据，调试时又倾向保存完整上下文；新增字段常被先视为可信，后补 redaction。
**Consequences:** 凭据泄漏、私密内容扩散、package 不可移植，并破坏 AgentMo 的 fail-closed 证据承诺。
**Prevention:** 永不读取或复制 `.env` 作常规研究；artifact 只记录 SecretRef/key names、presence 与 `valuesPersisted:false`，运行输出只保留有界、清洗后的结构摘要和 digest。
**Detection:** 用合成 secret sentinel 做 CLI、runtime、package、receipt、report 负向测试；任何新 durable output field 在证明 redaction 前默认不允许。
**Roadmap gate:** Discover adapters、package compiler、runtime verifier 和 evidence ledger 各自需要 value-blind egress gate，不能只在最终 report 做一次清洗。

### Pitfall 7: Evidence 等级传递与报告自证
**What goes wrong:** 一个 `ready:true` 或上游 `ok` 从 scaffold/doctor 传到 `declared-ready`、`live-success`、domain quality、delivery readiness 乃至 production approval。
**Why it happens:** 各层报告字段相似，聚合器复用布尔值比重新验证 identity、digest、scope、freshness 和 non-certification flags 更省事。
**Consequences:** 一次接线成功被包装成领域或生产质量；陈旧、错 agent、错 package 或越界 evidence 仍能生成成功 Birth Report。
**Prevention:** 建立 evidence graph 而非 success cascade；Birth/Delivery report 必须重验来源 schema、agent/package id、digest、case scope 与 freshness，且保持 production approval 为独立人工事实。
**Detection:** 负向矩阵注入 stale、mismatched、partial、simulated、unsafe 和自声明 evidence，确认较弱节点永远不能生成较强 claim。
**Roadmap gate:** Produce evidence closure 必须在所有报告 formatter 前固化 claim vocabulary 与 non-transitivity tests；任何新 evidence type 先定义不能证明什么。

### Pitfall 8: OpenClaw package 形态静默扩大 plugin 信任面
**What goes wrong:** 每个领域包默认生成 native plugin，或因为使用 content bundle 就忽略其中 hook/MCP 的执行风险；workspace 邻近性和 skill allowlist 被误当作 sandbox/host authorization。
**Why it happens:** native plugin 最灵活，单一 package layout 最省实现；但 OpenClaw 的 workspace、bundle、MCP、internal hook、typed hook 与 native plugin 属于不同控制面。
**Consequences:** 不必要的代码与 Gateway 同进程运行，权限请求不透明，bundle/native precedence 还可能让安装结果与审阅形态不同。
**Prevention:** 按 capability 选择最小形态：workspace/skill 优先，跨生态内容再用 bundle，外部 tool 显式 MCP，只有 in-process tool 或 typed interception 才允许 native plugin；各形态分目录并声明权限。
**Detection:** plugin 若无明确 capability owner、理由、compat range、依赖、permission gate 和 isolated smoke 即拒绝；检查同目录 native manifest 与 bundle marker、未解释的 hook/MCP 及 sandbox 假设。
**Roadmap gate:** OpenClaw compiler 先实现 workspace/bundle 安全路径；native plugin 是附加安全审查分支，不得成为 package phase 的默认完成条件。

### Pitfall 9: Memory/session 打包污染与授权持久化
**What goes wrong:** OpenClaw SQLite/index、embeddings、auth/session、raw transcript 被放进 Agent Package；一次选题或发布批准被写成长期 memory，随后当作动作授权复用。
**Why it happens:** 将“可恢复”误解为复制全部 runtime state，又把模型可读 memory 当成 tool policy 或 approval ledger。
**Consequences:** 包携带机器与用户秘密、跨环境不可复现；过期授权在新草稿或新 route 上继续生效。
**Prevention:** package 只含 reviewable Markdown 模板与 `memory-policy`；索引和 session 由 runtime 拥有。行动相关记忆必须有 source、owner、scope、condition、expiry，且永远不能替代硬 approval gate。
**Detection:** package lint 拒绝 runtime DB、auth/session 文件与 raw transcript；behavior eval 验证“记得曾批准”仍不能绕过当前 exact-digest approval。
**Roadmap gate:** memory policy 与 package exclusion rules 必须先于中文写作 agent；restore/upgrade 需证明不会导入外部 runtime state。

### Pitfall 10: 人类 source/Plan/选题/发布审批被隐式绕过
**What goes wrong:** “继续”被解释为批准来源或 Plan；趋势扫描自动选择主题；旧审批沿用于变化后的 manifest、角度、草稿或发布 route。
**Why it happens:** 多个人工 gate 看似增加摩擦，开发者容易合并为一次会话同意，或只记录 actor 而不绑定 artifact identity。
**Consequences:** 未审阅来源塑造 agent，社交热度替代编辑判断，未看过的草稿触发外部发布。
**Prevention:** source manifest、Package build contract、topic/angle 与 publish action 分别审批；每次绑定 exact digest、scope、actor、route、expiry，任何变化、超时、取消或缺路由都 deny。
**Detection:** mutation tests 在批准后改变一个 source、capability、选题角度、草稿字节或 route，均应使 admission/action 失败；没有 approval service 时不得 fallback 自动继续。
**Roadmap gate:** Discover、Plan、写作 acceptance slice 和发布 tool 各自拥有独立 approval artifact；后一个 gate 不能继承前一个 gate 的授权。

### Pitfall 11: 上游版本漂移让静态集成证据过期
**What goes wrong:** Codex plugin/hook feature、OpenClaw CLI flags、JSON、state layout、skill eligibility 或 plugin API 改变，而 AgentMo 的确定性测试仍全部通过。
**Why it happens:** 本地 mocks 验证的是 AgentMo contract，不会自动发现外部 host/runtime 漂移；固定 commit 适合设计证据，却不是永久兼容保证。
**Consequences:** setup 显示成功但行为未激活，live/replay 失败，或 removed/unknown surface 被继续写入安装包。
**Prevention:** 记录 tested baseline 与 compat range；每次 setup/Produce 先 probe 并生成 capability lock，未知能力失败关闭；CI 做 Node 22.19/24 packed-install，live smoke 独立刷新。
**Detection:** 比较当前 probe 与 lockfile，监控静态 doctor 通过但 behavior/live smoke 失败、字段或 flags 消失、runtime identity 不匹配等分叉信号。
**Roadmap gate:** 每个涉及 Codex/OpenClaw 的 phase 入口先复验当前 surface，出口保存 exact version/probe evidence；release 不复用陈旧 smoke。

### Pitfall 12: Bounded domain eval 被误写成全领域认证
**What goes wrong:** `support-triage` fixture、一次 `live-success` 或少量中文写作案例，被报告为 domain-wide quality、事实正确或 production-ready。
**Why it happens:** 机制测试数量多且稳定，容易给人“覆盖充分”的错觉；领域 case、rubric、evaluator provenance 与第一手来源缺口却更难维护。
**Consequences:** 真实输入上的遗漏、引用错误和编辑风险被隐藏，Birth/Delivery Report 越过其可证明范围。
**Prevention:** 明确分离 mechanism conformance、isolated runtime、bounded case suite 与 production approval；每个 domain eval 记录 case set、rubric、hard failures、evaluator/source provenance 和剩余风险。
**Detection:** 审查 claim 是否带 case scope；凡出现“领域已认证/生产可用”却没有独立人工批准、exact suite 与来源链，均视为过度声明。
**Roadmap gate:** `support-triage` 只作为一致性 fixture；中文写作包另建真实来源与事实/推断/争议 case，release wording 必须通过 certification-boundary review。

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Required mitigation / exit gate |
|---|---|---|
| Identity & invariant foundation | 名称双轨、第四阶段 | legacy reader + AgentMo-only emitter；三阶段与 fresh-context contract tests |
| Package & ownership contracts | 先生成后补 ownership | `agentmo.package.v1`、operation/receipt、三方 digest 与 conflict-preserve 先定稿 |
| Builder kernel + Codex adapter | prompt-only、能力虚报、上游漂移 | packed install + capability probe + fresh-session behavior/recovery eval |
| Discover vertical | secret intake、自动批准来源 | untrusted-input screening、provenance、exact manifest approval、变更即失效 |
| Plan vertical | 会话祖先依赖、隐式 Plan 批准 | artifact-only admission、decision ledger、approved build-contract digest |
| OpenClaw package compiler | 默认 native plugin、runtime state 混包 | capability-proportional shape、trust lint、memory/session exclusion |
| Owned target lifecycle | 覆盖用户配置、doctor 自动修复 | read-only doctor、field ownership、modified/unknown preserve + block |
| Produce evidence closure | success cascade、原始输出泄漏 | independent evidence graph、revalidation、bounded/redacted summaries |
| `support-triage` acceptance | fixture 被当领域认证 | 只声明 deterministic conformance；覆盖 install/upgrade/negative paths |
| 中文写作 acceptance | 自动选题/发布、memory 授权、弱来源 | 四类独立人工 gate、claim ledger、exact-draft approval、bounded eval |
| Clean-room release | 复用陈旧 probe/smoke | 当前版本重新 probe；隔离 install/live/eval/rollback/uninstall 全链证据 |

## Confidence Assessment

| Area | Confidence | Basis / remaining uncertainty |
|---|---|---|
| Identity、三阶段与 evidence semantics | HIGH | 来自 `.planning/PROJECT.md`、`AGENTS.md` 与现有 contract/testing 边界的直接项目事实 |
| Ownership、secret 与 stage-decoupling 风险 | HIGH | `.planning/codebase/CONCERNS.md` 和 `TESTING.md` 已给出具体失败模式与负向测试策略 |
| Package、memory 与 OpenClaw trust boundaries | HIGH | `STACK.md`、`FEATURES.md`、`ARCHITECTURE.md` 的固定上游一手研究相互一致 |
| Codex hooks/plugin 与 OpenClaw current surface | MEDIUM | 已有固定基线，但上游快速变化；每个实现 phase 必须重新 probe |
| Phase ordering 与 gate 粒度 | MEDIUM | 依赖关系清楚，但最终 roadmap 仍需结合 requirements 拆分与执行反馈调整 |

## Sources

- `.planning/PROJECT.md` — 产品身份、双平面、三阶段、人工权威链、范围与证据约束。
- `.planning/codebase/CONCERNS.md` — certification、stage decoupling、secret、ownership、OpenClaw drift 与 domain-quality 具体风险。
- `.planning/codebase/TESTING.md` — contract、CLI、runtime、fail-closed、vertical-slice 与已知测试边界。
- `.planning/research/STACK.md` — Codex/OpenClaw 基线、最小依赖、package 形态、memory/eval/packaging 决策。
- `.planning/research/FEATURES.md` — table stakes、anti-features、人工 gates、依赖图与验收包边界。
- `.planning/research/ARCHITECTURE.md` — component ownership、artifact flow、evidence graph、recommended build order。
- `AGENTS.md` — 仓库级 secret、release、evidence 与验证操作契约。

未执行新的外部检索；上游结论沿用上述研究文件已记录的固定版本与置信度，因此 current-surface 相关项保留 MEDIUM 并要求 phase-local re-probe。
