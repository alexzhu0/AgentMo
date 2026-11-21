# Pi Workspace Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 沿用本工程会话顺序实施；完成后一次整批独立审阅，不逐任务创建会话。步骤用复选框记录，未经后续源码实施授权不得执行。

**Goal:** 在既有 Pi CLI 上增加授权文字资料、随包领域 Skill 和带引用的 Markdown 成果，保留原文字 Agent 行为。

**Architecture:** AgentMo 管合同、授权快照、父进程工具执行、预算和无覆盖发布；Pi 1.2.0 管原生 provider、工具循环、SSE 解析与 SessionManager。以可选 `pi_workspace` 分支贯通现有链路，不新增模型循环、HTTP 服务或批准体系。

**Tech Stack:** Node.js ESM、node:test、现有 Pi SDK 1.2.0 接口、假 SDK/HTTPS、既有安全文件与预算原语；无新增依赖。

**Spec:** [2026-11-16-pi-workspace-agent-design.md](../specs/2026-11-16-pi-workspace-agent-design.md)。本计划从该规格推导；冲突由控制器处理，工程不得自行扩大规格。

## Global Constraints

- 本轮仅交付此计划，所有下述步骤、测试和源码改动均未执行。工作树 `codex/course-wiki`、核验 HEAD `2979a70`；保留所有已有未提交修改。未来实施先重新确认实际状态。
- 外层仍为 `execution_profile=native-chat`、`native_runtime=pi`、`minimax-m3-cn-v1`；只在显式合法 `pi_workspace` 下启用新能力。缺失字段旧字节/六文件安装/一次请求/零工具不变；非法字段不能回退。
- `agentmo.pi-workspace.v1`：1–2 份 UTF-8 `.txt/.md`，每份4096字节/总8192字节；一份 SKILL.md≤4096字节；任务≤8000 Unicode码点；一个 report.md≤8192字节，不覆盖。
- 每任务≤6模型请求、≤8工具调用（重复read计数、write≤1）、工具串行；完整wire≤48KiB、含system计数≤32 messages；MiniMax-M3/minimax-cn、thinking off、max_tokens=2048。
- 整任务10分钟含启动/I/O/模型；每请求≤90秒并服从总期限；清理另≤300秒；0自动重试、重启、后台调用。任一错误关闭任务，取消后的晚响应不能发布。
- 每次实际上游尝试前独立原子预留31分，任务上限186分；先离线证明新wire成本包络仍支持此值，否则停止生成可执行预览并向控制器报告，不擅自调价。开始前必须能覆盖全部预览上限，每请求再查余额。
- 原真实预算5053分/35笔/10000分、authority23/89只作为维护文档中的事实引用，本轮与离线测试均不读写。测试新建独立合成账本，以5053/10000初始化验证5239上限，不复制真实账本；失败预留不退款。
- 不读密钥/.env，不网络访问、安装依赖、实际SDK导入、真实Agent安装/激活或模型调用，不提交/push。历史E13/E14及其他成功/失败、已消费批准均不重放。
- 沿用单用户可信宿主边界：身份复核、NOFOLLOW与独占创建拒绝可观察替换，不宣称抵御同UID恶意持续改名或提供OS沙箱，不增加VM/文件系统框架。
- 私有资料、供应商payload、成果正文和历史不进公开证据/Git；现有persistability检查不放宽。真实安装、激活/SDK验证、模型均需后续具体预览与批准。

## Review Focus

1. 输入在确认间被替换、硬链接或非法UTF-8：打开正文前拒绝危险路径，确认时身份/摘要失配不运行（任务3）。
2. 原生工具历史与新资料快照混用：同版本/Skill/快照才恢复；不完整工具链保留并拒绝继续（任务5）。
3. 伪造或重放tool_result、同摘要再次请求：按原子序号/任务状态/宿主记录校验，不靠摘要猜重试（任务4）。
4. 创建目标与发布记录之间崩溃，或发布后清理失败：保留文件并如实报告publication-uncertain/failed-cleanup（任务6）。
5. 安装资源扩展导致旧包变化或冷包缺模块：仅两类额外资源，旧包逐字节回归，源码/包/I/O清单齐全（任务1、2、6）。

## 顺序与接口约定

依赖严格为 **1→2→3→4→5→6**；只有第6项后一次整批源码独立审阅。本轮文档由控制器另统一交既有审阅会话。以下新接口名称为实施约定，不声称源码已存在。新模块限 `pi-workspace-policy.js`（纯合同）、`pi-workspace-files.js`（输入/工具/成果）、`pi-workspace-protocol.js`（纯wire/历史校验）；状态机留在现有预算controller与运行器。

共用类型：`WorkspacePolicy`为规格第4节原样字段；`SourceSnapshot`为私有 `{sourceId, logicalPath, originalPath, identity, contentDigest, text, lineCount}`；`WorkspaceSnapshot`为 `{sources, skill, snapshotDigest}`（digest覆盖来源ID、逻辑路径、原始字节摘要与Skill摘要，原路径/身份另进入私有预览绑定）。来源ID固定为 `source-1` / `source-2`（对应逻辑路径编号）。`Citation={sourceId,startLine,endLine}`，行号从1起、按原文LF分行（CRLF保留原字节，范围检查以分行结果计数）。引用正文标记统一 `[sourceId:Lstart-Lend]`。Skill不是资料citation来源。

`TaskBinding`含taskId/sessionId、Agent版本/安装绑定、policy/Skill/snapshot/taskText摘要、上限、截止时刻、输出目录身份及位置；实际文本、绝对路径和快照只在私有预览/父内存。任务摘要与现有批准精确绑定；公开记录仅使用允许的摘要与ID。

### Task 1: 将可选能力贯通 Plan 与合同

**Files:** 新建 `src/pi-workspace-policy.js`、`test/pi-workspace-policy.test.js`；修改 `src/user-need.js`、`src/design-plan.js`、`src/blueprint-draft.js`、`src/blueprint.js`、`src/build-contract.js`；扩展 `test/user-need.test.js`、`test/design-plan.test.js`、`test/blueprint-draft.test.js`、`test/blueprint.test.js`、`test/build-contract.test.js`、`test/pi-native-planning.test.js`。

**Interfaces:** 新增纯函数 `validatePiWorkspace(value) -> {ok,errors}` 与 `piWorkspaceDigest(value) -> sha256`；验证成功才参与原工件序列化。消费者通过已有admission读取可选字段，不接受裸对象绕过批准。

- [ ] 添加失败断言：两个不同领域Skill（项目简报/客服交接）在合法合成来源下生成不同身份、方法与摘要；字段贯通UserNeed→Plan→Blueprint→BuildContract精确相等；修改Skill/任一上限使原批准失配；缺字段旧fixture字节不变。
- [ ] 添加拒绝用例：多余字段、错误runtime、slug/frontmatter名称描述不符、description>256字符、正文>4096字节、脚本/附件/依赖声明、非persistable Skill。无真实路径/输入正文进入包合同；不给persistability加豁免。
- [ ] 运行 `node --test test/pi-workspace-policy.test.js test/user-need.test.js test/design-plan.test.js test/blueprint-draft.test.js test/blueprint.test.js test/build-contract.test.js test/pi-native-planning.test.js`，先确认新增断言因缺能力失败，再实现精确schema及传递。
- [ ] 同步BuildContract的specification/resources/permissions/evidenceObligations/traceGraph，显式Skill和read/write替换新分支的skills-disabled/no-tools宣称；原分支不变。重跑同一命令期望全通过。

### Task 2: 包投影、安装与源码闭包

**Files:** 修改 `src/targets/pi-package.js`、`src/package-carriers.js`、`src/package-contract.js`、`src/pi-install-plan.js`、`src/pi-install.js`、`src/pi-native-runtime.js`、`package.json`、`src/builder-package.js`；扩展 `test/pi-package.test.js`、`test/package-carriers.test.js`、`test/package-contract.test.js`、`test/pi-install.test.js`、`test/pi-preflight.test.js`、`test/builder-packed-install.test.js`、`test/helpers/io-surface-inventory.js`。

**Interfaces:** 在 `pi-install-plan.js` 新增 `piInstallLayout({admittedWorkspace}) -> {files,directories}`，仅接受经现有链准入的策略；缺策略返回原 `PI_INSTALL_PATHS` / `PI_STATE_DIRECTORIES`。新分支六文件外只允许 `workspace-policy.json`、`skills/<name>/SKILL.md`，目录只增加skills及其name子目录；规范排序沿用现有包规则。

- [ ] 先写回归：新包八文件与策略/Skill字节一致，agent.json声明read/write及workspace摘要、mcp=false；额外任意路径、未知Skill目录、资源摘要不符拒绝；旧六文件包/回执保持原字节。
- [ ] 执行 `node --test test/pi-package.test.js test/package-carriers.test.js test/package-contract.test.js test/pi-install.test.js test/pi-preflight.test.js`，确认新增失败后实现投影、carrier/contract准入、archive成员导出、安装operations/receipt及状态root allowlist。清单由准入包推导再与精确layout比对，不能简单取消“六文件”校验。
- [ ] 将workspace摘要贯通安装/激活nativeBinding及源工件绑定；只读preflight检查固定资源，不读授权用户资料、不写成果、不产生后台请求。允许的未来私有task/attempt元数据路径同步现有runtime write声明，不能开放任意state写入。
- [ ] 三个新模块逐一加入 `package.json` files及 `src/builder-package.js` 对应源资源inventory；每新增I/O按现有规则登记 `test/helpers/io-surface-inventory.js`。运行上述测试，期望旧/新分支均通过；完整冷包在任务6验证。

### Task 3: 捕获资料、受限工具与私有暂存

**Files:** 新建 `src/pi-workspace-files.js`、`test/pi-workspace-files.test.js`；修改 `src/pi-chat-cli.js`、`src/pi-cli-run.js`、`src/pi-native-runtime.js`；扩展 `test/pi-chat-cli.test.js`、`test/pi-cli-run.test.js`、`test/pi-native-runtime.test.js`、I/O inventory。

**Interfaces:**
- `captureWorkspace({sourceRoot,relativePaths,skill}) -> WorkspaceSnapshot`：内部复用现有 `readPiCliText({sourceRoot,relativePath})`，再实施4096/8192字节及1–2份限制，不重写宽松读取器。
- `revalidateWorkspace({snapshot}) -> void`：确认时重读并比对身份和摘要；通过后执行只读内存快照。
- `createWorkspaceTools({binding,snapshot,admittedHistoryRecords,attemptRoot,signal}) -> {execute,records,staged,close}`；`execute({taskId,sessionId,toolCallId,name,args})`只接受 `read({path})` / `write({path,content,citations})`，均为精确字段。read返回 `{sourceId,contentDigest,startLine,endLine,text}`；write只返回 `{status:'staged',contentDigest,byteLength,citations}`。

- [ ] 先断言路径/身份/秘密目录拒绝发生在正文读取前：越界、URI/glob、符号/硬链接、非法UTF-8、大小边界、确认后替换。source-root直接候选枚举不递归、不读正文、不自动选中；候选最多展示两份，明确路径输入仍逐一安全检查。
- [ ] 先断言工具仅接受批准sources/1.md、sources/2.md（若存在）与固定Skill路径；重复read计数、第9工具/并行/重复toolCallId/错误task或session/取消后请求均拒绝；资料中的工具指令不扩大权限。
- [ ] write仅一次、只到output/report.md：UTF-8≤8192、至少一个已实际read资料的有效citation（本任务记录或已验证同会话同摘要成功历史），正文标记与citations一致；未知ID、未读来源、倒置/越界范围、重复write拒绝。暂存正文保存在私有attempt 0600，目录0700；公开records只留摘要，实际工具结果留私有内存供协议校验。
- [ ] 执行 `node --test test/pi-workspace-files.test.js test/pi-chat-cli.test.js test/pi-cli-run.test.js test/pi-native-runtime.test.js`，确认失败，再实现接口。暂存使用 `writeNativeChatFile` 的O_EXCL/O_NOFOLLOW/fsync路径；不调用通用覆盖rename。
- [ ] 在现有父子 `call/result` 通道增加精确tool请求及结果schema、task/session/toolCallId绑定、大小和串行限制；父端持有snapshot/工具状态，不把原路径交给模型，不加服务。重跑同一命令期望通过。

### Task 4: 六次有界请求、工具链校验与逐请求预算

**Files:** 新建 `src/pi-workspace-protocol.js`、`test/pi-workspace-protocol.test.js`；修改 `src/pi-budget-proxy.js`、`src/course-wiki-budget.js`；扩展 `test/pi-budget-proxy.test.js`、`test/course-wiki-budget.test.js`、`test/pi-upstream.test.js`、`test/helpers/pi-budget-fixture.js`、`test/helpers/pi-https-fixture.js`。

**Interfaces:** `validateWorkspaceRequest({request,binding,approvedText,previousMessages,toolRecords,policy}) -> {requestDigest,messages}`（纯函数、不预留）；在现有controller增加workspace任务状态，保留旧 `begin(token,inputDigest,requestDigest)` 语义，新分支 `beginWorkspace(token,validatedRequest) -> requestRow` 原子claim requestIndex。`reserved/sent/succeeded/failure`仍按该row记账。`validatePiBudgetRequest`旧行为不改，`sendBudgetedCompletion`仅在经父端准入的workspace分支使用新validator；客户端不能通过自行声明profile切换。

- [ ] 首请求必须对应批准任务、固定system/Skill资源及该会话合法历史；后续只允许上一已验证链的合法扩展。测试tool_use ID唯一、仅read/write及精确schema，tool_result与已执行宿主记录逐项一致，伪造结果/参数/跨任务历史在预留前拒绝；完整工具schema/results也计入48KiB/32条。
- [ ] 新任务凭据绑定TaskBinding与≤6顺序请求。测试同wire摘要的合法新序号仍独立claim；已消费/并发/失败后/结束后/第7请求拒绝，不能凭摘要复用claim。每次新请求各31分，模拟6次得到186分、合成累计5239分/41笔；旧文字仍只一次。开始余额<186拒绝，运行期间外部合成任务消耗余额后原子预留不足也终止。
- [ ] 假时钟验证10分钟覆盖全部工作，单请求截止 `min(taskDeadline, now+90000)`；取消、网络错误、坏协议任一次都关闭任务且不发后续请求，已预留不退。崩溃遗留未终态标interrupted并禁止凭剩余额度续跑。
- [ ] 执行 `node --test test/pi-workspace-protocol.test.js test/pi-budget-proxy.test.js test/course-wiki-budget.test.js test/pi-upstream.test.js`，确认新增失败后实现。沿用原reserve原子实现；native响应仍只透传有界SSE（现有1MiB），不在代理重造SSE解析/模型循环；TLS1.2与证书校验不变。
- [ ] 离线核对全wire输入/2048输出成本包络及usage检查：所有新工具schema/历史/结果都计入；记录31分是否仍成立。不能证明即停止后续可执行运行预览。重跑上述用例期望通过。

### Task 5: Pi原生Skill/工具装配与会话恢复

**Files:** 修改 `src/pi-sdk.js`、`src/pi-session-host.js`、`src/pi-native-runtime.js`；扩展 `test/pi-sdk.test.js`、`test/pi-sdk-conformance-contract.test.js`、`test/pi-session-host.test.js`、`test/pi-native-runtime.test.js`、`test/helpers/pi-sdk-fixture.js`。

**Interfaces:** 给现有 `createPiSession({sdk,config,sessionFile,proxyCredential})` 的config添加仅准入新分支可有的workspace绑定/资源与tool回调；回调使用任务3的execute协议。沿用SessionManager/createAgentSession，不新建循环。在protocol模块增加 `validateWorkspaceHistory({entries,binding,toolRecords}) -> void`，与请求校验共享允许的工具消息规则。

- [ ] 假SDK模拟原生完整事件：读取Skill→读两资料→write暂存→最终回复，工具结果进入后续请求；约5请求是夹具路径而非代码硬编码。断言允许中间assistant/toolCall/toolResult、tool_use与多次message_start，每请求配对start/stop/usage，整个任务恰好一个成功end_turn最终回复；缺final/双final/错误模型/超usage均拒绝。
- [ ] 新分支改 `streamSimple` 文本过滤、raw stop reason校验、`noTools:'all'` 和单final计数；仅允许两个已注册工具、关闭其余内置工具。ResourceLoader固定返回包Skill及受信registerTool扩展，禁止HOME/祖先AGENTS/global .pi发现、动态扩展、自动压缩/后台调用。不要用简单删除校验的方式放开旧路径。
- [ ] 会话绑定Agent版本/Skill/snapshot；恢复时将成功历史读取记录与原生工具链、宿主私有记录和当前快照摘要交叉校验，产出 `admittedHistoryRecords` 给任务3，不允许模型自称已读。成功任务追问新批准、新输出目录、新计数，不改变原会话工具链。测试进程重建后的原生SessionManager恢复保留并核验toolResult；旧文字/异版本/异快照/不完整链拒绝，不编辑JSONL修复；新会话看不到别的资料。断言同会话同摘要的成功read可复用、不强迫追问再次读取全部资料，新会话/异摘要/失败记录不能复用；发布前必须证明Skill完整正文已进入当前原生上下文，只有名称/描述不够。
- [ ] 执行 `node --test test/pi-sdk.test.js test/pi-sdk-conformance-contract.test.js test/pi-session-host.test.js test/pi-native-runtime.test.js`，确认新增失败后最小实现，重跑通过。全部用注入假SDK；不得以此调用实际loadPiSdk或宣称真实SDK兼容已通过。

### Task 6: CLI确认、成果发布、整批回归与交付

**Files:** 修改 `src/pi-chat-cli.js`、`src/pi-cli-run.js`、`src/pi-cli-client.js`、`src/pi-chat-server.js`、`src/pi-chat-client.js`、`src/pi-native-runtime.js`、`src/pi-workspace-files.js`、`src/cli-help.js`；扩展 `test/pi-chat-cli.test.js`、`test/pi-cli-run.test.js`、`test/pi-cli-client.test.js`、`test/pi-chat.test.js`、`test/core-mvp.test.js`、`test/stage-contracts.test.js`、`test/builder-packed-install.test.js`；最终核对 `package.json`、`src/builder-package.js`、I/O inventory。维护 `docs/CORE_MVP_RUNBOOK.md`、`docs/CORE_MVP_ACCEPTANCE.md` 与实施当日release（由控制器统一整合）。网页文件仅适配服务公共消息投影/兼容，不开发新浏览器体验。

**Interfaces:** `preparePiCliRequest`/`runApprovedPiCliRequest`增加workspace kind，沿用原preview/confirmation；私有TaskBinding与快照交父进程。新增 `publishWorkspaceArtifact({binding,staged,finalReply,sessionDurable,taskState,signal}) -> ArtifactManifest`，在files模块；只在任务无错误、final与耐久保存及所有claim/工具检查通过时调用。

`ArtifactManifest`仅含schemaVersion、task/session ID、Agent/Skill/snapshot摘要、report.md相对名、UTF-8字节数/摘要、citations、request/tool/reservation计数、publication与cleanup状态；绝对成果位置仅在私有结果与终端展示。领域正文忠实性由独立内容验收，机械引用对应不等于正确结论。

- [ ] `/workspace`预览显示真实任务、1–2份完整资料/摘要、Skill、随历史再次发送范围、Agent/会话/输出绝对位置、6请求/8工具/186分/10分钟与清理上限。确认时重验输入和output-root；拒绝/过期在任何激活/预留前停止。保留普通文字、/file、/sessions、/use、/new、退出行为。
- [ ] 发布验证output-root为用户指定/本人拥有/私有普通目录且祖先无链接；记录身份并在发布前重验。与输入、安装/state、authority/budget、仓库控制及秘密目录双向不重叠，task-id子目录预览时不存在。使用 `publishNativeChatFiles` 的独占mkdir与O_EXCL/fsync发布原暂存字节（0600/0700），之后 `writeNativeChatFile`保存私有元数据；禁止覆盖rename及自动删除失败现场。
- [ ] 失败注入逐点断言：无write/引用坏/无正常final/超限/取消不发布；目标先出现或root身份变化拒绝；开始发布后中断或文件已落地但记录未落地→publication-uncertain，保留实际文件/attempt，不声称未写入且不补发；已发布、记录完整但清理失败→failed-cleanup，仍显示路径/摘要；仅发布、耐久记录和停止全确认才整任务passed。崩溃后检查仅分类自己的元数据与身份，不重放旧模型/工具，不续未完成任务。
- [ ] 假SDK/HTTPS贯通两个领域夹具的合法来源→Plan→Package→临时合成安装→五次左右原生工具请求→成果/manifest/citations→独立新进程恢复；原文字夹具逐字节不变。断言公开输出没有输入正文、raw payload、私有report或历史；私有输入/输出经专用安全I/O，绝不为它们放宽公共serializePersistableJson策略。
- [ ] 先运行对应新增/原回归并实现到通过：`node --test test/pi-workspace-*.test.js test/pi-chat-cli.test.js test/pi-cli-run.test.js test/pi-cli-client.test.js test/pi-chat.test.js test/core-mvp.test.js test/builder-packed-install.test.js`。冷包必须含三个新模块/资源，不依赖工作树未打包文件，合成安装只在新临时根。
- [ ] 按MVP_RUNBOOK离线路径运行 `node --test test/pi-*.test.js test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/blueprint.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`。其中stage-contracts覆盖support-triage声明式闭环；不得运行历史固定root清理或live-success命令。最后运行 `npm run check`、`git diff --check`；如主检查失败保留原结果并区分修复后局部复测，不能称单次全绿。
- [ ] 汇总源码闭包、公开安全回归证据与缺口，由控制器交既有独立会话做一次整批审阅；重要问题在本批修复并只重跑受影响检查。准备精确新安装预览与M3验收准备说明，尚无真实回执不伪造激活绑定；实际SDK装配兼容观察纳入后续单独具体只读激活/假上游预览（0供应商请求），仍先批准。此处停止，不安装、不激活、不模型、不提交。

## 自审与交接

规格1–4→任务1/2/6；规格5→任务3/5；规格6→任务4/5；规格7→任务3/5/6；规格8→任务6；规格9与授权→全局约束。已对齐规格第5/7节最新澄清：Skill正文入上下文、同会话同摘要成功read复用及可信宿主边界。五项Review Focus都有对应测试。接口名称、TaskBinding、快照和citation在六任务中一致；未添加新协作层、第二套循环或第二个真实账本。

本计划没有发现需要扩大规格才能解决的实质矛盾。31分对工具wire的成本包络、真实SDK1.2.0工具行为和真实M3质量是明确待验证条件，不是已通过事实。完成本文后由控制器验收并统一安排规格/计划的独立文档审阅；源码实施须后续授权。本次文档验证只做路径/接口自审和diff空白检查，不执行上述命令。
