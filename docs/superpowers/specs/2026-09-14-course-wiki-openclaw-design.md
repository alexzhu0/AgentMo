# 课程资料 Wiki / 问答 OpenClaw POC

日期：2026-09-14。状态：用户已确认设计并选定 DeepSeek V4 Flash；
不是已生成或已注册的智能体。

实施进展补记（2026-09-14，以下设计阶段快照不作为当前运行证据）：
用户已授权独立 worktree 和仅三份公开样本及五道问题的首次真实测试，总上限
人民币 5 元。用户进一步确认接受请求名 `deepseek-v4-flash` 当前由官方
V4.1 Flash 提供服务。运行环境的密钥存在性已通过 value-blind 检查；没有读取
或展示 `.env` 内容。原生 Wiki init/ingest/search/get/lint 及定制 provider 的
离线模型目录探测已执行；它们不证明付费认证或领域质量。实施及复审进度由计划
和本地 SDD ledger 跟踪；此时尚未产生真实模型调用，也未完成智能体注册验收。

## 目标与首版范围

构建 `course-wiki`：用户上传 DOCX、Markdown、UTF-8 TXT，得到可浏览的中文知识
Wiki，并用中文提出针对材料的问题，答案引用原文。首轮使用
`docs/poc/course-wiki/sample-materials/` 中三个固定版本英语教材节选。

首版仅单用户、单知识库、受监督本地演示。建议限制为每批最多 10 份文档、每份
2 MiB、提取后正文合计 100,000 字符；超限明确拒绝，不静默截断。
不支持旧 DOC、PDF、PPT、OCR、音视频、云同步、多用户权限、定时任务或消息渠道。

## 已核对的复用基础

- 本机 OpenClaw package.json：`2026.7.1-2`；存在已分发的
  `dist/extensions/memory-wiki/index.js` 和 plugin manifest。
- 随安装分发的 `docs/cli/wiki.md`：本地 MD/TXT ingest、compile、search/get、
  synthesis apply 与 lint；不是 DOCX 解析器。
- 插件 manifest 声明 `wiki_status`、`wiki_search`、`wiki_get`、`wiki_apply`、
  `wiki_lint`。目前只核对文件，未启用插件、未测试运行。
- 本机有 `/usr/bin/textutil`；DOCX → text 可优先做受限进程验证。若不能安全或
  正确提取，报告该文件失败，不自动安装转换器或改用外部上传服务。
- AgentMo `runtime-check --target openclaw` exit 0，宿主 Node `24.18.0`。
  这只证明当前 Node 范围检查通过，不是智能体 runtime success。
- 现有 `src/poc-agent.js` 是研究领域 seed/workspace；
  `src/poc-openclaw-runtime.js` 写死 DeepSeek 及插件安装。不能把新教材伪装成
  研究记录，也不能直接调用旧启动器来默认选择或付费调用 DeepSeek。

## 方案比较与建议

1. **建议：OpenClaw 原生 memory-wiki + 很薄的文档导入/展示层。**
   复用 Wiki 持久化、检索和引用结构；只新增文档接入、课程行为规则及验收。
2. 自写 RAG、向量库、Wiki 引擎：新增依赖、索引和运行维护，不适合本次五天演示。
3. 直接将三份样本塞入提示词：可快速回答，但不满足持久 Wiki、可复现导入和新增
   材料的要求，不作为完成品。

这是新的领域子系统，采用 Superpowers brainstorming 设计确认后再写实施计划，
并用 Ponytail 保持最小范围。复用原生机制不等于已验证其领域效果。

## 数据流与职责

1. 本地页面接收白名单格式。文件名由系统分配；拒绝路径穿越、符号链接、无效编码、
   二进制伪装、超限文件。DOCX 转换限制时间和输出大小，保留原始文件及段落定位。
2. 保存原文、来源摘要及可追溯位置；仅导入被选择的课程内容，不扫描用户目录。
   教材样本的来源头、许可证与正文分开索引，许可证仍随展示/导出可访问。
3. 通过原生 Wiki ingest 保存 source pages。模型再按课程主题产生中文知识点、
   概要和跨文档关联，引用 source ids 和原文范围；compile/lint 检查结构。
   **compile 本身不是语义总结，也不能把预写答案或标题索引冒充自动生成 Wiki。**
4. 问答先 search/get，再核对原文；结构化答案含正文和引用。来源或位置无效则
   不显示为有依据的答案。中文问英文材料时先做检索词转换，检索无结果则提示缺证据。
5. 页面展示资料、Wiki、问答和原文引用；localhost 绑定、浏览器请求来源校验，
   不对公网开放。优先验证 OpenClaw 原生 UI 是否覆盖需要，缺少上传/浏览时只补
   这部分，不重写聊天后端或模型 SDK。

## OpenClaw 运行与权限

使用独立 `course-wiki` profile、workspace、state/config 和 vault；不修改用户
默认 agent、原有 profile、模型凭据或旧 lecture POC。workspace 不等于 OS sandbox，
不能以独立目录宣称宿主文件系统隔离。

memory-wiki 使用 isolated vault、local search、wiki corpus；关闭 bridge、
private-memory access、URL ingest、Obsidian 集成及自动任务。工具只开放该课程
所需的 Wiki 查询/受限合成；不向模型开放通用 shell、任意文件读取、浏览器、网络
抓取、渠道发送或后台任务。工具可用性必须在运行配置中限制，不能只写在提示词里。

资料仅作为数据：文档里的命令、链接、工具调用请求不能提升权限或触发执行。
只接受操作者显式导入；失败不覆盖已有可用 Wiki，重试不得产生重复源。

本轮用户明确选定 `deepseek/deepseek-v4-flash`，API 模型名为
`deepseek-v4-flash`，不启用其他模型 fallback。官方模型名已核对：
https://api-docs.deepseek.com/updates/ 。首轮采用 non-thinking、有限输出与有限调用次数。
认证方式与费用上限需确认；不要求在聊天中粘贴密钥，不读取 `.env`，
不复制原有 credential store。当前进程对 `DEEPSEEK_API_KEY` 的 value-blind
存在性检查为 false，不代表本机其他位置没有凭据。
未完成费用及认证确认前仅可做离线实现/模拟测试，不进行真实生成、问答或付费调用。

## AgentMo 集成与汇报口径

本设计是 AgentMo 项目下的领域 POC 实现设计，不是
`agentmo.design-plan.v1`、`agentmo.plan-approval.v1` 或安装授权替代品。
旧录音 POC 的精确审批、snapshot、ledger 和测试记录保持不变。

### 2026-09-15 用户批准的引用协议收窄

模型仅选择 `{sourceDigest,fromLine,toLine}`，程序从本次提供的已核验正文中
确定性摘取 `quote`，再经过原有精确引用验证。内部选择拒绝模型自带 `quote`
或额外字段，不修补摘要、不裁剪越界行号、不模糊匹配。Wiki 与问答共用此
转换；对外引用仍为 `{sourceDigest,fromLine,toLine,quote}`，历史存储兼容。
这消除逐字抄写的脆弱性，但不能证明所选原文支持回答的全部论断。

本次批准仅限离线实现、测试和审查，不授权新的付费复测。首次 campaign
保留原 root 和累计 15 次预留（4.65 元，非实付账单）；剩余 1 次不足以
完成一次两请求问答，不自动重置或加额。

必须分别报告“领域样例可运行”和“AgentMo Discover → Plan → Produce 全链路
验证”；前者不能冒充后者。若要通过正式 AgentMo 阶段生成/注册该产物，需为本
材料和新目标生成当前的阶段输入，按既有机制取得相应审批；不能为赶演示删除 gate。
如果时间只够领域样例，汇报中必须显著保留这一缺口，不声称完整产品已交付。

## 验收与实现顺序

先写失败测试，再实现：材料解析与定位 → 原生 Wiki 导入/重试 → 引用验证 →
最小页面 → 独立 OpenClaw 注册 → 经授权真实模型验收。先完成可重复的一次批量
导入，不增加实时监听、增量同步或后台队列。

- 离线：格式/大小/路径/编码错误、DOCX 超时、中文与英文文本保真、样本摘要、
  来源映射、无重复导入、失败保全、许可证保留、无依据/错误引用拒绝。
- 安全：上传文档含恶意指令时，不能调用宿主 shell、读取目录外文件或发送数据。
- 真实验收：样本 README 的 5 题；4 道有据问题均正确引用，其中一道必须跨文件；
  材料外的雅思标准问题明确报告当前材料无依据；不把模型常识当教材内容。
- Wiki：至少三个可浏览主题，中文摘要与原文一致；重启后仍能读取与问答。
- 若实际修改 AgentMo 代码，执行相关聚焦测试、`npm run check`、
  `git diff --check`；不复用历史运行结果证明新改动。
- 没有真实执行证据前，状态分别标注“已设计”“离线通过”“已注册”“运行通过”，
  不合并成笼统完成。不自动 commit、push、安装新依赖、发布或对外开放。

## 本轮未执行的事项

未写实现代码或生成 agent workspace；未启用 memory-wiki、注册 agent、启动 Gateway、
上传材料至 provider、生成 Wiki 或运行问答。设计与模型已确认；实施计划单独跟踪。
