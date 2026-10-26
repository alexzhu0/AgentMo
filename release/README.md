# AgentMo Release Records

2026-10-26 发布说明：下列历史证据链接已改指公开脱敏副本；历史摘要仍指保留的本机原件，原件与副本摘要见 release/evidence/2026.10.26-publication-map.json。脱敏不代表重新运行或重新审阅。

2026-10-23 初版离线交付已收口：按用户“尽快完成初版、不要无限coding”的当前指令，未改产品源码，重建当前环境的正式Plan来源并通过公开生产器生成Pi Package及.d42归档，目录和归档检查通过。源码继续冻结8ba314…；manifest sha256:56dbc45103027d0cd1495b5cf06f2a99af4a233f1ccf214669e1bddfd4094354，归档sha256:9e6f392b407cab05615d9ee5184d82d6a122ff9cfe69adbd37c008442074f3d7。不再扩功能或追跑无关Builder全量用例。初版说明：`.superpowers/sdd/2026-10-16-pi-browser-agent/pi-produce-2026-10-23-r3/INITIAL_VERSION.md`；[交付事实](../release/evidence/2026.10.23-pi-initial-mvp-delivery.json)（sha256:38e488aa319765ce7b433ec81c4edf55d654cfa979de2ec788894f0ec8ed87b9）。

下一步仅待真实安装准备提案`sha256:36d8d85a20ebfa398d3cbb0a77a6f70ae8631503225940ed7b4f0933cda596bb`批准：创建全新authority存储，再用实际身份生成精确安装预览。本次没有初始化真实authority、安装、激活、执行SDK或模型；原预算26项/4774分预留/5226分可用/10000分上限、旧7条消费/27项决策和全部失败保持。全量检查仍未完成、真实M3效果和Task13未验收，不能称初版已通过实际运行。安装/激活/付费验收继续逐项具体批准；先完成M3再适配新模型，不提交或push。以下为保留的历史，其中旧“等待Plan恢复批准”不代表当前交付阶段。

2026-10-23 最新离线修复与正式来源恢复预览（真实恢复未验证）：已复现并修复空预热后SDK历史尚未写入所致的再次启动ENOENT；只有无历史身份标记、无请求且私有元数据合格时才允许创建一次header，目录/权限/历史身份校验保持。七个子进程启动阶段只记录固定状态和有限错误类别；诊断发送失败仍清理已创建资源。历史实际退出唯一根因与当次SDK导入结果仍未证实，不能归因于MiniMax。

本轮修复定向44项、I/O25项、静态边界/子进程25项、私有观察器5项通过，组间重叠不相加；最终374文件冻结`sha256:8ba314f015f284e0e79da622d23d6bff0a9e6c89814101c814e177dcb1d18312`，仅7项较修复前改变。原整条npm检查缺少最终退出回执；已完成的main1451通过/60跳过、durable2通过、packed-hook1通过只代表前三段。后续packed-behavior在900秒控制期限停止，exit1/forced、6通过/1跳过/1取消，不能计为通过；immutable-successor未运行。全量检查未通过，不把中断、取消或未运行记录洗成通过。Node20历史生产器成功并曾按确切字节发布，当前公开receipt仍匹配`sha256:9a5cd347085823b755256375b0eaa0d771e39ebec099517109681f08ab49d378`；原临时receipt现不存在，未重造。公开消费者6项通过。

环境恢复后device由16777229变为16777230；允许读取文件的摘要及敏感文件无正文元数据核验一致，但旧物理身份不匹配，旧authority与方向账本公开准入分别以AGENTMO_NATIVE_AUTHORITY_REJECTED和AGENTMO_DECISION_LEDGER_LINEAGE_INVALID拒绝。旧严格校验器和产品安全边界未改，不修写设备编号、不续接旧journal、不复制旧物理helper。原r2仍40项，authority7条消费/27项决策的内容保留，但旧物理绑定不可作为当前运行授权。

下一道只申请正式来源恢复提案`sha256:78c2dc6561a9cbda0befecf0ad80543bda8ced638fb11b50a461b2b371e48cbc`，可读全文`.superpowers/sdd/2026-10-16-pi-browser-agent/pi-child-startup-repair-2026-10-23-r1/plan-recovery-preview/PLAN_RECOVERY_PREVIEW.md`。当前用户重新批准后才在全新0700 Plan根公开append同一逻辑方向（expectedHead=null），观察实际新head，生成Design Plan、Blueprint、Build Contract和不带--approve的Produce预览。Discover/Need既有范围按确切字节复用；SDK1.2.0、Node24.18.0、lock/SDK内容保持，Pi描述器已重新观察当前物理身份。新Plan根仍不存在，尚未登记新方向批准。

本预览不授予Produce、Agent authority初始化、安装、激活、SDK或模型调用。后续分别另批，旧authority不自动重绑定，且必须继续披露全量验证缺口。五条固定M3材料已移除旧会话ID/测试摘要，当前不可执行；未来仍最多5请求/+155分本地保守预留、前四项技术与独立内容评审通过才允许一次条件重启，失败停止不补跑；付费前核查公开价格，实际账单按token计费。先完成M3再适配新模型。

原预算26项/4774分预留/5226分可用/10000分上限保持，本轮新增真实预留/模型请求/批准消费均0；19492/19493空闲。840份最近失败和120份更早失败保护记录保留；未读取.env、密钥值或SDK会话/login/control正文，未执行实际SDK、真实安装、重新激活、暂存、提交或push。Plan11/旧15项来源缺口、19类真实验收及Task13整批交付审阅继续待完成，交付PARTIAL。

[离线修复、验证缺口与保全事实](../release/evidence/2026.10.23-pi-child-startup-repair-offline-checks.json)（sha256:ee4adfe7d97456d7da2e930bbcf10d249bf6f572af7cbfdcb58f035bd0a0d656），[本轮代码/恢复控制/精确预览独立复核](../release/evidence/2026.10.23-pi-child-startup-repair-review.json)（sha256:2662ebed97fdcc2620972d3b444b56b29c4c0b283f1c467cc730c1cc572c458f）为Critical0/Important0/Minor0；审阅不认证全量检查、实际SDK/M3、领域质量或生产就绪。以下保留历史，旧“当前/源码保持/全量待完成/Produce下一步”不代表最新源码、验证状态或授权。

2026-10-23 最新：新提案 `sha256:e6264b77930131194f2c8f82d769df77c8c4c935235eaa15edd17c8109b2a9e8` 已获批单次执行，代理监听后Pi子进程退出1，未达到ready；浏览器未启动，五条材料均未发送，M3五项验收全部未执行。底层原因和实际SDK导入结果仍未知，不能归因于MiniMax。

已核验failed / child-exit / ownChildExited=true停止回执，19492/19493释放；没有重复停止、补跑或重启。r2现40项、authority现7条消费/27项决策，仅新增4份attempt文件和1条消费/5项决策，原预算仍26项/4774分预留/5226分可用/10000分上限，零新预留。374份冻结产品源码、原会议文件及全部旧失败保持。

当前恢复基线：`.superpowers/sdd/2026-10-16-pi-browser-agent/pi-browser-launch-repair-2026-10-23-r1/activation-operation/reports/post-failure-baseline.json`；旧36项/6条22项预检已过期，已消费提案不得复用。下一步离线定位子进程失败，任何真实激活或模型调用仍需新具体预览批准。先完成M3再适配新模型；其余14类、Plan11/旧15缺口与Task13整批审阅保留。助手未读取密钥值，本轮不暂存、提交或push。

[本次单次失败执行与保全证据](evidence/2026.10.23-pi-m3-host-browser-startup-failure.json)，摘要 `sha256:fd56d0c4ec60854f95f2fb1f1591120a31517345b206f2927c1b7db25e42943f`。本次执行与保全记录[独立复核](evidence/2026.10.23-pi-m3-host-browser-execution-review.json)为Critical 0 / Important 0 / Minor 0（摘要 `sha256:9341be0947ce4ccbb81bb91cfe52cd46fad1c8be0833263bb994ad68d34a6f18`），只接受此有界失败记录；文档合同11项通过，不构成模型验收或Task13整批通过。下方保留的“当前/待批准/36项/6条22项”均为历史，不代表现时授权或基线。

2026-10-23 最新离线浏览器修复（待具体运行批准）：相同空白Chrome配置在沙箱中被拒绝、在受控主机终端启动并关闭；新网关和浏览器启动均绑定主机终端，细分诊断及自有清理已补齐。旧异常正文未保留，历史同因归属仍为推断，真实Pi/M3恢复尚未验证。

本轮21项浏览器控制回归、13项预检/封存保护回归通过；实际Chrome与原生页面的五条材料/两阶段模拟通过，全部API与回复在内存替身完成，没有实际SDK、Agent或供应商调用。完整npm检查五段自然退出0，共1449通过/61跳过/0失败；当前控制与预览独立复核0/0/0，三项Important均已关闭。此复核不是Task13整批交付审阅。

新提案`sha256:e6264b77930131194f2c8f82d769df77c8c4c935235eaa15edd17c8109b2a9e8`，激活计划`sha256:3a5bea86a8fe9a11ee941900cd0fabc3774f5c05ddd1ec144cc4ccd85de22245`；本机具体全文为`.superpowers/sdd/2026-10-16-pi-browser-agent/pi-browser-launch-repair-2026-10-23-r1/activation-preview/PAID_ACCEPTANCE_PREVIEW.md`。仅固定首次整理、更正、注入、新会议隔离、重启后追问五项，最多5次MiniMax-M3请求/+155分保守预留；前四项技术与独立内容评审通过后才允许一次条件重启，失败停止、不补跑，最后按回执停止自有服务。仍须本提案的新批准，不能复用旧已消费批准。

原预算仍26项/4774分累计保守预留/5226分可用/10000分上限，五例全跑后最多31项/4929分/5071分。r2共36项、authority6条消费/22项决策、374份产品冻结、实际SDK描述器及全部新旧失败保持，含当前120份失败批次保护文件；两端口空闲、新运行根不存在。本轮未读取密钥、重新激活或执行实际SDK、调用模型、提交或push。供应商账单未查询；1.55元是本地授权预留上限。先完成M3验收再适配新模型；其余14类、Plan11/旧15项来源缺口和Task13整批审阅保留。

[离线修复、完整检查与新预览证据](evidence/2026.10.23-pi-browser-launch-repair-preview.json)，摘要`sha256:363d1de1471d0a84e74678e4677deea511644f65d2a19a7dcef42520f5e850bc`。以下保留历史，其中旧“当前/待批准”与已消费提案不能作为本次执行授权。

本次失败执行与保全记录[独立复核](evidence/2026.10.23-pi-m3-execution-review-public.json)为0/0/0；未获得模型验收或Task13整批通过。

2026-10-23 最新：[Pi/M3单次执行在浏览器启动时失败并停止](./2026.10.23.md)。运行器已ready，浏览器无句柄、未发送材料，五例均未执行；一次鉴权停止成功，零新预留，原预算及全部失败保持，authority现6条/22项，r2为36项。下方保留历史预览，不允许复用已消费批准。

2026-10-22 最新：[Pi/M3启动控制侧离线修复与新预览](./2026.10.22.md)，完整JSON解析、回执清理、细分诊断及14项专项回归通过，独立修复审阅最终0/0/0；完整五段检查自然退出0（主段1438通过/60跳过）。历史启动根因仍未知，真实恢复和五项验收未执行；保留原预算及失败，新的具体运行预览待批准，先完成M3再适配新模型。

本轮[离线修复、完整检查与新预览证据](evidence/2026.10.22-pi-m3-startup-repair-preview.json)，摘要`sha256:b198bfbbd956ee7b617e32089cf28f296d3cc6a731a942b390fb61b2d30d49ac`。真实Pi/M3恢复尚未验证；新运行仍须单独批准。

2026-10-22 先前：[Pi/M3单次验收启动失败并保全](./2026.10.22.md)，未达ready、五项均未执行；运行器自行停止、端口释放、预算无新增，现5条消费/17项决策。旧失败和源码保持，下一次运行须新预览批准。

2026-10-20 历史：[Pi 只读激活一次通过并停止](./2026.10.20.md)，14步浏览器检查及60秒空闲通过，预算不变、无模型调用；原失败证据保留，模型验收及Task13整批审阅待后续。

本目录记录 AgentMo 每个阶段性大版本的设计动机、实际能力、验证证据和剩余风险。

产品目标、项目演进和当前/未来方向的总览见
[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)。各日期记录仍是精确实现与验证事实的
权威来源。

命名规则：

```text
YYYY.MM.DD.md
```

每个日期文件按以下结构维护，并在 GitHub Releases 中作为对应日期 release 的正文使用（不是 asset 附件）。历史日期 release 使用 `release-YYYY.MM.DD` tag；`2026.07.07` 同时承载 `v0.1.0` release baseline tag：

- 背景：为什么进入这个阶段。
- 范围：本阶段新增或确定了什么。
- 架构决策：哪些路线被采用，哪些被拒绝。
- 代码/文档入口：后续 agent 应该从哪里恢复上下文。
- 验证证据：只记录命令、结果、路径、hash、摘要。
- 非认证边界：明确哪些能力还不能宣称生产可用或领域认证。
- 后续风险：下一轮必须注意什么。

禁止写入本目录的内容：

- `.env` 内容或任何密钥值。
- OpenClaw credential-bearing state。
- 原始 stdout/stderr 全量日志。
- 原始对话 transcript。
- 未脱敏 tool body 或 provider payload。

## 日期索引

Release 记录按日期倒序维护（最新在前），不要按版本号排序。版本号只作为某个日期记录下的发布标签。

| 日期 | 阶段 | 状态 | 记录 | GitHub Release |
| --- | --- | --- | --- | --- |
| 2026.10.26 | Pi 初版检查点与 Orchivane 接续 | 安全提交清单、公开脱敏映射与控制器 TODO；真实安装/激活/M3 继续逐项审批，全量验证缺口保留 | [`2026.10.26.md`](./2026.10.26.md) | 未发布 |
| 2026.10.23 | Pi会议助手初版离线交付 | 正式Plan、Package和.d42已生成并检查；源码冻结，真实安装准备待批，全量与模型验收缺口保留 | [`2026.10.23.md`](./2026.10.23.md) | 未发布 |
| 2026.10.22 | Pi/M3启动控制修复与新验收预览 | 原失败保全；14项专项回归及独立复核通过，真实恢复/五项模型验收仍待新批准；原预算保持，未提交或发布 | [`2026.10.22.md`](./2026.10.22.md) | 未发布 |
| 2026.10.20 | Pi 浏览器诊断与只读激活通过 | 旧失败保全；修复后按新批准单次执行，14步页面及60秒空闲通过并停止；零模型/新预留，模型验收与Task13待完成 | [`2026.10.20.md`](./2026.10.20.md) | 未发布 |
| 2026.10.19 | Pi就绪修复与r2实际安装 | 离线修复/冻结/独立复审完成，新包及r2精确安装成功；只读激活预览待批准，SDK运行与模型验收未执行 | [`2026.10.19.md`](./2026.10.19.md) | 未发布 |
| 2026.10.16 | Pi SDK浏览器Agent实现与离线证据 | Tasks 1–10源码/合成验证与完整检查完成；独立审阅5项Important已修复并经作者验证；SDK单次合成失败保留；凭据离线修复/完整重验/新冻结完成，r2运行预览待批准 | [`2026.10.16.md`](./2026.10.16.md) | 未发布 |
| 2026.10.15 | 交付状态与跨电脑接续维护 | M3与旧DeepSeek验收分开说明，恢复入口/实施进度/待推送清单同步；98源码冻结不变，激活及提交/push未获批 | [`2026.10.15.md`](./2026.10.15.md) | 未发布 |
| 2026.10.14 | 国内MiniMax M3离线适配 | 正式来源、预算代理与SDK合成集成通过；独立审阅及最终五段检查完成；M3实际安装complete，激活与只读页面预览待批准；付费验收仍逐门禁 | [`2026.10.14.md`](./2026.10.14.md) | 未发布 |
| 2026.10.13 | 会议文字助手验收与MiniMax M3切换提案 | 真实首例502后按规则停止；国内M3设计待审阅，未改代码或调用M3，交付PARTIAL | [`2026.10.13.md`](./2026.10.13.md) | 未发布 |
| 2026.10.12 | Native-chat 精确交付证据与整批审阅 | Task 6 审阅修复、Node20 与完整五段回归通过；真实 UI 和付费验收待精确批准 | [`2026.10.12.md`](./2026.10.12.md) | 未发布 |
| 2026.10.10 | Native-chat 首次初始化与安装验证 | 单 Agent 合成注册、Stage 2、发布闭包、Node20 及完整五段检查通过；未激活 | [`2026.10.10.md`](./2026.10.10.md) | 未发布 |
| 2026.10.09 | Native-chat 安装绑定与原生探测 | 公开 probe、隔离无模型探测及完整五段检查通过；安装及聊天入口仍未完成 | [`2026.10.09.md`](./2026.10.09.md) | 未发布 |
| 2026.09.29 | I/O 恢复与 native-chat 正式 Package | 修改前五段检查通过；新打包批次聚焦验证与 Node20 通过，安装及运行待实施 | [`2026.09.29.md`](./2026.09.29.md) | 未发布 |
| 2026.09.28 | Native-chat 基础支持 + Course Wiki 历史原生证据 | 无工具规划/精简 scaffold 已实现；Node20 已验证，全量检查阻塞；原生交付仍未完成 | [`2026.09.28.md`](./2026.09.28.md) | 未发布 |
| 2026.09.25 | Course Wiki turn / acceptance integration | code-only checkpoint；历史验收结果保留 | [`2026.09.25.md`](./2026.09.25.md) | 未发布 |
| 2026.09.20 | Course Wiki recovery + reviewed behavior evidence | 实施与验收中；Node20 fresh receipt 已生成，POC 完整原生验收和全量检查尚未完成 | [`2026.09.20.md`](./2026.09.20.md) | 未发布 |
| 2026.09.16 | Course Wiki 升级兼容与通道恢复 | 原生3项真实问答通过；资料外问题格式失败，仍 PARTIAL；全量检查中 | [`2026.09.16.md`](./2026.09.16.md) | 未发布 |
| 2026.09.15 | Course Wiki 确定性引用摘取 | 离线69项/独立审查通过；真实Wiki+5道固定题通过；全项目检查中 | [`2026.09.15.md`](./2026.09.15.md) | 未发布 |
| 2026.09.14 | Course Wiki / OpenClaw 隔离文档 POC | 真实 Wiki、重启读取与资料外拒答通过；UI 已修复；正向问答/最终验收仍 PARTIAL | [`2026.09.14.md`](./2026.09.14.md) | 未发布 |
| 2026.08.28 | Stage 2 direct-loader closure + Node 20 evidence refresh | fixed design-plan loader cycle、完整 direct test ownership 与新 Node20 trusted receipt/post-publication consumer 已闭合；未批准 Plan、本地已提交并集成、未 push/未发布 | [`2026.08.28.md`](./2026.08.28.md) | 未发布 |
| 2026.08.19 | Plan Decision Entry canonical writer + Builder bootstrap exact-frame + Node 20 evidence closure | Plan canonical writer、公开排序/flag 合同、approved narrow same-UID boundary、Builder fd3/fd4 exact-frame contract 与新 Node20 trusted receipt/post-publication consumer 已闭合；未提交、未集成、未发布 | [`2026.08.19.md`](./2026.08.19.md) | 未发布 |
| 2026.08.17 | 合并后 aggregate gate 收口 | continuation watchdog 合同与 immutable-successor 独立 lane 已闭合；五段 `npm run check` 自然 exit 0；未提交、未 push、未发布 | [`2026.08.17.md`](./2026.08.17.md) | 未发布 |
| 2026.08.14 | Discover Agent Idea Candidate proposal contract + Node 20 evidence closure | Candidate 垂直切片、Node 20 trusted receipt/post-publication consumer 与四段 fail-fast npm check 已闭合；未提交、未集成、未发布 | [`2026.08.14.md`](./2026.08.14.md) | 未发布 |
| 2026.08.12 | AgentMo 权威架构收敛：数据连接、Idea 发现、测试数据集、Coding Agent 与 Runtime Adapter | 架构口径已更新；新增适配器与自动 Idea 发现仍是待实现能力 | [`2026.08.12.md`](./2026.08.12.md) | 未发布 |
| 2026.08.10 | 开发协作迁移：GSD → Superpowers | 当前事实已收敛到维护文档和 release；旧规划工作区与本机 GSD runtime 已按确认清理 | [`2026.08.10.md`](./2026.08.10.md) | 未发布 |
| 2026.08.06 | 白领 Research DB / OpenClaw 独立黑盒 POC | 验收运行 PASS：首次 20 条、二次 0 重复、重启恢复、8 证据/0 缺口 brief 与证据约束问答通过；schedule、完整来源健康与生产认证仍未完成 | [`2026.08.06.md`](./2026.08.06.md) | [`release-2026.08.06`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.08.06) |
| 2026.08.05 | 白领 Research DB / OpenClaw POC 与全量检查单飞门禁 | POC 专项、Builder 生命周期与 tarball 安全验证通过；真实采集、scheduler activation 与完整无竞争全量 gate 仍待完成；未发布 release | [`2026.08.05.md`](./2026.08.05.md) | 待发布 |
| 2026.08.04 | Phase 4：native authority race closure 与 POC 前最终 Linux gate | fresh review 的最终 2 Critical / 1 Warning 已完成源码与聚焦 Linux 修复；精确 commit、完整 8/8 CI 与零缺陷 re-audit 待完成；未发布 release | [`2026.08.04.md`](./2026.08.04.md) | 待发布 |
| 2026.08.03 | Phase 4：exact-candidate Linux/full gate 与 gap-closure pre-audit 证据 | `d943bc0` run `30799041760` 8/8 jobs green；fresh noncanonical audit 3 Critical / 1 Warning，Phase 4 blocked；未发布 release | [`2026.08.03.md`](./2026.08.03.md) | 待发布 |
| 2026.08.02 | Phase 4：authority-root、named candidate 与 Linux supervisor 多轮对抗加固 | remediation 已进入 `codex/phase2-poc-baseline` Linux CI 候选；Darwin 聚焦 gate 6 pass / 0 fail / 11 Linux skip；精确 commit 的 Linux gate 后再复审，未发布 release | [`2026.08.02.md`](./2026.08.02.md) | 待发布 |
| 2026.07.31 | Phase 4：8 Critical / 2 Warning post-audit remediation，canonical ledger、producer-auth evidence、Linux retained-candidate config、bounded process group、nested closure 与 recoverable evidence | current-source full/pack/diff 已绿；fresh re-audit Critical 3 / Warning 0，Phase 4 blocked；未提交或发布 | [`2026.07.31.md`](./2026.07.31.md) | 待发布 |
| 2026.07.30 | Phase 4：fresh reprobe、retained-dirfd helper、durable authority、four lifecycle、strict receipts 与 extracted source-only distribution | 04-19 最终 lane-structured gate exit 0：main 935 pass/0 fail、两条负载敏感场景各 1/1；pack 99 entries 与 diff-check exit 0；noncanonical/canonical review 仍待执行，未提交或发布 | [`2026.07.30.md`](./2026.07.30.md) | 待发布 |
| 2026.07.29 | Phase 4：deterministic Agent Package、D-42 archive-only authority 与 ownership-safe receipt-last lifecycle | canonical 40-member package；四 lifecycle mechanism 与 packed closure 已完成；real OpenClaw/Phase 5 evidence absent；未提交或发布 | [`2026.07.29.md`](./2026.07.29.md) | 待发布 |
| 2026.07.28 | Phase 3：bounded discovery、exact Plan authority、append-only ledger 与 strict Package build contract | 03-05 affected aggregate 165/165；未运行 live Internet/OpenClaw，未提交或发布 | [`2026.07.28.md`](./2026.07.28.md) | 待发布 |
| 2026.07.27 | Independent AgentMo-only POC：artifact contract 可发现性、字段诊断与 Plan 证据语义修复 | 增量 POC 到达 Produce scaffold；Stage 2 63/63，通过真实 POC 输入重放；live collector/package runtime 未实现 | [`2026.07.27.md`](./2026.07.27.md) | 待发布 |
| 2026.07.23 | Phase 02 Builder hardening：hook graph、append-only recovery、UAT authority 与 bounded projection batch | 本地 aggregate 760/0 通过；fresh review Critical/Warning 0；real UAT 未运行 | [`2026.07.23.md`](./2026.07.23.md) | 待发布 |
| 2026.07.22 | Phase 02 review-fix：10 Critical + 1 Warning 的 Builder v1 mechanism closure | 本地 aggregate 712/712 通过；independent review / real UAT pending | [`2026.07.22.md`](./2026.07.22.md) | 待发布 |
| 2026.07.21 | Phase 02 transaction-bound publication 与 deactivation continuation recovery | 本地 bounded mechanism gate 通过 | [`2026.07.21.md`](./2026.07.21.md) | 待发布 |
| 2026.07.20 | Phase 02 verifier boundary 与首次 verifier-inclusive bounded failure | 合法 fail-closed outcome；Phase 02 incomplete | [`2026.07.20.md`](./2026.07.20.md) | 待发布 |
| 2026.07.17 | Phase 02 installed Codex hook recovery bridge | 本地 bounded mechanism gate 通过 | [`2026.07.17.md`](./2026.07.17.md) | 待发布 |
| 2026.07.16 | Phase 02 Builder projection、activation 与 lifecycle | 历史实现记录；后续 v1 append-only contract 已取代 destructive surface | [`2026.07.16.md`](./2026.07.16.md) | 待发布 |
| 2026.07.15 | Phase 02 Codex Builder first bounded-failure record | 合法 fail-closed outcome；非 UAT success | [`2026.07.15.md`](./2026.07.15.md) | 待发布 |
| 2026.07.13 | Phase 01.2 runtime compatibility：Node 20 receipt + pre-effect OpenClaw gates | 有界复跑通过；记录与实现须同一 `main` checkpoint | [`2026.07.13.md`](./2026.07.13.md) | 待发布 |
| 2026.07.12 | Phase 01.1 blueprint-to-handoff exact admission closure | 本地 evidence gate 通过 | [`2026.07.12.md`](./2026.07.12.md) | 待发布 |
| 2026.07.11 | Phase 01.1 canonical legacy migration apply | 本地 retained-handle mechanism gate 通过 | [`2026.07.11.md`](./2026.07.11.md) | 待发布 |
| 2026.07.10 | Stage 2 design-plan contract：DB+need -> design-plan -> blueprint | 本地验证通过，待提交/发布 | [`2026.07.10.md`](./2026.07.10.md) | 待发布 |
| 2026.07.07 | Stage 3 delivery closure：domain-eval + delivery-report | 已提交并发布到 GitHub Release `v0.1.0` | [`2026.07.07.md`](./2026.07.07.md) | [`v0.1.0`](https://github.com/alexzhu0/AgentMo/releases/tag/v0.1.0) |
| 2026.07.06 | MVP birth-loop：discover -> need -> draft -> handoff -> birth-report | 已提交到 `83dc9e5`，后续安全修复到 `e287988` | [`2026.07.06.md`](./2026.07.06.md) | [`release-2026.07.06`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.06) |
| 2026.07.05 | DeepSeek/OpenClaw live POC 与产品化规划 | POC/规划完成；记录为历史阶段证据 | [`2026.07.05.md`](./2026.07.05.md) | [`release-2026.07.05`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.05) |
| 2026.07.03 | AgentMo v0.1 baseline + runtime evidence spine | 已提交到 `93da9b5` | [`2026.07.03.md`](./2026.07.03.md) | [`release-2026.07.03`](https://github.com/alexzhu0/AgentMo/releases/tag/release-2026.07.03) |

## 当前恢复锚点

- 当前项目：`$AGENTMO_REPO`
- 当前短期恢复入口：先读 `docs/CURRENT_STATUS.md`，再读本索引与 `release/2026.08.28.md`。2026.08.28 Stage 2 direct-loader / Node 20 evidence closure 已在本地 `main` 提交并集成、尚未 push；2026.08.19 及更早记录保留为历史证据。
- Phase 4 maintained records：`release/2026.07.29.md` 至 `release/2026.08.04.md` 保留 deterministic package、Linux gate 与审计历史；它们不被 2026-08 POC 结果覆盖。`release/2026.08.05.md` 与 `release/2026.08.06.md` 记录独立 POC lane 与其边界。
- 历史已记录的 published baseline：`v0.1.0`；当前日期记录不推断新的 tag、GitHub Release、npm publication 或 deployment。
- 当前重点：Stage 2 direct-loader closure 的最终 `npm run check` 已自然 exit 0，最终 independent review 已 READY（Critical 0 / Important 0），并已本地 commit/integrate；没有 push、PR、tag 或发布授权。该机制 evidence 不批准 Plan/Produce；隔离 POC 的历史 acceptance、schedule、投递、默认 OpenClaw 安装、完整来源健康、领域质量与生产认证仍是独立边界。
- 当前迁移规则：projected-v2 canonical receipt 不允许原位替换为 activated-v4；保留 genesis，并使用 immutable version-qualified lifecycle successor。`deactivate` 追加 tombstone，`reactivate` 追加 successor；不提供 purge、selector removal 或 physical delete。
- 当前 UAT authority：`preview` 只读；`decide approve|reject` 仅 caller-reported 且 nonterminal。独立 external human decision authority 尚未实现，不得声称 11/11、domain 或 production certification。
- 当前主线：继续只在 AgentMo 内维护，不把 sibling projects 的工作混入本仓库 commit。
- 当前恢复入口：先读仓库根目录 `AGENTS.md` 与 `docs/SUPERPOWERS_WORKFLOW.md`，再读 `docs/CURRENT_STATUS.md`、本索引、`release/2026.08.28.md`、`README.md` 与 `docs/MVP_RUNBOOK.md`。Phase 4 历史从 `release/2026.07.29.md`–`2026.08.04.md` 追溯；不要把旧规划工作区当作当前指令来源。
