# Task 7 Pi Browser Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前meeting-text迁成有正式来源、独立私有会话和浏览器入口的Pi Agent，复用原累计预算，并先交付每道真实运行的具体预览。

**Architecture:** AgentMo监督进程控制Pi SDK子进程和预算代理；子进程提供浏览器聊天与官方SessionManager，真实M3 key只留在预算代理。来源链显式选择Pi，安装/激活/验收使用Pi身份，旧OpenClaw字节及行为保留。

**Tech Stack:** Node标准库；官方`@earendil-works/pi-coding-agent@1.2.0`（尚未安装），独立Node >=22.19.0；AgentMo核心仍Node >=20；本地HTML/CSS/JavaScript，无前端框架。

**Spec:** [2026-10-16-pi-browser-agent-design.md](../specs/2026-10-16-pi-browser-agent-design.md)，用户已批准SHA-256 `6e937f12fe7253849fa4983f2f93fe5573a6009e879a282a785e2bbc93602e8b`。保持该文件原字节，批准记录另存。

状态：计划待用户审阅及选择执行方式；本次只编写计划，未实施任何任务。

## Global Constraints

- 当前会议助手、浏览器入口、原累计预算保留；不做通用多载体框架或其他Agent迁移。
- `execution_profile: "native-chat"`，显式`native_runtime: "pi"`，显式`native_model_profile: "minimax-m3-cn-v1"`；缺省仅保留历史OpenClaw解释及原字节。
- 固定SDK `@earendil-works/pi-coding-agent@1.2.0`；SDK运行Node >=22.19.0；Node 20核心不得静态导入SDK；不改变`scripts/node20-distribution-trust.json`。
- 唯一供应商端点`https://api.minimax.cn/v1/chat/completions`，model=`MiniMax-M3`；standard、thinking disabled、n=1、max_completion_tokens=2048。
- 用户文本非空、最多8000 Unicode码点；完整请求最多48KiB、32条消息；usage输入53248 / 输出2048 tokens边界；拒绝而不截断。
- 单次保守预留31分，累计上限10000分；写计划时26项项目预留、4774分累计预留、5226分可用；实际执行重新观察，不重置/退款/删除claim。
- tools/customTools为空、noTools=all；无扩展、MCP、全局资源发现、fallback、两层重试、预热、自动压缩/摘要/续跑；材料按字面处理。
- 不读取、显示或复制.env内容/密钥。只有后续具体批准的运行器可在内存加载MINIMAX_API_KEY；Pi和浏览器不持有真实key。
- 真实工具链安装、authority初始化、Agent安装、激活和模型/模拟验收均先生成各自具体预览，再取得批准；计划批准不包含这些操作。
- 旧OpenClaw诊断批准不转给Pi。旧状态、会话、批准消费、失败证据、15项来源缺口及19类要求保留；M3 502根因仍未知。
- 当前实际工作树`.worktrees/course-wiki`；不改主checkout的已有改动，不访问sibling项目。执行前核对实际路径和Git状态，复用本工作树。
- **不stage、commit、push或发布。** 技能模板的频繁提交步骤在此由用户禁令覆盖；各任务结束只核对显式路径和验证证据。
- 每项先红后绿，再核对影响范围；测试只用合成材料/临时根，不触碰真实账本。运行证据不含正文、全会话、供应商载荷、任意异常或stdout/stderr预览。
- 每任务Step 1先写该任务全部已列正反例（含Step 4列出的RF断言），Step 2确认预期失败；Step 4只运行/核对。发现遗漏时回到红测试，不用绿后的新实现掩盖测试缺口。

## Review Focus

- RF1：无效UTF-8、非BMP码点、空白与恰好8000/8001边界不能被替换、截断或提前花费；Task 6测试。
- RF2：最终回复已落盘但浏览器断线/进程中断，恢复只能显示原结果或不确定状态，不能补发；Tasks 3、7测试。
- RF3：重算哈希后的旧OpenClaw来源或克隆admission不能骗过Pi链，且拒绝前零批准消费/写入；Tasks 2、4–5、9测试。
- RF4：SDK两层重试、默认预热和恢复动作可能隐藏额外请求；Tasks 7、11检查实际固定SDK和长空闲计数。
- RF5：模型HTML、伪凭据和携body/key的异常不能执行页面代码或流入证据；Tasks 3、6测试。

---

## 文件边界和共享接口

新增模块按实际职责分工，不把OpenClaw模块复制改名成一套通用框架。以下所有类型都是闭合结构，未知字段拒绝。
`Digest`指`sha256:`加64位小写十六进制；`Admission`指现有artifact-admission产生的真实句柄，JSON复制品不等价。
`TargetPaths = {sdkRoot, nodeExecutablePath, lockFilePath}`，均是后续具体预览中的规范私有路径。
`sourceAdmissions`是当前阶段要求的真实Blueprint/Design Plan/Discover approval/ledger/Build Contract/Plan approval/Pi descriptor/carrier/Package来源句柄，archiveBinding由现有归档准入产生；缺失项不得用JSON对象补位。
`PublicTurn = {turnId, sessionId, status, causeCode?, upstreamStatus?}`；status只允许received/reserved/sent/completed/failed/interrupted。
最终text只从同一私有SDK会话取回并发送给已鉴权页面，不进入turn journal或证据；journal只保存最终entry标识和terminal状态。
`AdmitResult = {kind:"admitted", turnToken} | {kind:"existing", turn:PublicTurn}`；两种分支不能混合。

| 文件组 | 责任 |
| --- | --- |
| `src/native-chat-model-profile.js`及现有Need/Plan/Blueprint模块 | 唯一runtime选择与旧缺省；不改变已有model profile返回值 |
| `src/pi-target-descriptor.js`、`src/pi-target-admission.js`、`src/targets/pi.js`、`src/targets/pi-package.js` | 固定SDK/Node/AgentMo运行闭包、目标准入和Pi投影 |
| `src/pi-install-plan.js`、`src/pi-install-approval.js`、`src/pi-install.js` | 精确计划、封闭批准、create-only事务和来源可核对回执 |
| `src/pi-budget-proxy.js` | Pi turn准入、单次能力token、持久claim；复用现有请求规范化和预算发送 |
| `src/pi-sdk.js`、`src/pi-session-host.js` | 唯一延迟SDK导入、有效配置、官方会话、turn状态和最终事件 |
| `src/pi-chat-server.js`、`src/pi-chat.html`、`src/pi-chat-client.js`、`src/pi-chat.css` | 同源认证、最小浏览器交互、安全文字和只读事件恢复 |
| `src/pi-native-runtime.js`、`src/pi-native-cli.js` | 父进程监督、环境白名单、预检/启动/鉴权停止、公开命令路由 |
| `src/pi-chat-acceptance.js`及现有delivery模块 | 19类Pi来源与观察、独立评审、fail-closed报告 |
| `scripts/pi-sdk-conformance.js` | 仅在精确预览获批后执行的固定SDK合成集成；不加入默认check、不作为运行依赖 |

Pi投影固定六个文件：`projections/pi/agent.json`、`system.md`、`runtime-binding.json`、
`browser/index.html`、`browser/client.js`、`browser/style.css`，后三个同属`projections/pi/`。
安装时去掉`projections/pi/`前缀，全部文件0600、目录0700；单独登记空`sessions/`、`turns/`、`attempts/`目录。
agent.json只保存无秘密配置，runtime-binding.json保持executionAuthorized/installed/runtimeVerified=false，安装/运行事实由独立回执证明。

依赖顺序：1 → 2；3的HTTP/页面对固定会话接口使用假host，可独立验证；4依赖1–3，5依赖4，6依赖5，7依赖5–6，8依赖3–7，9依赖4–8，10汇总1–9。
Tasks 1–10为计划审阅后可实施的源码与合成验证；11–13是继续任务所需的独立批准门禁，不能自动执行。

### Task 1: Pi选择贯穿Need、Stage 2和Blueprint

**Files:** Modify `src/native-chat-model-profile.js`, `src/user-need.js`, `src/design-plan.js`, `src/blueprint-draft.js`, `src/blueprint.js`, `src/artifact-contract.js`; Create `test/pi-native-planning.test.js`, `test/helpers/pi-native-fixture.js`; Modify `test/user-need.test.js`, `test/design-plan.test.js`, `test/blueprint-draft.test.js`。

**Interfaces:** 新增`nativeChatRuntime(source) -> "pi" | "openclaw" | undefined`，非法组合抛有界错误；导出`PI_NATIVE_MODEL = "agentmo-budget/MiniMax-M3"`。现有Stage 2函数签名不变，通过`options.runtime: "pi"`选择；Need/Plan/Blueprint均保留显式native_runtime。测试helper先导出`piNeed() -> sanitized UserNeed`，不造运行状态。

- [ ] **1. 写红测试** `test('propagates explicit Pi and preserves omitted legacy bytes')`：对真实准入的Need/Discover/ledger构造Plan和Blueprint，断言`plan.native_runtime === 'pi'`、`plan.targetRuntime === 'pi'`、`blueprint.runtime === 'pi'`、空tools/specialists；旧缺省输出按固定夹具逐字节相等。
- [ ] **2. 确认失败** 运行`node --test test/pi-native-planning.test.js`；应因Pi选择尚未支持失败，不能因夹具或读文件错误失败。
- [ ] **3. 实现选择传播** 在上述校验/生成/摘要和artifact contract中使用同一选择函数；Pi必须显式M3，null/未知值/non-native或runtime错配拒绝。不要改老profile对象或从环境推断目标。
- [ ] **4. 运行负例并转绿** 核对`assert.throws(() => nativeChatRuntime({...piNeed(), native_runtime:null}))`，错配Plan/Need和反向拼接均拒绝；运行本任务测试及runbook的Stage 2契约组，全部通过。
- [ ] **5. 留证** 记录改动路径、命令/摘要和仍缺实际Pi目标；不提交。

### Task 2: 可观察的Pi目标与严格Artifact准入

**Files:** Create `src/pi-target-descriptor.js`, `test/pi-target.test.js`; Modify `src/artifact-registry.js`, `src/artifact-subjects.js`, `src/artifact-contract.js`, `src/artifact-admission.js`, `src/persistability.js`, `test/artifact-admission.test.js`, `test/helpers/pi-native-fixture.js`。

**Interfaces:** `buildPiTargetDescriptor(TargetPaths) -> Promise<PiDescriptor>`；`validatePiTargetDescriptor(value) -> {ok,errors}`。PiDescriptor绑定固定name/version、锁文件/SDK闭包/Node可执行文件/AgentMo运行闭包摘要及规范根身份；运行文件清单由仓库拥有，不允许调用者传任意信任清单。当前只实现描述器，Carrier及其正向来源闭环属于Task 4。

- [ ] **1. 写红测试** `test('observes target bytes and rejects cloned or cross-carrier admissions')`：合成SDK目录固定1.2.0，断言改动依赖文件后descriptor摘要改变；符号链接、缺失传递成员、错误lock integrity/Node版本和旧descriptor subject均拒绝。helper新增`withPiTargetFixture(fn)`，只创建受测临时文件。
- [ ] **2. 确认失败** 运行`node --test test/pi-target.test.js`，应缺新目标/subject支持。
- [ ] **3. 实现封闭身份** 注册`pi-target-descriptor`及其确切来源集合；复用原字节、大小、UTF-8、重复JSON成员、来源句柄和持久化校验。描述器只观察安装树，不执行SDK；未知/秘密文件名不读取，不扫描.env或用户认证目录。
- [ ] **4. 转绿并复核RF3** 断言伪造/JSON克隆句柄及只重算哈希的旧来源失败；拒绝后临时目录没有后继工件。运行`node --test test/pi-target.test.js test/artifact-admission.test.js test/artifact-contract.test.js`。
- [ ] **5. 留证** 这些夹具只证明机制，不生成“真实Pi已安装”或真实工具链回执。

### Task 3: 最小浏览器入口与安全恢复

**Files:** Create `src/pi-chat-server.js`, `src/pi-chat.html`, `src/pi-chat-client.js`, `src/pi-chat.css`, `test/pi-chat.test.js`。

**Interfaces:** `createPiChatHandler({host,origin,sessionHost,loginSecret,onStop}) -> NodeRequestListener`；`startPiChatServer({port,...handlerOptions}) -> Promise<{close}>`只绑定127.0.0.1。路由固定为`/`、`/client.js`、`/style.css`、`POST /api/login`、`GET/POST /api/sessions`、`GET /api/sessions/:id`、`POST /api/turns`、`GET /api/turns/:id/events`、`POST /api/stop`。POST exact Origin/Host/JSON/cookie校验；事件流只读，不暴露SDK RPC。
本任务用假sessionHost验证固定接口，Task 7提供实际实现：createSession()返回{id}，listSessions()返回[{id,createdAt}]，readSession(id)返回{id,messages,turns}，submit返回已持久登记的PublicTurn，events(turnId)先给快照再推送状态/最终文字。ID均为规范UUID，登记后才可使用，不作路径解释。
login只接受{password}，创建会议只接受{}，提交只接受{caseId,sessionId,turnId,text}；分别返回{authenticated:true}、{id}、202 PublicTurn。客户端生成候选turn UUID，服务端准入；刷新仅通过已登记turn事件恢复，不重新POST。

- [ ] **1. 写红测试** `test('rejects cross-origin and read-only submissions before SDK')`：用直接调用handler的假request/response测试Host/Origin、登录限次、未知字段、错误cookie/路径/会话ID，断言未调用submit。根页面在未登录时只显示登录，不返回会话数据。
- [ ] **2. 确认失败** 运行`node --test test/pi-chat.test.js`，应缺页面和认证处理。
- [ ] **3. 实现页面** 同源POST交换口令为HttpOnly/SameSite=Strict会话cookie；每次激活最多5次失败登录，达到后拒绝登录直至显式停止/新获批激活，不自动重启。口令不放URL/storage/日志。消息用textContent，静态资源无CDN；会议列表、新会议、输入、发送、停止、只读/处理中/最终/失败状态具备键盘、标签、焦点和状态播报。
- [ ] **4. 转绿并覆盖RF2/RF5** `test('reconnect and refresh observe without submit')`与`test('renders HTML as text and keeps credentials out of browser data')`分别断言零额外submit、恶意样本未进入innerHTML/日志。断开只恢复事件观察。运行`node --test test/pi-chat.test.js`，用假fetch/DOM和直接handler验证，无新前端依赖或真实监听。
- [ ] **5. 留证** 不在此步骤启动用户的实际服务或声称浏览器验收；真实页面检查在Task 12激活预览获批后进行。

### Task 4: 正式Build Contract、Pi adapter和Package闭包

**Files:** Create `src/targets/pi.js`, `src/targets/pi-package.js`, `src/pi-target-admission.js`, `test/pi-package.test.js`; Modify `src/targets/registry.js`, `src/scaffold-files.js`, `src/build-contract.js`, `src/package-carriers.js`, `src/package-contract.js`, `src/package-produce.js`, `src/package-inspect.js`, `src/artifact-subjects.js`, `src/artifact-registry.js`, `src/artifact-contract.js`, `src/cli.js`, `test/targets.test.js`, `test/build-contract.test.js`, `test/package-carriers.test.js`, `test/package-produce.test.js`, `test/helpers/pi-native-fixture.js`。

**Interfaces:** `piTarget`遵循现有id/runtimeId/supports/planOperations接口，拒绝non-native及非M3。`buildPiPackageProjection({blueprint,buildContract,carrierSelection,targetAdmission}) -> Array<{relativePath,mode,bytes}>`；精确六成员路径见前表。沿用`buildBuildContract`、`produceAgentPackage`签名；按明确target选择Pi descriptor/admission subjects，禁止同时提供两种载体。helper新增`withPiPackageFixture(fn)`，走真实准入/规划/Produce API，返回`{admissions,archiveBinding,targetPaths,root}`；SDK目标仍为合成临时树。
`buildPiTargetCarrierAdmission({admissions,targetPaths}) -> Promise<PiCarrierAdmission>`注册`pi-target-carrier-admission`及完整companion集合，重新观察目标闭包并核对规划批准。

- [ ] **1. 写红测试** `test('produces an admitted Pi archive and rejects rehashed OpenClaw planning')`：断言target/carrier owner为pi、specification.runtimeBinding与Pi/M3一致、归档成员完整；把旧Plan/Contract来源重新哈希拼入新Pi投影，必须在输出前拒绝。
- [ ] **2. 确认失败** 运行`node --test test/pi-package.test.js`，确认因Pi分支缺失失败。
- [ ] **3. 实现投影和调用者分派** 现有22资源族保留显式禁用项，Pi运行机制明确为SDK；不改旧OpenClaw返回值。投影读取Task 3实际资产并绑定摘要，拒绝缺失或漂移的资产，不生成占位页面。
- [ ] **4. 转绿** 完整六成员Produce/归档/检查与Carrier正向准入使用真实合成规划来源，全部正反例通过。运行`node --test test/pi-package.test.js test/pi-target.test.js test/targets.test.js test/build-contract.test.js test/package-carriers.test.js test/package-produce.test.js`。
- [ ] **5. 留证** 证明完整合成Package机制；未正式Produce当前用户的会议助手，没有真实运行结论。

### Task 5: Pi安装计划、批准消费和create-only回执

**Files:** Create `src/pi-install-plan.js`, `src/pi-install-approval.js`, `src/pi-install.js`, `test/pi-install.test.js`; Modify `src/native-chat-authority.js`, `src/artifact-registry.js`, `src/artifact-contract.js`, `src/artifact-subjects.js`, `src/artifact-admission.js`。

**Interfaces:** `buildPiInstallPlan({lifecycle,admissions,stateRoot,authorityRootBinding,budgetReference,ports,predecessor}) -> PiInstallPlan`（纯构造，install时predecessor=null，activate时为真实安装receipt admission）；`validatePiNativeBinding(value) -> boolean`。`buildPiInstallApproval`、`buildPiSensitiveActionDecision`、`buildPiConflictApproval`和各validate函数分别采用现有同名OpenClaw接口的封闭参数结构，但只接受Pi plan。`applyPiInstall({planAdmission,sourceAdmissions,ordinaryApproval,sensitiveDecisions,conflictApproval,stateRoot,authorityRoot}) -> Promise<PiInstallReceipt>`；`admitPiInstallReceipt({filePath,expectedDigest,admissions,stateRoot,authorityRoot}) -> Promise<Admission>`核对真实快照和消费，不能只读receipt自述。

- [ ] **1. 写红测试** `test('consumes exact Pi authority once and preserves partial installation')`：wrong archive/selector/carrier/根身份在消费前失败；同nonce第二次拒绝；注入写入失败后保留不完整现场，不标complete、不清理claim、不补跑。
- [ ] **2. 确认失败** 运行`node --test test/pi-install.test.js`，应缺Pi生命周期支持。
- [ ] **3. 实现固定事务** 复用`publishNativeChatFiles`、`writeNativeChatFile`和authority私有耐久机制；在authority中按精确plan身份分派两套validator，不接受任意validator回调。新增`pi-install-plan`、`pi-install-approval`、`pi-sensitive-action-decision`、`pi-conflict-approval`、`pi-install-receipt`subjects及来源。安装仅六文件、规定目录及耐久日志，不跑OpenClaw setup/agents/config命令；实际操作清单决定批准项数，不复制旧“五项批准”。
- [ ] **4. 转绿并核对RF3** 准入receipt须重新核对计划来源、authority消费、根/文件身份、摘要、权限和durable完成状态；手写complete或克隆receipt admission拒绝。运行`node --test test/pi-install.test.js test/native-chat-install.test.js test/native-chat-files.test.js`。
- [ ] **5. 留证** 仅临时合成根，六文件安装成功和故障断言均在本任务完成；不初始化真实Pi authority或状态根。

### Task 6: 原预算、单turn能力与有限诊断

**Files:** Create `src/pi-budget-proxy.js`, `test/pi-budget-proxy.test.js`; Modify `src/native-chat-proxy.js`, `src/course-wiki-budget.js`, `test/native-chat-proxy.test.js`, `test/course-wiki-budget.test.js`（只在需要共享有界诊断或实际sent回调时改预算模块，不改变旧返回字节）。

**Interfaces:** `createPiTurnController({binding,stateRoot,approvedCases}) -> controller`；`controller.admit({caseId,sessionId,turnId,inputDigest}) -> Promise<AdmitResult>`；重复turn只返回现有状态，不签新token。`controller.finish({sessionId,turnId,status,finalEntryId?,causeCode?}) -> Promise<PublicTurn>`只接受completed/failed/interrupted，completed必须已有有效上游完成及最终entry，任意失败关闭批次；`controller.state(turnId) -> Promise<PublicTurn>`只读恢复。
`startPiBudgetProxy({binding,stateRoot,budgetRoot,apiKey,controller}) -> Promise<{port,close}>`只接受固定completion路径和一次turnToken。父子进程经Node自有IPC转发admit/finish/state/stop，不增设HTTP控制服务；能力token只在内存/IPC中传递。复用`validateNativeChatRequest(value,modelProfile)`和`sendBudgetedCompletion`；不改旧OpenClaw请求claim键。
同模块的`createPiBudgetHandler({binding,stateRoot,budgetRoot,apiKey,controller}) -> NodeRequestListener`承担请求处理，start只负责固定listen；本任务测试直接调用handler并替换受控fetch，不启动真实服务。

- [ ] **1. 写红测试** `test('admits one exact case and reserves once across duplicate and crash')`：合成账本上断言一次合法请求差额31分，第二请求/同turn异正文/错误会话/超出批准次数拒绝；只读approvedCases为空，拒绝前零reserve。
- [ ] **2. 确认失败** 运行`node --test test/pi-budget-proxy.test.js`，应缺Pi控制器和绑定验证。
- [ ] **3. 实现最小Pi代理** 单独的Pi HTTP入口复用已有规范化/预算发送，不把OpenClaw binding校验放宽。父进程核对当前获批输入摘要与实际最新user文本，先记received，再create-only claim，再reserve/send；每turn至多一上游，turnToken永不落盘。SDK本地失败也须finish为failed并关闭批次；重启旧turn只恢复状态。
- [ ] **4. 转绿并覆盖RF1/RF5** 运行已先写的具名用例`rejects invalid UTF8 without spending`、`counts 8000 nonBMP and rejects 8001`、`rejects 48KiB or 32-message overflow`、`records only observed status and enumerated cause`；使用含假key/body的异常断言诊断不含样本，2xx协议错与非2xx/网络错可区分。运行本任务及旧proxy/budget测试，余额与旧claim不变。
- [ ] **5. 留证** 测试只有假key、合成账本和受控fetch；实际原账本只作值盲前后核对，绝不用于失败注入。

### Task 7: SDK薄适配、真实会话与turn完成状态

**Files:** Create `src/pi-sdk.js`, `src/pi-session-host.js`, `test/pi-sdk.test.js`, `test/pi-session-host.test.js`。

**Interfaces:** `loadPiSdk({descriptorAdmission,targetPaths}) -> Promise<sdkModule>`，仅受控子进程调用且先验证闭包；`createPiSession({sdk,config,sessionFile,proxyCredential}) -> Promise<{prompt,subscribe,setProxyCredential,abort,dispose}>`，sdk注入只用于内部单元测试，公开CLI不接受module/hook。`createPiSessionHost({stateRoot,binding,sdk,turnClient}) -> Promise<{createSession,listSessions,readSession,submit,events,close}>`遵循Task 3固定接口；`submit({caseId,sessionId,turnId,text}) -> Promise<PublicTurn>`在received耐久登记后返回。turnClient的admit/finish/state与Task 6同签名，经自有IPC通信，不跨进程传controller对象；admitted先`await setProxyCredential(turnToken)`再prompt，existing仅恢复观察，结束后finish再公布terminal状态。

- [ ] **1. 写红测试** `test('requires final message and settled without retrying')`：假SDK按事件序列喂入partial/agent_end/最终message_end/agent_settled；仅正常stop、合法usage、未aborted的最终文本成功，其余failed/interrupted，不因promise resolve或exit0通过。
- [ ] **2. 确认失败** 运行`node --test test/pi-sdk.test.js test/pi-session-host.test.js`，应缺薄适配与状态机。
- [ ] **3. 实现会话** 使用官方ModelRuntime/SessionManager和内存SettingsManager；只注册本地`agentmo-budget` provider。显式关闭所有规定能力；system prompt只取Package，`prompt(text,{expandPromptTemplates:false})`。最终会话上下文只由官方SessionManager创建/恢复，目录/会话ID登记验证和0700/0600检查先于读取。
- [ ] **4. 转绿并覆盖RF2/RF4** `test('restores persisted final response without resubmitting')`与`test('marks uncertain turn interrupted after crash')`分别断言恢复零prompt；只有最终消息及settled后的terminal记录都耐久才恢复completed，缺terminal记录仍interrupted。断言无队列、无默认配置文件读取、两层retry为0、cacheWarming有效值off，材料`/x @file !cmd`保持字面。`noTools='all'`及无资源发现要检查传给假SDK的实际选项。
- [ ] **5. 留证** 这些测试不加载真实SDK，不证明其实际默认行为。固定SDK、实际wire和空闲窗口由Task 11另行批准验证。

### Task 8: 监督进程、公开CLI与环境隔离

**Files:** Create `src/pi-native-runtime.js`, `src/pi-native-cli.js`, `test/pi-native-runtime.test.js`, `test/pi-native-cli.test.js`; Modify `src/cli.js`, `src/cli-help.js`, `src/runtime-compatibility.js`, `src/artifact-subjects.js`, `src/artifact-contract.js`, `test/cli.test.js`, `test/runtime-compatibility.test.js`。

**Interfaces:** `preflightPiNative({planAdmission,sourceAdmissions,stateRoot,authorityRoot,targetPaths,budgetRoot}) -> Promise<snapshot>`；`startPiNative({...preflightArgs,apiKey,approvedCases,signal}) -> Promise<{completion,stop}>`；`stopPiNative({planAdmission,stateRoot}) -> Promise<boundedStatus>`。仅父进程调用现有runtime-env加载器；子进程环境白名单不含MINIMAX_API_KEY/其他供应商key/环境文件路径。`runPiNativeCommand(command,args)`接入`pi-target-describe`、`pi-target-admit`、`pi-install-preview`、`pi-install-approve`、`pi-install-apply`、`pi-native-serve`、`pi-native-stop`；authority初始化复用现有私有store机制并单独生成预览，不默认创建。

- [ ] **1. 写红测试** `test('preflights exact sources before consume spawn or env load')`：假spawn/加载器计数；漂移target、Package、receipt、根或预算拒绝时均为0；只读运行尝试submit始终拒绝。
- [ ] **2. 确认失败** 运行`node --test test/pi-native-runtime.test.js test/pi-native-cli.test.js`。
- [ ] **3. 实现监督及命令** 先准入/快照再消费精确激活决策，再启动代理和受控Node子进程；健康只读，不探测供应商。子进程入口是本模块的固定内部模式，不增加任意执行参数；子进程按已绑定路径/digest重新准入来源，不把序列化Admission当真实句柄。IPC只受理自有child的封闭admit/finish/state/stop消息，拒绝未知字段和不匹配requestId。浏览器以cookie调用/api/stop；CLI以独立0600控制记录中的停止能力调用同一路径，该能力只能停止本次身份，不能发送模型请求。等待自有进程自然退出；启动失败停止自有资源、保留现场。
- [ ] **4. 转绿** 用假child/server和假凭据验证环境不继承、未知端口占用/控制身份拒绝、信号中止/失败关闭、不按裸PID停止。每个命令只接受确切digest subjects及适用flags，缺批准只预览/拒绝；保留`--runtime-env-file`唯一公开名称，不增加alias或任意upstream覆盖。
- [ ] **5. 留证** 默认测试无真实SDK、真实key、安装或激活。CLI帮助注明独立Node范围，核心导入路径不加载SDK。

### Task 9: Pi的19类观察与fail-closed交付

**Files:** Create `src/pi-chat-acceptance.js`, `test/pi-chat-acceptance.test.js`; Modify `src/behavior-evidence.js`, `src/delivery-report.js`, `src/native-chat-cli.js`, `src/artifact-registry.js`, `src/artifact-contract.js`, `src/artifact-subjects.js`, `test/delivery-report.test.js`, `test/behavior-evidence.test.js`。

**Interfaces:** `piChatCaseDefinitions(runtime) -> CaseDefinition[]`复用NATIVE_CHAT_CASES的19个固定input/rubric，绑定Pi runtime/会话与source摘要；`validatePiChatAcceptanceArtifact(value) -> {ok,errors}`只处理`pi-native-chat-acceptance`。现有`buildDeliveryReport`按准入Blueprint的native_runtime分派Pi来源集合，报告保留`agentmo.delivery.v1`并显式native_runtime=pi，不能靠外部options改载体。

- [ ] **1. 写红测试** `test('requires all nineteen Pi observations and independent reviews')`：空/缺例、错session、旧OpenClaw结果或错runtime均partial/拒绝；完整合成集的nativeEntryVerified可true，但domainCertified/deliveryReady/productionApproved必须false。
- [ ] **2. 确认失败** 运行`node --test test/pi-chat-acceptance.test.js test/delivery-report.test.js`。
- [ ] **3. 实现来源分派** 精确加载Pi Blueprint、真实archive、activate plan、已准入安装receipt与可选Pi acceptance；依靠Task 4实际快照/消费准入，不信receipt自述。观察只存计数/摘要/有界review，不接收正文或凭据。
- [ ] **4. 转绿并补RF3** 测试重新哈希的旧证据、跨target/session拼接、过期定义/评审、超次数、非正常最终stop和伪live标签。新Pi缺口列表与旧15项分开保留，不能把旧15项清零。运行本任务及旧native-chat acceptance、behavior/delivery测试。
- [ ] **5. 留证** 合成结果只证明报告机制；不得写真实会议助手已通过19类。

### Task 10: 分发闭包、完整离线回归和整批审阅

**Files:** Create `scripts/pi-sdk-conformance.js`, `test/pi-sdk-conformance-contract.test.js`; Modify `package.json`, `src/builder-package.js`, `scripts/node20-core-receipt.js`, `test/helpers/io-surface-inventory.js`, `test/node20-core-lane.test.js`, `test/artifact-surface-coverage.test.js`, `test/builder-package-security.test.js`, `test/package-inspect.test.js`, `README.md`, `docs/MVP_RUNBOOK.md`, `docs/CURRENT_STATUS.md`, `docs/poc/native-chat/acceptance.md`, `release/README.md`, 执行当日release和新evidence记录。

**Interfaces:** npm文件清单和运行闭包包含所有Pi模块及HTML/CSS/客户端资源；SDK依赖在独立工具链中，不静默加入AgentMo核心安装。Node 20 producer只执行无实际SDK的核心契约；真实SDK conformance不进入producer/default check，consumers仍独立。
`runPiSdkConformance({preview,approvedPreviewDigest,targetPaths,workspaceRoot}) -> Promise<boundedResult>`只接受封闭操作预览及对应摘要；这个参数仅绑定预览，不代替本会话的人类批准，也不是AgentMo Plan approval。模拟fetch/端口/病例由脚本固定，不开放任意base-url；导入脚本不启动服务。

- [ ] **1. 写红测试** 在现有库存/打包测试中断言安装包缺任一Pi模块/浏览器资产会失败；Node 20导入核心不解析SDK，Pi command在无toolchain时给有界拒绝。conformance契约用`assert.rejects`验证无批准摘要、漂移目标/工作区/病例时零spawn/零监听。运行所属库存测试及`test/pi-sdk-conformance-contract.test.js`确认正确失败。
- [ ] **2. 闭合库存与受控脚本** 实现固定conformance脚本，但不执行真实SDK；更新精确package文件、语法检查、静态I/O和核心测试归属，不改信任锚。Tasks 4–5完整正向断言必须已通过，不能靠skip或环境标记隐藏Pi欠账。重复聚焦测试转绿。
- [ ] **3. 完成聚焦/组合验证** 运行新增Pi测试、runbook Stage 2契约组及support-triage composed vertical slice；后者用新临时根及声明模式，禁止运行live-success或现有runbook的固定路径清理片段。
- [ ] **4. 冻结并独立整批审阅** 对最终源码/测试/资产清单生成摘要，请独立审阅者核对规格、来源/预算/失败恢复与多余代码；核实重要问题，先加红测试再修，按实际改动重跑。
- [ ] **5. Node 20新证据** 受信工具链若已存在，producer写全新不存在的临时收据，成功后发布其原字节，再跑`test/runtime-evidence-consumers.test.js`。若缺工具链，先给具体工具链预览，不下载或借历史收据越过；更新精确计数/兼容行及release，不将Pi目标运行算作Node 20能力。
- [ ] **6. 完整检查与留证** `npm run check`按既有single-flight运行至自然完成，逐lane记录结果；随后`git diff --check`。锁冲突先核对，不删除未知锁。确认原预算、旧authority/受管文件和来源冻结；无stage/commit/push。
- [ ] **7. 下一道具体预览** 只准备Task 11的工具链安装提案，列真实路径、包闭包/lock integrity、命令与文件操作；未批准前停止实际安装。未达到上述验证时如实列缺口，不宣称离线完成。

### Task 11: 获批工具链安装与固定SDK合成集成

**Files:** 使用Task 10已实现并审阅的`scripts/pi-sdk-conformance.js`；操作证据只写新的私有提案目录及执行当日release摘要，不包含真实key或正文。本任务不补写未经完整检查的新执行代码。

**Interfaces:** 使用Task 10的runPiSdkConformance接口及实际预览摘要。控制侧保存用户的具体批准记录，脚本只在显式获批后运行；默认测试不加载真实SDK。

- [ ] **1. 准备安装预览** 候选package.json/lock可在提案附件中用公开registry元数据生成，不创建实际工具链/node_modules、不执行包代码、不读取npm凭据。固定1.2.0和全部传递integrity，列规范空目录、Node身份、精确`npm ci --ignore-scripts --no-audit --no-fund`操作及环境/缓存位置。需要脚本或新Node时另列精确动作，不默认允许。
- [ ] **2. 等待安装批准** 只有用户批准该具体摘要后执行；失败保留现场、不补跑。观察实际闭包、Node、入口与安装回执，再构建真实Pi descriptor，不从公开tag推断已装字节。
- [ ] **3. 重新核对执行闭包** 核对Task 10冻结的脚本、运行模块、测试结果及安装后descriptor，没有新增或漂移字节；需要改代码时退回所属实现任务，重新验证/审阅/冻结，不在运行批准中夹带修补。
- [ ] **4. 准备并批准集成运行预览** 列出实际固定SDK、合成根、循环端口、假凭据、合成账本、每个模拟case/最大请求数、长空闲观察窗口和鉴权停止；不读取.env或用真实项目预算。未获具体运行批准不启动脚本。
- [ ] **5. 执行固定SDK验证** 订阅实际SDK事件并捕获模拟wire，验证两层retry=0、cacheWarming有效off、无工具/MCP/模板/默认资源/其他联网。成功、401/429/500、超时/断流/畸形响应各最多一次；启动/处理中/settled后及超过固定SDK预热计时窗口的空闲期，额外请求均为0。
- [ ] **6. 留证与失败处理** 观察实际会话创建/隔离/恢复、unicode/总请求/历史界限和最终事件；只留摘要、计数、枚举状态。失败停止自有资源、不补跑；SDK无法满足边界时提出具体规格修订，不能放宽安全校验。
故障注入每例是预览中单列的隔离子批次，预期错误且计数正确才算该边界检查通过；该例资源停止后才能进入下一获批子批次。非预期错误/多发请求停止整个验证操作，不自动重跑故障例。

### Task 12: 新Pi正式来源、实际安装和只读激活

**Files:** 新Pi Need/Discover/Plan/Blueprint/Build Contract/Package和生命周期证据在新的私有工作目录；更新`docs/CURRENT_STATUS.md`, `docs/poc/native-chat/acceptance.md`及执行当日release摘要。

**Interfaces:** 使用Tasks 1–9的公开CLI和真实admissions；每阶段输出原字节摘要供下一阶段准入。操作不复用旧OpenClaw存储身份、批准nonce或回执。

- [ ] **1. Discover到Plan预览** 基于用户确认的Pi/M3 Need、真实来源和缺口生成新快照，列出Discover批准/方向及enter-plan的具体摘要；获批后才登记对应决定和生成正式规划。旧502未知及旧15项缺口保留，新Pi缺口另列。
- [ ] **2. Produce预览** 由正式Plan/Blueprint/Contract和真实SDK descriptor生成具体enter-produce预览；获批后记录对应Plan approval，产生Package、.d42及carrier admission，逐成员复核。
- [ ] **3. 初始化与安装预览** 先展示新authority目录/权限/文件及摘要，获批后初始化；用真实存储身份生成精确Pi install plan，列六文件、目录、命令集合、普通/敏感/空冲突批准和原预算引用。再获安装批准才执行，验证耐久回执与实际快照。
- [ ] **4. 只读激活预览** 列真实端口、Node/SDK/进程身份、环境加载、零模型/零新预留目标及停止路径；获批后运行器仅在父进程内存加载key，启动真实Pi入口，不让助手读取值。
- [ ] **5. 只读浏览器检查** 使用新页面鉴权，核对唯一meeting-text、MiniMax M3、会话路由及发送禁用；启动/登录/刷新/空闲均零模型尝试、零新预留。保存有限观察并鉴权停止；保持服务运行也必须在预览中明确，不默认留后台。
- [ ] **6. 留证** 非完整/失败均保留现场、停止自有资源，不重试或顺带请求模型。到此仍没有付费语义通过或Pi entry-verified结论。

### Task 13: 五次M3与其余14类验收的具体预览

**Files:** 新Pi验收提案/观察/review/acceptance/delivery在私有操作目录；维护`docs/poc/native-chat/acceptance.md`, `docs/CURRENT_STATUS.md`及执行当日release。

**Interfaces:** `piChatCaseDefinitions`、`validatePiChatAcceptanceArtifact`和严格Pi delivery来源，不接受旧OpenClaw case结果；独立评审者只能评实际最终回复，保留摘要。

- [ ] **1. 准备五次预览** 固定首次/更正/注入/新会议/重启后追问，写每条材料摘要、真实会话映射、最多五次/155分新增预留、当时累计余额、一次受控重启、失败停止/不补跑和鉴权停止。先展示再请求批准，不能沿用旧五次或诊断许可。
- [ ] **2. 批准后逐例执行** 每次核对当前绑定、剩余额度和turn状态，浏览器提交一次；出现失败立即停止该批次，独立评审实际已完成回复，不填补后续未执行项。
- [ ] **3. 准备其余14类预览** 使用固定模拟上游及独立会话，逐项列准备历史的操作、最多请求/预留、真实原账本的影响、停止/恢复边界；未批准不执行，不用夹具冒充页面观察，不退款模拟预留。
- [ ] **4. 汇总独立整批审阅** 所有19类的定义/执行/观察/review/source一致才生成完整Pi acceptance；缺项保持partial。最终独立审阅源代码、精确交付和真实证据，不以运行成功取代内容评审。
- [ ] **5. 交付留证** 报告原预算最终值、每个门禁的实际摘要/状态、旧/新缺口及未知502根因；entry-verified也不提升领域/生产状态。不提交或push，除非用户另发明确指令。

## 验证命令与范围

每项命令是后续实施步骤，**不是本次已执行的结果**。
Stage 2组固定为`node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`。
support-triage按`docs/MVP_RUNBOOK.md`的composed vertical demo在新临时根执行声明模式，避免复制固定路径的删除命令。
最终检查为`npm run check`和`git diff --check`；Node 20按producer新收据 → 原字节发布 → post-publication consumers顺序执行。
不在此计划里写含空值/猜测路径的安装或serve命令；真正精确argv、路径、端口、摘要和批准文件只在对应具体预览中给出。

## 自审与执行交接

本计划覆盖规格1–11节：Tasks 1–2、4–5、9实现正式来源，3、6–8实现浏览器/SDK/预算/监督，10完成兼容与整批回归，
11验证真实固定SDK，12–13逐门禁完成当前会议助手的实际交付。RF1–RF5均有具名测试/实际集成对应。
当前未实施、未安装SDK、未创建真实Pi根、未激活/调用模型；批准只覆盖已审阅规格与写本计划。

请用户审阅计划并选择执行方式。建议**当前会话顺序实施（Native）**：共享admission、生命周期和预算接口依赖紧密，
同一实现者更易保持一致；完成后做一次整批独立审阅。也可选逐任务新子代理实施及逐任务独立审阅，成本更高。
选定方式只启动Tasks 1–10；Tasks 11–13仍在每道真实动作前等待具体预览批准，不从本计划批准推导运行授权。
