# Course Wiki 当前轮次与证据优先回答实施计划

> **For agentic workers:** 设计方向已获用户批准；先完成本计划自审并请用户审阅计划，再开始实现。计划批准后按 Superpowers subagent-driven-development 执行；每个代码任务先 RED 再 GREEN，逐任务独立审查。步骤采用 `- [ ]` 清单。

**目标：** 修复同会话新问题续答旧题和回答事实超出所选引用范围的问题，并保留真实失败证据。

**架构：** AgentMo 适配层把最新 user 消息作为唯一活动问题，把此前消息序列化为明确标注的不可信历史参考；小语料先做选择再答，大语料先规划检索、再选证据、再答。普通交流在首步结束。每次模型请求单独预留共享预算额度，公开回答接口不变。

**技术栈：** 现有 Node.js、`node:test`、OpenClaw 原生 CLI/会话、AgentMo 本地网关和共享预算；不新增依赖。

**设计：** `docs/superpowers/specs/2026-09-25-course-wiki-turn-and-evidence-design.md`

## 全局约束

- 只在既有 `codex/course-wiki` 链接工作树内实现，并保留现有未提交文件。
- 输入仅支持现有 DOCX、Markdown 和 UTF-8 TXT 资料集；资料上限保持每批 1–10 个、每个 2 MiB、总提取正文 100,000 字符。
- 每个 provider 请求单独预留 CNY 0.31；累计上限 CNY 100；不退款、不自动重试、不按 generation/session 重置预算。
- 单个 OpenClaw 原生 turn 的总截止时间 120 秒；所有内部阶段共享这一个截止时间。
- 保留 OpenClaw 原生历史及现有用户服务；不得编辑或读取用户配置/凭据数据库，不读 `.env`，不得保存原始 provider 回应或转录到验收证据。
- 保持 OpenClaw 到 Course Wiki 网关的 provider 传输协议；Course Wiki 对 OpenClaw 返回的产品结果仍对应 `{kind, answer, citations}`，引用原文由程序从活动 generation 提取。
- 多阶段内部模型请求仅用于 `COURSE_WIKI_SELECTED_CAMPAIGN`；旧 campaign 的既有网关路径保持不变。每个内部阶段通过现有共享预算边界单独计费，网关用现有 SSE 格式把校验后的单个最终结果返回 OpenClaw，不把外层模型回复当作第二份答案。
- 不修改已安装 OpenClaw，不新增依赖、向量库、通用评分系统或新的 agent 入口。
- 不提交、push、发布或推进 AgentMo Discover/Plan/Produce/install/activation/runtime 阶段。

## 复核重点

1. 最近一条 user 消息是短问候、早先 user 是未完成教材问题：模型只能把问候当作当前任务。
2. 当前问题是“第二点呢”：系统保留先前内容供指代，但不能把旧问题当作本轮指令。
3. 当前回答使用概述之外的例子：最终阶段必须收到包含该例子的已选原文，程序引用须覆盖选择范围。
4. 资料集超过检索阈值、无搜索命中：系统只能报告当前检索未找到依据，不能声称全文没有答案。
5. 审查超过 300,000 ms：runner 保留明确失败记录，不能重新打时间戳或遗失 artifact。

---

## 文件职责和任务接口

- `src/course-wiki-turn.js`：新增纯函数 `courseMessageText`、`projectCourseTurn`，规范化当前消息和不可信历史参考；不读写 OpenClaw DB。
- `src/course-wiki-answer.js`：解析严格的 evidence-selection 响应；继续验证最终公开回答及程序绑定的引用。
- `src/course-wiki-openclaw.js`：唯一的生产集成写入者；负责消息投影、检索规划、证据选择、答案生成、每阶段预算和共享截止时间。仅改变已授权 selected-corpus 路径；不改已安装 OpenClaw、外层 transport 或旧 campaign 语义。
- `scripts/course-wiki-acceptance.mjs`：让过期审查写出安全失败 artifact，不再因 stale execution 在 fallback 中二次抛错。
- `.superpowers/sdd/2026-09-20-course-wiki-recovery/lifecycle-acceptance-harness.mjs`：让过期 review 形成安全失败 artifact，而非二次抛错。
- 对应 `test/course-wiki-turn.test.js`、`test/course-wiki-answer.test.js`、`test/course-wiki-openclaw.test.js`、`test/course-wiki-generations.test.js`、`test/course-wiki-gateway.test.js`、`test/course-wiki-budget.test.js`、`test/course-wiki-acceptance.test.js`。

## Task 1：将历史与当前问题分开

**文件：** 新建 `src/course-wiki-turn.js` 和 `test/course-wiki-turn.test.js`。

**接口：** 新增 `courseMessageText(message)` 与 `projectCourseTurn(messages)`。前者复用目前私有 `gatewayMessageText` 的严格 text-only 校验。后者收到已校验 OpenClaw messages，返回 `{ currentUserText, historicalReference }`：选最后一条非空 user 消息并保留完整正文；history 是只含 `{role, text}` primitive 字段的更早 user/assistant 消息数组。调用方只将 history JSON 编码成一段显式不可信参考，不能把历史逐条重新发送为活动角色消息。system 不进入 history；不从角色连续性推断失败状态。保持 32 条/原始 48 KiB 上限，若投影序列化后超限则在付费前拒绝，不静默截断。

- [ ] **步骤 1：写失败测试。** 构造 `system, user(旧题), user(你好)`，断言 `currentUserText` 精确保留“你好”、history 含旧题一次、返回数组仅含 `{role,text}` primitive 字段且无旧 active role。另测旧 assistant + 当前问候、明确追问、无非空 user、附件内容、32 条消息边界、非法角色和投影后超 48 KiB 的 fail-closed 情况。
- [ ] **步骤 2：运行 RED。** 运行 `node --test test/course-wiki-turn.test.js`。预期缺少 `projectCourseTurn` 时测试失败；不得访问用户 SQLite 或调用 API。
- [ ] **步骤 3：实现纯函数。** 仅用已有 `gatewayMessageText` 等价的严格文本片段规则规范消息；保持 timestamp 原样。投影超限时抛固定的请求超限错误，不截断、丢弃 history 或拼造当前问题。
- [ ] **步骤 4：运行 GREEN。** 重跑相同测试，断言角色投影和文本摘要均符合预期。
- [ ] **步骤 5：独立审查。** Reviewer 检查新函数是否把旧 role 当活动输入、是否能让 history 字段伪造消息角色、是否存在原文落盘；有发现则回到原作者修复并复测。

## Task 2：严格验证选择结果并锁定引用

**文件：** 修改 `src/course-wiki-answer.js` 和 `test/course-wiki-answer.test.js`。

**接口：** 新增 `validateCourseSelection(value, documents, {stage})`，按阶段接受严格联合类型。`stage:'route'` 仅接受 `{kind:'conversation',answer}` 或 `{kind:'search',query}`；`stage:'small-select'` 接受 conversation、`{kind:'insufficient_evidence'}` 或 `{kind:'grounded-selection',resolvedQuestion,selections}`；`stage:'retrieved-select'` 仅接受 insufficient-evidence 或 grounded-selection。每项 selection 仅含 `sourceDigest, fromLine, toLine`，来源与行范围须属于输入的 active-generation documents。返回 grounded 引用只由程序经 `materializeCitationSelections` 生成；模型不能输出 quote。

- [ ] **步骤 1：写失败测试。** 覆盖概述与例子分处不同范围的选择；断言 grounded-selection 没有 `answer` 字段、`resolvedQuestion` 非空且有长度上限；未知 digest、非活动来源、反转/越界行号、空/重复/过量 selection 和额外字段均失败。route-stage 不接受 selections；conversation/insufficient-evidence 必须无 selections。
- [ ] **步骤 2：运行 RED。** 运行 `node --test test/course-wiki-answer.test.js`，记录新测试失败和准确退出码。
- [ ] **步骤 3：实现校验器。** 复用 `materializeCitationSelections` 验证精确原文。返回值不含模型生成 quote 或答案草稿；不可校验项目使用现有固定 model-response 错误。
- [ ] **步骤 4：运行 GREEN。** 重跑该套件。再断言 `validateCourseAnswer` 仍拒绝 grounded 空引用，conversation/insufficient-evidence 仍拒绝非空引用。
- [ ] **步骤 5：独立审查。** Reviewer 确认第二阶段的 citation 只能来自第一阶段经过校验的完整范围，模型不能缩短或改写最终引用。

## Task 3：接入投影、证据选择与共享预算

**文件：** 单一 writer 修改 `src/course-wiki-openclaw.js` 和 `src/course-wiki-gateway.js`；更新 `test/course-wiki-openclaw.test.js`、`test/course-wiki-generations.test.js`、`test/course-wiki-gateway.test.js` 和 `test/course-wiki-budget.test.js`。

**内部请求构造：** `buildCourseSelectionRequest({turn,evidence})` 只构造 selection 阶段的一条 user 消息；`buildCourseGroundedAnswerRequest({resolvedQuestion,selections})` 只构造最终 answer 阶段的一条 user 消息。前者只含唯一 `currentUserText`、显式标记的不可信 history 和候选资料；后者仅含已验证的 `resolvedQuestion`、静态产品规则和程序提取的 selected lines。不得把原始 OpenClaw messages、旧 assistant 答案或 selection response 原文作为第二阶段对话历史。选择 prompt 不请求答案；answer prompt 只接受 `{answer}`。程序将 `{kind:'grounded',answer,citations:selectedCitations}` 交给现有 validator；conversation 无引用，检索零命中/不足使用本地固定文案。

**数据流：** 仅改变 selected-corpus authorization 分支。保留现有 workspace、provider request、active-generation pinning 和 admitted-request attempt-claim 检查，并在每个 native turn 只建立一次 turn projection 与 deadline。完整 evidence ≤14 KiB 时，首个内部请求用 `small-select`：conversation 立即返回；insufficient-evidence 返回固定本地文案；grounded-selection 经验证后才启动第二答案请求。大于 14 KiB 时，第一个 `route` 请求返回 conversation 或有界 search query；query 经现有 Wiki search 映射到 pinned generation；零命中返回固定检索不足文案；有候选才调用 `retrieved-select`；通过校验后由最终阶段回答。最终结果仍由现有网关 formatter/SSE 返回。旧 campaign 保持原 provider pass-through。

内部阶段通过新 helper `selectedModelExchange({binding,messages,apiKey,deadline}) -> {value,usage,actualModel}` 与同一共享预算根执行；它复用现有 `selectedModelCall` 的 budget-proxy/JSON validation 流程，但不能递归调用本机 Course Wiki gateway。旧 `selectedModelCall` 保留 raw-value 返回契约，避免更改 Wiki generation 与现有 retrieval。每个真实 provider 请求单独预留 31 fen；按 route 最坏调用数 1/2/3 在首个付费请求前检查余额。阶段失败即停止、不退款、不重试。每次 HTTP 时限为 `min(95s, deadline-now)`，共享 deadline 总长 120s；预留前/请求前 deadline 已耗尽则不发起调用。最终 usage 汇总本 turn 已执行阶段的 token 计数。

- [ ] **步骤 1：写当前轮 RED 测试。** 向真实网关注入 `[system, user(副词旧题), user(你好)]`；mock provider 必须看到只有“你好”为当前问题、旧题只存在于不可信历史参考，并返回 conversation。断言未生成 grounded 答案或引用。
- [ ] **步骤 2：写阶段与引用 RED 测试。** 覆盖小语料问候 1 次、小语料 grounded 2 次、大语料问候 1 次、大语料 grounded 3 次和大语料零命中 1 次；断言 stage schema、gateway 最终输出兼容和 provider 调用/reservation 一一对应。每条 grounded citation 的 digest、行号及 quote 必须绑定 selected lines。
- [ ] **步骤 3：写费用/超时 RED 测试。** 剩余额少于该 corpus route 最坏 provider 请求数时零调用；余额足够时每次调用前单独 reservation 31 fen；阶段失败后 reservation 保留、不重试。注入时钟让共享 120 秒 deadline 过期，断言不启动下一阶段，`AbortSignal.timeout` 不接收零/负值。
- [ ] **步骤 4：运行 RED。** 运行聚焦文件：`node --test test/course-wiki-openclaw.test.js test/course-wiki-generations.test.js test/course-wiki-gateway.test.js test/course-wiki-budget.test.js test/course-wiki-turn.test.js test/course-wiki-answer.test.js`。分别记录失败用例和准确退出码。
- [ ] **步骤 5：接通投影与阶段调度。** 每个 native turn 只生成一个 projection/deadline/attempt claim。新 selected-corpus 阶段使用 `selectedModelExchange` 及共享预算；现有 generation 和独立 retrieval 继续用 raw-value 的 `selectedModelCall`，不改变既有路径。
- [ ] **步骤 6：实现 deadline 与调用计数。** provider HTTP 时限为 `min(95s, 总截止时间-now)`；无剩余时间在下一 reservation/fetch 前 fail closed。原生 gateway attempt 仍计一条；API usage 汇总实际 token。`runCourseGatewayRequest` 的内部返回值及 gateway `onEvent` 只增加安全的阶段名与 provider-request count，不改公开 SSE/text；未启动阶段不计入。
- [ ] **步骤 7：运行 GREEN。** 重跑相关聚焦 suites；核对 reservation 增量精确等于已开始 provider 请求数乘 31 fen，未启动阶段为零。
- [ ] **步骤 8：独立审查。** Reviewer 检查活动问题唯一性、历史保留、资料绑定、单次预算预留、无自动 retry，以及 120 秒 deadline 覆盖整个多阶段流程。

## Task 4：过期审查也落盘为安全失败

**文件：** 修改 `scripts/course-wiki-acceptance.mjs` 和 `test/course-wiki-acceptance.test.js`；不修改通用 freshness validator `src/behavior-evidence.js`。

- [ ] **步骤 1：写失败测试。** 给 runner 注入默认 `now=Date.now` 的 clock seam；测试让 `reviewCase` 返回时钟前进超过 300000ms。断言 freshness validator 拒绝 review，输出文件最终为非空 JSON `status:'incomplete'` artifact；当前记录 `status:'evidence-expired'`、`review:null`、`execution:null`、fail/gap result 不通过，已发生的尝试/回答数量与 safe evidence digest 保留，后续 case 为 `stopped-after-failure`。
- [ ] **步骤 2：运行 RED。** `node --test --test-name-pattern='expired review' test/course-wiki-acceptance.test.js`；当前路径应触发 stale execution fallback 二次抛错且保留零字节文件。
- [ ] **步骤 3：修复失败分支。** freshness 一旦失败，将 review 设为 null，并通过 `buildBehaviorCaseResult({execution:null,review:null})` 生成 gap；不把已过期 execution 存为可接受 execution。设置 bounded failure/status `evidence-expired`，在已有 evidence 中保留 counts、session digests 与 execution digest。只把通过接口校验的 review 纳入 review 字段，结束后续 cases，再由既有独占 output handle 写入单一最终 artifact。不得打回时间、放宽 freshness 或标为通过。
- [ ] **步骤 4：运行 GREEN。** 重跑 runner suite，额外覆盖过期机械检查、缺失 review、fresh false review 与被取消操作；失败记录必须可读且通过状态为 false。
- [ ] **步骤 5：独立审查。** Reviewer 验证系统没有打回时间、忽略 freshness、把过期 false review 当成有效证明或保存原始答案。

## Task 5：整合验收与证据更新

**文件：** 更新 `docs/poc/course-wiki/acceptance-cases.json`、`.superpowers/sdd/2026-09-20-course-wiki-recovery/lifecycle-acceptance-harness.mjs` 及必要的无原文验收报告、`docs/poc/course-wiki/RECOVERY-AUDIT-2026-09-20.md`、`release/2026.09.25.md`。

- [ ] **步骤 1：锁定验收映射。** 每个 case 的最大 provider-call 数与检索类别绑定；failure-recovery 检查必须把新问候的回答类型、当前消息摘要和同 session digest 绑定到执行记录。
- [ ] **步骤 2：核验验收 harness 与 shared ledger。** 一条 native attempt 可以含 1、2 或 3 次 provider 请求；按 corpus route 最坏请求数预检，每 case 实际阶段名/provider-call count 同时与 gateway 的安全 onEvent 及执行前后 shared ledger 差额核对。阶段失败不退款、不 retry，且停止后续 cases。
- [ ] **步骤 3：跑所有非付费验收。** 确保重复输入、预算不足、超时、拒绝格式、问候、追问、换题、检索未命中、跨文档引用、失败恢复和过期审查测试通过。
- [ ] **步骤 4：执行新一轮真实原生验收。** 在显式隔离、受监督的 loopback 测试服务与 native profile/session 中，复用已接受的 r3 generation 和同一个 shared budget；不重生成 Wiki、不重置预算、不停改动两个现有用户服务。按 case 运行，失败即停止该 case 余下阶段；不自动重试。累计预留/预检不超过既有 CNY 100；每项语义 rubric 独立且新鲜，超过 300000ms 标记 failed/unreviewed。测试若因当前 sandbox 禁止 loopback bind 无法启动，应请求只针对测试所需本机 loopback 的权限；不改端口到用户服务。
- [ ] **步骤 5：完成审阅证据。** 对 prompt-to-selection、selection-to-answer 两个隔离边界做 code review；真实回答逐条审查焦点、证据支持、例子覆盖和指代。保存摘要、摘要哈希、角色和调用数，不保存 transcript、response body 或密钥。
- [ ] **步骤 6：更新证据记录。** release 明确记录旧 PASS/FAIL、现在的真实响应、实际 reservation 增量、失败/未执行 cases、用户服务状态和剩余范围，不将 live test 写为 formal stage approval。

## Task 6：最终验证和交接

- [ ] **步骤 1：查看改动路径。** `git status --short`；确认只包含已列目标及既有待办改动，不回滚或覆盖用户更改。
- [ ] **步骤 2：运行完整代码检查。** `npm run check`；任何 lane 非零时记录具体 lane/exit code，只修本计划范围内失败。完整检查不能被先前 Node20 receipt 或聚焦 suites 替代。
- [ ] **步骤 3：检查补丁格式。** 运行 `git diff --check`，并对 task-owned untracked 文件执行等价 whitespace 检查。
- [ ] **步骤 4：独立全变更审查。** Review 当前工作树任务快照中的产品代码、测试、验收映射、release/path ownership。修复所有 blocker 后重跑所影响的聚焦 suite 与完整检查。
- [ ] **步骤 5：准备交接摘要。** 说明真实使用范围、case 级 PASS/FAIL/未执行、剩余额度与 reservation、两个原服务 PID/状态、接受 Wiki generation、完整检查精确退出码以及仍需的正式阶段审批。

## 执行方式与提交

用户已明确要求多 Session 协作。计划审阅通过后，统筹 Session 可将 Task 1、2、4 分配到互不重叠文件；每个实现任务先给 RED 退出证据，再实现、跑 GREEN，并由独立 Session 按验收点 review。Task 3 只在这些变更审查通过后由一个集成 writer 独占执行；Task 5 只更新验收映射、无原文报告和 release 记录。所有 Session 仅修改列明的 task-owned 文件，不提交共享工作树；真实 API/Native acceptance 不与代码测试并发运行。统筹 Session 负责汇入改动、冲突处理、预算/服务状态和最终验证。

## 计划自审

- 两个已复现问题分别映射到 turn projection 测试与 selection-to-answer 隔离测试；stale-evidence fix 仅保证失败证据可保存，不替代语义验收。
- 纯函数/validator/runner 与生产集成边界明确；重叠核心文件只由一个 writer 按依赖顺序改动。
- 旧 campaign、现有 OpenClaw SSE、session history/SQLite、活动 generation pinning 与共享 31-fen reservation 保持兼容。
- 失败不会清 history、retry、refund、回拨时间或冒充 PASS；grounded answer 只能以程序提取的 selected lines 为来源。
- 不增加依赖、持久化 store、新入口、通用评分系统或 formal-stage 权限。
- 当前 `test/course-wiki-acceptance.test.js` 基线为 63/63 通过；`test/course-wiki-generations.test.js` 在当前 sandbox 因 loopback bind 返回 `listen EPERM` 而无法验证，并非产品断言失败。后续 loopback suites 必须在允许本机 loopback 的环境运行，且不得使用现有用户服务端口。

本计划没有 commit、push 或发布步骤；需提交时仍须由用户另行指示。
