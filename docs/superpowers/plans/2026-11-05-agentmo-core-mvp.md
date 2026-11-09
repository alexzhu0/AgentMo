# AgentMo Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 本会话已选择顺序实施、最后整批独立审阅，执行时使用executing-plans；不按任务提交或push。

**Goal:** 从明确需求和授权文字资料，经Discover → Plan → Produce生成并交付可实际使用的单个Pi CLI Agent。

**Architecture:** Codex组织已有工件生产路径，Pi保留原生provider和SessionManager。新增薄CLI和逐请求控制；每次批准请求使用新的现有激活计划，沿用精确输入、单次消费和预算约束。CLI保留会话选择，底层按请求启停，不增加热更新授权协议。

**Tech Stack:** 既有Node.js ESM、node:test、固定Pi SDK1.2.0和MiniMax M3；Node内置https/readline/stream，无新依赖。

**Spec:** [2026-11-05-agentmo-core-mvp-design.md](../specs/2026-11-05-agentmo-core-mvp-design.md)。用户已批准仅写计划；批准时原字节摘要`sha256:bad685bf419ccb81d66cfb6d5f206499140cbb0b42c7b71dae54338b4c0ee69d`，确认项`call_s6N1DQhizgKuLpFOwCp8WLZe:0`。不修改该已批准版本。

## Global Constraints

- 仅本机单用户、单Agent、文字输入输出、零业务工具；Codex构建，Pi原生执行。会议助手方向停止，旧根、旧批准、旧失败不复用为新Agent的授权。
- 本计划待审阅。获批后的Tasks1–6仅源码、文档和全新临时合成夹具；不读取真实.env/密钥、不导入实际SDK、不安装或激活真实Agent、不外联或调用真实模型，不提交或push。
- 原累计4836分本地预留、10000分上限和全部失败现场保留。合成账本独立；真实操作前只读复核原账本，差异使预览失效，不覆写或退款。
- 固定SDK版本、原生MiniMax provider和会话机制不换；父运行器才可在运行获批后内存加载Key，SDK只接收一次性本地代理凭据；禁用工具、扩展、预热、自动压缩、回退和自动重试。
- `--runtime-env-file`仍是唯一公开环境文件选项；只传路径，CLI预览不得读内容。Node20发行信任策略、兼容性选择器和既有证据认证边界不改。
- 输入沿用8000 Unicode码点；完整请求48KiB/32条消息、输出2048 tokens、供应商90秒上限不放宽。超限明确拒绝，不能截断；完整wire在代理预留前最终校验。
- 复用已有工件、准入、批准和消费Schema；CLI预览是当前进程内的组合视图，不是新的Agent定义、授权Schema或可跨进程伪造的许可。
- 合成传输只在测试中替换网络底层；生产代码不增加任意endpoint、request函数、代理或CA覆盖参数。合成测试允许本机假端点，拒绝所有真实供应商请求。

## Review Focus

1. 拒绝、EOF、排队粘贴的“yes”和过期确认：不启动SDK、不读Key、不消费批准、不预留。Task4/5用当前预览随机确认码测试。
2. 文件替换、符号链接、禁读路径、非BMP和多行文字：捕获的文本摘要必须匹配实际发送字节，错误在发送前可见。Task1/5覆盖。
3. 供应商超时、重定向、错误状态、坏SSE、断流和不完整清理：一次尝试，保留原失败与预留，CLI退出。Task2/3/4覆盖。
4. 错Agent、错会话、来源/版本漂移和未知SDK历史：拒绝恢复，不迁移或修补旧文件；追问必须继续同一会话。Task4/6覆盖。
5. 新模块未打包、假回复冒充真实或证据范围被扩大：公开入口在打包后可解析，离线证据不能宣称可用或关闭旧全面验收缺口。Task6覆盖。

## 文件和接口

现有生产文件按任务修改：`scaffold-files.js`、`course-wiki-budget.js`、`pi-native-runtime.js`、`pi-native-cli.js`、`pi-chat-server.js`、`cli.js`、`cli-help.js`、`artifact-subjects.js`。新文件仅四个职责：

| 文件 | 职责 |
| --- | --- |
| `src/pi-upstream.js` | 固定M3端点的单次原生HTTPS POST，返回标准Response流 |
| `src/pi-cli-client.js` | 内存鉴权、会话API、单次POST与GET观察，不重发 |
| `src/pi-cli-run.js` | 已安装工件准入、精确预览、确认、一次运行与自有清理 |
| `src/pi-chat-cli.js` | 终端输入、资料读取边界、显示预览/回复和会话命令 |

共用名称：`Ref={filePath,expectedDigest}`；`InstalledSourceFiles`是现有`sourceFiles`去掉`activationPlan`后的8项；`Installed`为`{sourceAdmissions,sourceFiles:InstalledSourceFiles,stateRoot,authorityRoot,targetPaths,budgetRoot}`。其中`targetPaths={sdkRoot,nodeExecutablePath,lockFilePath}`，sourceAdmissions由Task4只读加载，其余路径由CLI严格解析。所有新生产文件进入npm files/check与现有I/O清单；`src`源码闭包由现有descriptor重新观察，不增设信任锚。

## Task 1：由需求生成Pi职责

**Files:** Modify `src/scaffold-files.js:443`；Test `test/pi-package.test.js`、`test/pi-native-planning.test.js`；Create `test/helpers/core-mvp-fixture.js`及`test/fixtures/core-mvp/`下两套`*.need.json`、`*.discovery.json`、`*.md`。

**Interfaces:** 保留`buildPiSystemPrompt(blueprint): string`。新测试助手`withCoreMvpFixture(t, profile, fn)`提供临时`root/sourceRoot`、新manifest/DB/need准入及`designPlan/blueprint`；profile只取`field-extractor`或`rule-labeler`。复用公开生产器和`admitValue/withPiTargetFixture`，不导入真实SDK。

- [ ] 写`generates distinct Pi duties from two approved needs`失败测试：A需求只提取Product/Deadline并输出JSON，未知填null；B按给定规则输出A/B/未定。两套来源文字和需求都使用自己的合成ID，不复制会议或客服业务内容。
  ```js
  assert.match(promptA, /field-extractor/);
  assert.match(promptA, /Product/);
  assert.match(promptB, /rule-labeler/);
  assert.notEqual(promptA, promptB);
  assert.doesNotMatch(promptA + promptB, /会议文字助手|会议摘要、决策、行动项/);
  ```
- [ ] 运行`node --test test/pi-package.test.js test/pi-native-planning.test.js`，记录当前固定会议提示导致的RED。
- [ ] 从现有`agent_id`、`domain_genome.domain/purpose/task_classes/hard_failures`生成身份、任务、格式要求和边界；保留通用材料指令隔离/未知不编造/禁止工具规则。不新增schema；不得把knowledge_sources的ID或声明字段当作已注入知识。构建资料用于来源与规划，任务事实由当次CLI文字或文件提供；不承诺常驻知识库。
- [ ] 重跑至GREEN；保留OpenClaw分支与历史夹具。新夹具成功清理，失败保留临时根和日志供复核。

## Task 2：最小M3 HTTPS传输

**Files:** Create `src/pi-upstream.js`、`test/pi-upstream.test.js`、`test/helpers/pi-https-fixture.js`；Modify `src/course-wiki-budget.js`及`test/pi-budget-proxy.test.js`、`test/pi-native-provider.test.js`、`test/pi-session-host.test.js`、`test/pi-review-regressions.test.js`中的原生上游stub。

**Interfaces:** `postPiMessages({body,apiKey,signal}): Promise<Response>`；固定`POST https://api.minimax.cn/anthropic/v1/messages`、证书校验开启、无重定向/重试。返回的Response只带实际status、content-type和响应流，供现有budget消费。测试助手`stubPiUpstream(t, handler)`在ClientRequest边界模拟IncomingMessage，保留真实预算/turn控制器。

- [ ] 写`dispatches one bounded native HTTPS request after reservation`及`preserves failures without retry or secret output`两个RED测试组：固定方法/目标/Anthropic头、准确body长度；预留先于dispatch；503/429/401/302、头前及流中abort、>1MiB和断流都只尝试一次，原始异常和合成Key不进入公开错误。
  ```js
  assert.equal(calls, 1);
  assert.equal(requestedUrl, 'https://api.minimax.cn/anthropic/v1/messages');
  assert.equal((await f.summary()).projectReservedFen, 31);
  assert.equal(publicFailure.includes('SYNTHETIC_KEY_MARKER'), false);
  ```
- [ ] 运行`node --test test/pi-upstream.test.js test/pi-budget-proxy.test.js`记录RED。测试入口拒绝未stub的真实上游；不要用真实域名请求来“确认测试”。
- [ ] 用Node `https.request`和`Readable.toWeb`实现单次流；父进程Key只在请求头，取消和响应终结释放请求/监听器。`sendBudgetedCompletion`仅原生`anthropic-messages`分支使用它，旧非原生路径不动；继续复用1MiB读取、实际HTTP状态和安全错误码映射。
- [ ] 改用公共测试stub后运行`node --test test/pi-upstream.test.js test/pi-budget-proxy.test.js test/pi-native-provider.test.js test/pi-session-host.test.js test/pi-review-regressions.test.js test/course-wiki-budget.test.js test/native-chat-minimax.test.js`至GREEN。

这是基于已观察HTTPS控制响应的最小绕行候选，不是已证实的fetch根因修复；真实M3 POST仍须后续批准验证。保持单一路径，不加入fetch回退、换域名或多provider框架。

## Task 3：公开可复用的CLI传输

**Files:** Create `src/pi-cli-client.js`、`test/pi-cli-client.test.js`；Modify `src/pi-chat-server.js`、`test/pi-chat.test.js`。

**Interfaces:** `connectPiCli({accessFile,port,mode,caseSpec}): Promise<Client>`，mode为`create-session`或`turn`；前者caseSpec为null，后者为当前plan唯一approvedCase。Client提供`listSessions()`、`createSession()`、`submit({caseId,sessionId,turnId,text})`、`close()`。成功Reply为`{sessionId,turnId,status:'completed',replyText,replyDigest}`；创建会话返回`{id}`。失败抛出仅含白名单`code/upstreamStatus?/upstreamNetworkCode?`的错误，不附正文。仅使用计划内127.0.0.1端口。

- [ ] 写`submits exactly one matching turn and never reposts while polling`及`rejects mismatched or failed public turns`两个RED测试组：只在内存读取当前激活的0600登录文件并换Cookie；`create-session`最多一个POST且禁止模型提交，`turn`最多一个POST且禁止创建会话。GET轮询不会重发；路由/session/输入摘要/turn不符、failed或interrupted立即失败。
  ```js
  assert.equal(turnPosts, 1);
  assert.equal(sessionPosts, 0);
  assert.equal(reply.replyDigest, digest(reply.replyText));
  assert.equal(logs.includes(accessSecret), false);
  ```
- [ ] 运行`node --test test/pi-cli-client.test.js test/pi-chat.test.js`记录RED。
- [ ] 复用旧私有CLI脚本的已验证登录/提交/观察结构，改为任意一个已批准case，去掉“五条固定材料”前提。共享`validatePiPublicTurn`允许的失败码/HTTP状态/网络码可返回给本机CLI，不扩大返回字段，不暴露capability或raw error。
- [ ] 重跑至GREEN，覆盖所有异常后close清Cookie、取消GET，不能自动POST第二次。

## Task 4：逐请求批准与原生会话

**Files:** Modify `src/pi-native-runtime.js`；Create `src/pi-cli-run.js`、`test/pi-cli-run.test.js`；Test `test/pi-native-runtime.test.js`、`test/pi-install.test.js`、`test/pi-chat-acceptance.test.js`中的既有批准消费回归。

**Interfaces:** 提取`loadPiInstalledSources({sourceFiles:InstalledSourceFiles,stateRoot,authorityRoot}): Promise<{sourceAdmissions}>`加载上述8项，不导入SDK；`loadPiNativeSources`复用它再加载activationPlan，原行为不变。新增：
- `preparePiCliRequest({installed,kind,sessionId,text,ports,runtimeEnvFile}): Promise<Preview>`，kind为`create-session|turn`；只读，返回当前进程内品牌化Preview及显示字段`previewDigest/confirmationCode/agentId/sessionId/inputDigest/inputCodePoints/maximumNewReservedFen/effects`。runtimeEnvFile仅为路径，turn必需、create-session禁传；路径及其使用边界进入预览摘要，不读内容。
- `runApprovedPiCliRequest({preview,confirmation,signal}): Promise<Result>`；确认必须匹配当前随机确认码和摘要，原始文字/plan/环境文件路径保存在进程内，不接受克隆或反序列化的Preview。获批后才将路径转交父运行器。Result为`{status,sessionId,turnId?,replyText?,replyDigest?,failureCode?,newReservedFen,cleanup}`，status取`created|completed|declined|failed`，sessionId在尚未创建时为null，cleanup为`{status:'not-started'|'stopped'|'failed'}`。

- [ ] 写`requires a fresh preview before every activation and turn`及`resumes only the admitted Agent session`两个RED测试组：拒绝、过期确认、改字/改session/克隆预览、预算或来源漂移时，SDK/Key/批准消费/预留/受管写入均0。每次turn新activationId，approvedCases恰好一项`cli-turn`，restartAllowance为0；不得改动运行中approvedCases或复用nonce。
  ```js
  assert.deepEqual(effectsBeforeConfirmation, []);
  assert.notEqual(firstPlan.activationId, secondPlan.activationId);
  assert.equal(secondPlan.approvedCases.length, 1);
  assert.equal(totalNewReservations, 2); // 两个合成成功请求
  ```
- [ ] 运行`node --test test/pi-cli-run.test.js test/pi-native-runtime.test.js`记录RED。
- [ ] `prepare`重验安装/版本/授权存储/预算，只构造现有激活计划与5分钟有效的随机确认码；确认时重验，过期仅取消。确认后才在Agent的`attempts/cli-<activationId>/`以0700/0600/create-only落盘现有plan及ordinary/sensitive/conflicts三类批准，逐项对应现有sensitiveActions并用新nonce，调用原`startPiNative`。使用Task3的`connectPiCli`发送本计划唯一允许的操作。
- [ ] `create-session`使用空approvedCases的只读激活：不传runtime-env-file、不读Key，通过Task3只创建一个空会话后停止。`turn`必须选择已登记会话，在同一精确激活/请求预览里列SDK、端口、父进程Key边界和31分新增预留上限；用户确认后才加载Key并提交一次。
- [ ] 用返回的本次`live.stop()`句柄清理并保留原stop/completion结果，不能猜PID或重发失败停止。只有完整成功且清理确认后返回CLI输入；任何失败/中断/清理不明均退出，不自动再次运行。沿用现有300秒ready、90秒供应商、300秒stop边界，不因等待I/O扩期限。
- [ ] GREEN覆盖新会话隔离、持久会话恢复、未知SDK历史拒绝不修补、原日志前缀保留、单次消费、双请求合成账本只增62分、故障消费31分不退。实际SDK一律使用fakePiSdk，不导入已安装工具链。

## Task 5：用户TTY入口

**Files:** Create `src/pi-chat-cli.js`、`test/pi-chat-cli.test.js`；Modify `src/pi-native-cli.js`、`src/cli.js`、`src/cli-help.js`、`src/artifact-subjects.js`、`test/pi-native-cli.test.js`。

**Interfaces:** `runPiChatCli({installed,sourceRoot,runtimeEnvFile,ports,io})`；ports为`{chat,proxy}`，io提供`readLine()/write()/isTTY`。`readPiCliText({sourceRoot,relativePath})`返回冻结`{text,contentDigest,identity}`；identity记录用于复核的dev/ino/birth/size/mtime/ctime/nlink。使用Task4两个请求函数；公开命令名为`agentmo pi-chat`。

- [ ] 写`requires fresh TTY confirmation for pasted and file text`及`rejects forbidden or replaced files before reading`两个RED测试组：拒绝非TTY与`--json/--yes/--approve-all`；`/sessions`、`/use <UUID>`只读取本Agent登记元数据；`/new`执行Task4只读会话预览；单行、`/paste`至`/end`和`/file <relative.txt|md>`产生同一个明确文本。资料中的yes或旧确认码不能发送。
  ```js
  assert.equal(modelCallsBeforeFreshConfirmation, 0);
  assert.equal(sentText, frozenPreviewText);
  assert.equal(forbiddenFileReadCalls, 0);
  assert.equal(replyShown, actualReplyText);
  ```
- [ ] 运行`node --test test/pi-chat-cli.test.js test/pi-native-cli.test.js`记录RED。
- [ ] 采用`node:readline`，显示当前Agent/版本/session、发送范围和成本，再要求新生成的确认码；每次确认后废弃该码。`/paste`中的命令作为文字，只有独立`/end`结束，`//end`表示字面`/end`。EOF/拒绝取消；Ctrl-C只停止本次自有资源。
- [ ] 文件只允许已声明sourceRoot内普通.txt/.md；打开前拒绝.env前缀、认证/登录/控制文件、.agentmo/.superpowers以及sessions/turns/attempts路径。复用现有路径/no-follow/有界读取，非法UTF8或8001码点拒绝；确认时复核元数据身份，变动使预览失效，不能重读替换内容。运行事实由当前输入提供，不增加隐式检索或常驻知识库。
- [ ] 新命令复用`pi-native-serve`的8项已安装source flags、target-root/authority-root/budget-root/sdk-root/node-executable/lock-file及摘要；增加显式source-root/chat-port/proxy-port，保留唯一`--runtime-env-file`。不接收activationPlan或旧运行批准作为“免确认”入口，不增加并行launch manifest。Codex从既有工件组装完整启动命令，用户不手工拼摘要。
- [ ] GREEN覆盖空/8000/8001非BMP、多行、文件替换成符号链接、未知会话、同会话追问和退出。空输入不启动或预留；普通TTY初始化/列会话不导入SDK、不读密钥。入口帮助可在Node20读取，实际SDK操作继续使用既有Pi Node版本门禁。

## Task 6：三阶段闭环、打包与交接

**Files:** Create `test/core-mvp.test.js`、`docs/CORE_MVP_RUNBOOK.md`；Modify `test/helpers/core-mvp-fixture.js`、`package.json`、`test/helpers/io-surface-inventory.js`；更新`README.md`、`docs/CONCEPT.md`、`docs/MVP_RUNBOOK.md`、`docs/CURRENT_STATUS.md`、`docs/handoffs/README.md`及当日release。

**Interfaces:** Task1夹具继续提供相同source/admissions；集成测试用既有build contract、Plan approval、Pi carrier admission、package生产与检查API，不手改成品。文档由当前Codex按既有公开CLI组织流程，不新增常驻自然语言服务或另一套Builder。

- [ ] 写`builds distinct Pi packages through Discover Plan Produce`及`uses the public CLI with isolated native sessions`两个RED测试组：两套新需求分别走来源→Plan→Blueprint→Contract→Package；Pi职责不同。A在合成安装/SDK/上游下经公开CLI完成首问、追问、新会话和恢复；B只验证生成。篡改need/包/安装回执/session/源码绑定时，调用数和新预留为0；缺字段与材料越权指令进入固定验收定义，离线只证明传递/校验，不冒称模型会遵守。
  ```js
  assert.notEqual(packageA.systemPrompt, packageB.systemPrompt);
  assert.equal(exercisedPublicCommand, 'pi-chat');
  assert.equal(originalRealBudgetTouched, false);
  assert.equal(offlineEvidence.liveSuccess, false);
  ```
- [ ] 运行`node --test test/core-mvp.test.js test/cli-mvp.test.js test/stage-contracts.test.js`记录RED。
- [ ] 补最少的公开命令连接/资料传递，默认拒绝外联，保留原工件准入和每阶段批准。完善从新需求开始、产物位置、启动、逐次确认、退出/恢复的runbook；不要拿私有.sdd脚本作唯一产品入口。
- [ ] 将四个新生产模块加入npm files和syntax checks，按实际AST更新I/O归属，验证打包包含它们及原Node20兼容门禁；不修改发行信任策略。既有浏览器资源只保留兼容，不新增浏览器验收任务。
- [ ] 运行集成至GREEN；用已有`buildBehaviorCaseResult/domain-eval`记录固定案例的有限检查，不另建评测平台。旧19类全面验收、来源缺口和认证义务不删减；若既有delivery-report仍为partial，原样报告，不把核心MVP有限证据改成全量entry/domain/production认证。
- [ ] 按下节最终检查，做一次整批独立审阅，修复相关问题后冻结新源码/包与测试结果。只准备具体安装及后续运行预览；所有真实Agent根和新增真实批准消费仍保持未创建/未发生，直至相应批准。

## 最终离线检查与自审

全部命令仅在未来获批实施时运行；本次写计划不执行：

- 受影响组：`node --test test/pi-upstream.test.js test/pi-cli-client.test.js test/pi-cli-run.test.js test/pi-chat-cli.test.js test/core-mvp.test.js test/pi-*.test.js test/native-chat-files.test.js test/native-chat-minimax.test.js test/course-wiki-budget.test.js`。
- Stage2/三阶段：`node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/blueprint.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js test/cli-mvp.test.js`；按MVP_RUNBOOK保留support-triage机制回归，不能恢复会议业务线。
- 闭包/文档：`node --test test/artifact-surface-coverage.test.js test/command-docs.test.js`；`npm run check`；`git diff --check`。新模块还须通过打包成员检查。
- 测试均在独立临时合成根和注入传输/本地假端点运行；相关失败修复，非本变更的全仓阻断具名保留，不扩修Builder或伪称全量通过。原真实账本、旧失败目录、旧批准字节和未消费状态做只读前后核验。
- 自审覆盖：生成→T1/T6；实际入口/追问→T3/T4/T5/T6；恢复隔离→T4/T6；所有负向与成本→T2–T6；五项Review Focus均有归属。接口名称沿本文件一致，不留未定义的相邻任务API。
- 实施方式沿用本会话顺序执行，完成后只做一次整批独立审阅；阶段提交、push、删除旧代码/失败现场均不在授权内。

## 后续真实门槛：仅列计划，不是当前授权

1. **精确安装预览**：代码冻结后按真实target descriptor及新Package观察身份，生成新Agent的精确安装计划。可读观察既有合法批准存储，但旧决定不转借；使用新nonce并在预览列明新增消费。不得为省步骤虚构尚未产生的安装回执或目录身份。
2. **CLI只读激活预览**：安装成功后绑定真实回执，明确SDK/回环端口、一个新空会话和自有停止；Key读取0、模型0、新预留0。需要的实际SDK观察可纳入这次具体预览，不默认重跑旧长时批次。
3. **真实模型请求预览**：不再做付费连通性POC，首个真实请求就是A任务。拟选固定材料为`Product: Atlas`，预期`{"Product":"Atlas","Deadline":null}`；针对实际回复的追问文本在看到回复后再预览确认。新会话用不含字段值的合成越权指令，要求保持既定格式且字段为null，同时检查缺资料、不串会话和注入隔离；之后停止/恢复原会话再追问。具体文字与独立评判规则逐项写入运行预览，不能仅由提示字符串测试断言模型通过。
4. 预览逐项列调用数与保守预留；拟定整组最多4次、最多新增124分，但不得提前批准未知追问或视作已获授权。基于当前4836分，若期间账本未变化，4次后累计最多4960分；执行前重核，以实际账本为准。供应商账单仍按token计费，此处仅本地授权预留。
5. 任一步失败停止、不补跑；保存真实机械数据并由独立上下文评审实际规范化回复。公开证据不含原始供应商响应、原生会话、Key或控制能力。只有规定的真实CLI任务/追问/隔离/恢复均通过，才可报告本版本的有限可用性。

本计划未授权任何上述真实步骤，也未证明出网候选方案或完整MVP已成功。
