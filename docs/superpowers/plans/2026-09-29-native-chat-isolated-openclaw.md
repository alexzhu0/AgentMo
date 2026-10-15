# Isolated OpenClaw Native Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the single-implementer execution selected by the approved spec; use superpowers:requesting-code-review for independent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从已批准需求通过正式 AgentMo 工件构建会议文字助手，并在本机隔离 OpenClaw 原生入口完成验收。

**Architecture:** 扩展现有合同/Package/生命周期的显式 native-chat 分支，旧 Linux/plugin 分支不变。复用原生循环和共享预算；新增模块仅承载本机 create-only 文件操作、运行控制与薄代理，不增加通用 harness。

**Tech Stack:** 现有 Node.js ESM、node:test、stdlib、已安装 OpenClaw 2026.9.4；零新增依赖。

**Spec:** [已通过的本机隔离规格](../specs/2026-09-29-native-chat-isolated-openclaw-design.md)。规格“通过”、实施计划“确认”已获用户批准；精确生命周期仍依各自工件批准。

## 当前进度（2026-10-15维护核对）

| 范围 | 实现及离线证据 | 真实执行状态 |
| --- | --- | --- |
| Tasks 1–4：合同、来源、安装和预算 | 已完成；后续M3来源闭包与协议修复纳入最终冻结 | M3源电脑安装complete；预算未新增预留 |
| Task 5：启动/停止/恢复机制 | 已实现，合成SDK及监督进程测试通过 | M3激活和原生页面只读检查未获批；真实会话恢复未验收 |
| Task 6：交付来源、验收合同、发布与审阅 | 已完成；最终五段检查自然exit0，独立审阅无重要问题 | 19类M3真实观察未执行，交付PARTIAL |

下方勾选记录实现或历史验证完成，不代表领域质量、M3真实回复或新的运行授权。
旧DeepSeek首例502及只读页面结果属于旧绑定，不能转成M3成功证据或剩余额度重试许可。
当前M3选择及证据以[后续M3计划](2026-10-14-native-chat-minimax-m3.md)、
[10月14日记录](../../../release/2026.10.14.md)和[当前状态](../../CURRENT_STATUS.md)为准；
跨电脑先按[交接入口](../../handoffs/2026-10-14-cross-computer.md)恢复，不重新实现已经完成的机制。

## Global Constraints

- 复用 `codex/course-wiki` 工作树；实施前重新核对 Git 状态，不覆盖 Course Wiki 历史改动；不 commit/push。
- `execution_profile: "native-chat"` 显式选择；缺省旧行为，未知/null/混合 profile 拒绝。
- 独立状态和回环入口，不修改现有网关、Agent、会话或系统自启动；不安装新 OpenClaw/插件。
- 同 UID 进程/状态隔离不是 OS 沙箱；不放宽原 Linux 事务、文件系统或进程保护。
- 业务工具、插件、RAG、长期记忆、调度、fallbacks 均为空/禁用；不偷偷增加模型循环。
- 最新文字上限 8,000 Unicode 码点；完整 provider JSON 上限沿用 48 KiB，消息数上限 32，输出上限 2,048 tokens；拒绝而非截断。
- 模型沿用 `deepseek-v4-flash`；共享累计 CNY 100 账本，不新建额度；失败不自动付费重试。
- Codex 不读 `.env`；运行器只通过既有 `--runtime-env-file` 入口在内存取值，不保存凭据或原始会话到证据。
- 设计/计划批准不是精确 Plan/Produce/install/activation/runtime 批准。缺少对应工件授权时停在预览，不伪造批准。

## Review Focus

1. 旧插件工件被删字段伪装为 native-chat：所有消费者拒绝，任务 1–3 各有交叉拒绝测试。
2. 8,000 个非 BMP 字符、伪造 Runtime 尾注、历史超限：码点计数正确、不误删正文、拒绝前零花费，任务 4。
3. 第二条正常追问误判重放，或重启后重复扣费：保留完整历史，规范摘要与持久记录共同约束，任务 4–5。
4. 注册成功但启动失败、端口被占、旧 PID 被复用：保留未激活结果，只停自有活进程，不覆盖现有状态，任务 3、5。
5. 页面打开但路由错误、跨会话串会、后台模型请求：真实原生入口逐项验收，不能凭 CLI 回复代替，任务 6。

---

## 批次 A：正式 Package

### Task 1：无插件合同与 carrier 闭合

**Files:** Modify `src/build-contract.js`, `src/package-carriers.js`, `src/package-contract.js`, `src/openclaw-target-admission.js`, `src/artifact-contract.js`; Test `test/build-contract.test.js`, `test/package-carriers.test.js`, `test/package-contract.test.js`, `test/openclaw-target-admission.test.js`。

**Interfaces:** 保留 `buildBuildContract(...)`、`validateBuildContract(value)`、`selectPackageCarriers(buildContract)`、`buildOpenClawTargetCarrierAdmission(options)` 的调用形式；工件新增可选顶层 `execution_profile`。native-chat 分支由已 admitted Blueprint/Plan 共同决定，不能由调用者单独覆盖。
新增内部 `buildNativeChatSpecification(blueprint)`，沿用 specification 的 canonical 顶层键；skills/plugins/memory/rag/schedules 显式 `{enabled:false}`，tools 声明为空且 deny-all，harness owner/runtimeBinding 均为 OpenClaw，loop 无工具/fallback/retry。validator 以同一构造器比对完整值，不放开未知字段。

- [x] 写 `admits native-chat without a recipe and rejects mixed authority`：复用真实 admission fixture；新分支满足以下断言，旧 support-triage 无 recipe 仍失败。
  ```js
  assert.equal(contract.execution_profile, 'native-chat');
  assert.equal(contract.nativePluginRecipe, null);
  assert.deepEqual(contract.specification.tools.declaredNames, []);
  assert.equal(validateBuildContract({...contract, nativePluginRecipe: oldRecipe}).ok, false);
  ```
- [x] 运行上述四个测试文件，确认新增用例因旧 guard/carrier 限制 RED，记录退出码；不把缺 fixture 或环境错误当 RED。
- [x] 实现精确分支：保留 22 类资源完整账本，禁用项不产生可执行能力；`native-runtime` carrier 的 owner 为 `openclaw`，hooks 为空、recipe 为 null、MCP 为 false。manifest/admission 只在一致的 native-chat authority 下接受该变体；旧 owner 和四 hook 规则不变。
- [x] 加入篡改 profile、工具、specialists、recipe、owner、Plan approval 摘要、target descriptor 摘要的负例，全部在写入前拒绝。
- [x] 重跑四文件及 `node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`；要求退出 0。

### Task 2：通用工作区投影与本机 create-only 发布

**Files:** Modify `src/scaffold-files.js`, `src/targets/openclaw-package.js`, `src/package-produce.js`, `src/package-inspect.js`, `src/openclaw-target-descriptor.js`, `src/openclaw-target-admission.js`; Create `src/native-chat-files.js`; Test `test/native-chat-files.test.js`, `test/package-produce.test.js`, `test/package-inspect.test.js`, `test/package-determinism.test.js`, `test/openclaw-target-descriptor.test.js`; extend `test/helpers/package-produce-fixture.js`。

**Interfaces:** `buildOpenClawPackageProjection({buildContract,carrierSelection,targetAdmission,blueprint})` 增加已 admitted Blueprint；从 `buildTargetFiles(blueprint,'openclaw')` 复用必要工作区内容。
`publishNativeChatFiles({root, files}) -> Promise<{members}>` 接受 `{relativePath,bytes,mode}` 数组，仅新建空缺 root 与其成员；`writeNativeChatFile({filePath,bytes}) -> Promise<void>` 仅创建空缺文件。两者拒绝路径逃逸、symlink、hardlink 和覆盖；不承诺跨文件原子事务。

- [x] 写两种不同中文任务的正式打包用例：任务目的/硬失败条件都来自 Blueprint；无 support-triage 固定文案、技能、插件、MEMORY、调度或真实路径/key；相同工件产生相同成员与 archive bytes。
- [x] 写 create-only 负例与中断例：已存在目录/归档、祖先 symlink、成员 `../`、中途失败均不能覆盖他人字节；部分结果不能被安装 admission 接受。
- [x] 运行上述测试文件确认 RED。native-chat fixture 必须走实际工件 writer/admission，仅合成批准留在测试隔离域。
- [x] 实现投影和 stdlib `mkdir`/`open('wx')`/文件与目录 sync 的本机路径。manifest 最后写；归档复用 `buildPackageArchive` 和现有成员校验；只有目录、manifest、archive 校验全完成才返回成功，中断保留未完成目录，不自动删除/续写。
- [x] 将 descriptor/admission/Package 的本机 writer 分支绑定到精确 native-chat profile。旧路径仍要求原 helper/receipt；新分支要求这些 Linux 参数不提供，不制造 trusted receipt。先验证 authority，再选择 writer，CLI 参数不能单独切换安全模式。
- [x] 重跑以上测试和 `test/scaffold.test.js`、`test/package-contract.test.js`；要求退出 0。正式产物可复核但状态仍是未安装、未运行。

## 批次 B：本机绑定、入口与验收

### Task 3：显式本机预览/安装生命周期

**Files:** Modify `src/openclaw-probe-contract.js`, `src/openclaw-probe.js`, `src/openclaw-install-plan.js`, `src/openclaw-install-approval.js`, `src/openclaw-install-receipt.js`, `src/openclaw-install-transaction.js`, `src/cli.js`, `src/artifact-contract.js`; Create `src/native-chat-runtime.js`; Test `test/native-chat-runtime.test.js`, `test/openclaw-install-plan.test.js`, `test/openclaw-install-approval.test.js`, `test/openclaw-install-transaction.test.js`。

**Interfaces:** 现有 probe/install-plan/receipt 增加同名 profile 判别，仍由各原 validator/loaders 验证。native-chat lifecycle 限 `install`、`activate`、`stop`；旧 lifecycle 集合不变，新分支不支持 upgrade/rollback/uninstall。
native target binding 为 `{agentId,stateRootDigest,workspace,agentDir,gatewayPort,proxyPort,budgetReference,targetDescriptorDigest}`，M3另带固定`modelProfile`，全部进入预览摘要。2026-10-09 用户批准以根路径摘要替代持久化的绝对路径；workspace/agentDir 为根内相对目录，运行入口另传实际 stateRoot，并在任何写入或启动前重新核验摘要、路径和目录状态。既有批准函数继续精确绑定整个 plan 与逐项 sensitive action，不把 install 批准扩成 activate。
新增 `probeNativeChatTarget({descriptor,executablePath,probeRoot}) -> Promise<probe>`、`installNativeChat({plan,ordinaryApproval,sensitiveDecisions,conflictApproval,authorityRoot,archivePath,executablePath,stateRoot,budgetRoot,descriptorAdmission,probeAdmission,blueprintAdmission,buildContractAdmission}) -> Promise<receipt>`；probe支持固定M3的可选modelProfile。统一由原公共命令分派，不增加平行创建命令。实际预算路径和真实 admission 用于预检，不能以摘要或复制对象替代；安装和激活都必须提供真实Blueprint/Build Contract准入引用。
2026-10-09 独立消费记录补充已获批准：`createNativeAuthorityStore({authorityRoot,stateRoot})` 仅显式初始化全新记录，返回绑定供 preview 使用；`consumeNativeAuthoritySet({authorityRoot,stateRoot,plan,ordinaryApproval,sensitiveDecisions,conflictApproval})` 只消费完整且有效的批准集合。安装器必须先完成 archive/descriptor/executable/预算等只读预检，再消费，最后才建立 Agent 根或调用注册进程；不得接受调用者伪造的“已消费”结果。当前库实现不等于 CLI 安装交付。

- [x] 写 `native installation rejects stale authority before mutation`，覆盖 archive/profile/descriptor/预算引用/端口/根路径变化；断言旧 approval 失败且调用/写入数为 0。
- [x] 写 `creates one isolated native agent and never patches the host`：fake executable 只接受计划内 argv；断言封闭 HOME/状态/配置、`agents.entries`、独立 agentDir、deny `['*']`、空 fallbacks、retry 0；宿主 config/state 字节不变。
- [x] 运行四文件确认 RED；安装专用模拟测试不可访问真实宿主配置或真实模型。
- [x] 使用 Task 2 文件操作建立私有根；复用已存在的封闭环境/有界子进程处理，不复制 Course Wiki 的 wiki ingest、检索或领域流程。按 2026-10-10 用户批准改为唯一配置 entry + 官方 `setup --baseline --json`，核验配置未改写、`agents list` 唯一 entry 和工作区字节；失败收据不能表示 active。旧 agents-add 批准不能用于新动作。
- [x] probe 使用隔离 HOME 的已核验执行文件做版本/命令兼容检查，明确 `state-process-only` 边界；不输出 Linux fd/containment 成功。发现新版本/不支持字段，fail closed。
- [x] 重跑四文件及 `test/openclaw-probe.test.js`；增加实际已安装 OpenClaw + 合成配置、无模型请求的注册测试。没有旧网关注册、安装插件或系统服务操作。

### Task 4：共享预算薄代理，保留多轮历史

**Files:** Modify `src/course-wiki-budget.js`; Create `src/native-chat-proxy.js`; Test `test/native-chat-proxy.test.js`, `test/course-wiki-budget.test.js`。

**Interfaces:** 从当前 `startCourseBudget` 提取并复用同一发送逻辑：`sendBudgetedCompletion({root,budgetReference,apiKey,request,deadline,signal}) -> Promise<{body,contentType,usage,actualModel}>`；旧代理改用它且保持旧测试行为。新路径必须是 project budget reference，不能使用 legacy 额度。
`validateNativeChatRequest(request) -> {request,requestDigest}` 保留完整验证后消息顺序，返回规范 JSON 摘要；`startNativeChatProxy({binding,stateRoot,budgetRoot,apiKey,token}) -> Promise<{port,close}>` 只监听批准的回环端口。实际根路径按已批准的 digest-only 绑定另传并校验；安装器创建私有 claim 目录，代理不得补建缺失状态。

- [x] 写 `keeps history and rejects invalid input before spend`：8,000 个码点可接受，8,001/空/未知结构/48 KiB 超限拒绝；历史 assistant 消息保留，伪造 Runtime 尾注不被截掉。对安装版本真实生成的 envelope 固定正负例，不用宽泛 regex 删除正文。
- [x] 写并发与重启用例：同一规范请求仅一次上游；第二条带历史的正常追问可调用；崩溃后的 pending/失败占用不退款、不重发；额度不足零网络。
  ```js
  assert.equal(upstreamCalls, 1); // duplicate deliveries, including restart
  assert.equal(after.projectReservedFen - before.projectReservedFen, 31);
  assert.deepEqual(forwarded.messages, validated.request.messages);
  ```
- [x] 运行两文件确认 RED；上游仅本机模拟，不加载真实 key。
- [x] 复用当前 31 分预留与 CNY 100 总账本。请求先验证，再独占写摘要标记并 sync，再预留预算并 sync，最后发一次网络请求；标记后崩溃宁可拒绝重发，不能靠清理文件恢复花费权限。摘要包含绑定身份、模型/参数和完整消息序列，不存正文。
- [x] 每请求 deadline 90 秒、上限 120 秒；无工具/附件/非文本角色，输出上限 2048、thinking disabled、无 fallback；响应限制与 usage 验证沿用原实现。429/500/超时/断流只返回有界错误及 `x-should-retry:false`，无 provider body 诊断。
- [x] 重跑两文件及 `test/course-wiki-gateway.test.js`；要求退出 0，并断言 native-chat 无法另初始化预算或改变上游地址。

### Task 5：原生聊天入口、停止与恢复

**Files:** Modify `src/native-chat-runtime.js`, `src/cli.js`, `src/runtime-plan.js`, `src/run-state.js`; Create `src/native-chat-cli.js`; Test `test/native-chat-runtime.test.js`, `test/native-chat-cli.test.js`, `test/runtime-plan.test.js`。

**Interfaces:** `startNativeChat({plan,ordinaryApproval,sensitiveDecisions,conflictApproval,authorityRoot,archivePath,executablePath,stateRoot,budgetRoot,descriptorAdmission,probeAdmission,blueprintAdmission,buildContractAdmission,installReceipt,apiKey}) -> Promise<{entry,stop,completion}>`校验activate plan；可选signal用于取消。`stopNativeChat({plan,stateRoot}) -> Promise<{stopped}>`只通过私有认证控制通道请求正在持有ChildProcess handles的监督进程停止。
新公共操作仅 `openclaw-native serve` / `openclaw-native stop`；前者消费精确 plan/approval/decisions/install-receipt 路径及摘要，使用现有 `--runtime-env-file`，后者消费同一绑定。不另建 Discover/Plan/Produce 流程；CLI 解析放独立模块，主 CLI 仅分派。

- [x] 写 fake native gateway 测试：代理先启、独立 gateway 后启；绑定回环、正确 Agent/session、token 不进 URL/输出，缺任一批准不启动；既有端口占用时零接管。
- [x] 写停止/故障测试：注册成功但 gateway 失败只停止本次子进程；监督进程失联后不能仅凭 PID 杀进程；未知状态拒绝自动恢复，保留明确失败结果。
- [x] 运行三文件确认 RED；实施批准范围内的监督进程、0600 本地 token、只含脱敏 entry 的返回值。常驻模式阻塞并持有句柄，不创建后台系统服务。
- [x] 配置 heartbeat/cron/hooks/memory/skills 禁用、retry 0、有效工具为空；真实 OpenClaw 加模拟上游跑 429/500/超时/成功追问，断言失败每次至多一个上游请求且不会后台花费。
- [ ] 经原生 UI 验证两次成功对话与新会话隔离；原生 UI 无法满足 8,000 字符边界、重试控制或无工具条件时记录失败，不用另建 UI 替代或自动放宽规格。
- [ ] 重启只复用精确 install receipt、工作区与账本；旧会话恢复，新会话不继承上一会议。机制与合成SDK测试已通过，M3真实原会话恢复仍待批准验收。

### Task 6：可复现验收、证据与交付

**Files:** Create `test/native-chat-acceptance.test.js`, `docs/poc/native-chat/acceptance.md`; Modify `src/delivery-report.js`, `src/behavior-evidence.js`, `package.json`, `scripts/node20-core-receipt.js`, `test/helpers/io-surface-inventory.js`, `test/node20-core-runner.test.js`, `test/runtime-evidence-consumers.test.js`, `docs/MVP_RUNBOOK.md`, `docs/CURRENT_STATUS.md`, `release/README.md`, 当日 release record；Test `test/delivery-report.test.js`, `test/behavior-evidence.test.js`, `test/artifact-surface-coverage.test.js`。

**Interfaces:** 复用 `buildBehaviorCaseResult(configuration)` 和 `buildDeliveryReport(blueprint,options)`；native-chat 的 ready 需精确 package/install/runtime/case evidence，不因为旧 support-triage 或 Course Wiki 通过而 ready。诊断不包含正文、token、provider 原始输出。

- [x] 写 `native delivery stays partial until exact entry cases pass`：mock-only、失败用例、错 Agent/version/session、缺少 restart/输入/预算证据均非 ready；只有同一工件版本的完整受限验收可报告已交付。
- [x] 固定合成会议：陈明负责周四提交设计；测试负责人未定；预算未决。验证四类输出、未知值“未说明”，再纠正负责人；加入注入、空/超限、模型失败、重启和新会话用例。mock 只验证控制面，不当真实语义评分。
- [x] 先跑 `node --test test/native-chat-acceptance.test.js test/delivery-report.test.js test/behavior-evidence.test.js test/artifact-surface-coverage.test.js`，确认 RED，再实现证据绑定/准入，重跑至退出 0。
- [x] 同步 npm 发布闭包、精确 I/O owner 清单、Node 20 owned syntax/core 文件；旧标准和 trust anchor 不变。新增 native fake-upstream 测试显式禁用真实环境秘密。
- [x] 按 runbook 重跑 Stage 2 五文件集合和 support-triage 组合用例；旧领域输出与授权边界保持原样。
- [x] 用 `npm run check:core:node20 -- --node-bin <verified-node> --archive <verified-archive> --checksums <verified-checksums> --expected-version <policy-version> --expected-arch <policy-arch> --receipt <new-absent-receipt>` 生成新收据；参数由 repo-owned trust policy 与实测路径填入，不猜测或覆盖锚点。成功后发布原字节，跑 `node --test test/runtime-evidence-consumers.test.js test/runtime-compatibility-seams.test.js`，记录 SHA、manifest digest、counts、退出码。
- [x] 跑一次完整 `npm run check`（允许隔离测试回环端口）和 `git diff --check`，记录五段精确结果；不并发启动多次全量检查，不删锁。仅有文档收尾变更时补文档测试；源码再变则补相应验证，不复用旧结论。
- [x] 独立审阅整批显式改动，修复确认的问题并复测；留存 finding→修改→证据映射，不触碰无关脏改动。
- [x] 输出真实演示的精确Package/安装/激活/运行预览并执行批准匹配检查；M3安装已获批完成，激活及模型调用仍待各自批准。此项完成的是预览与门禁，不是后续真实验收。
- [ ] 最终从原生聊天页完成全部真实验收，记录入口、Agent ID、脱敏计数、实际模型及限制；交付名称、入口、例子、停止/恢复说明。任一关键项失败保留 PARTIAL，绝不让用户替代基础验收。

## 自审与执行交接

- 规格正式工件由任务 1–2 覆盖；本机生命周期由任务 3、5 覆盖；预算/输入由任务 4 覆盖；真实入口与质量由任务 6 覆盖。
- 五项 Review Focus 都有明确所属测试；没有占位工具、第二个模型循环、共享宿主写入或默认付费动作。
- 串行依赖为 1 → 2 → 3，4 只复用预算可独立验证，5 消费 3+4，6 汇总；仍由一个实施者执行，避免并行争改合同。
- 推荐按已批准规格保留“当前 session 单实施者 + 独立只读审阅”。计划审阅通过后使用 executing-plans 开始；无需重开多个重复 session。
- 没有 commit 步骤。计划中的生产批准检查是实际运行前的门禁，不是新的泛化设计讨论。
