# Native chat 国内 MiniMax M3 切换规格

日期：2026-10-13。状态：待用户审阅的设计，不是实现、安装或运行批准。

## 目标与已确认输入

继续 Task 6 的会议文字助手，改用国内按量 API 的 `MiniMax-M3`。
用户确认凭据放在主项目根目录的 `.env`，变量为 `MINIMAX_API_KEY`。
凭据只能由现有 `--runtime-env-file` 运行器在内存加载，不读取、显示、复制
或持久化其内容。文件实际规范路径只在私有预览中保存。

当前 DeepSeek 首例失败后已鉴权停止：一次持久 attempt、一次31分新增预留；
原账本当前25项、4743分预留、5257分可用。旧根、会话、claim、批准消费和
失败证据保持原状，不用旧付费批准重试，也不把切换模型视为已定位旧502根因。

继续使用 OpenClaw 2026.9.4 原生页面、唯一 meeting-text Agent、无工具、
无插件/调度/后台模型调用/自动重试/自动fallback，保留原19类验收定义及
12项来源缺口。未通过真实观察与独立评审时交付仍PARTIAL。

## 选定方式与范围

在既有 native-chat 链增加一个固定的国内 M3 配置，不建立任意供应商插件框架。
旧工件缺少新选择字段时，仍只能解释为原 DeepSeek 配置，重构原字节不变。
新 M3 工件必须显式选择 `minimax-m3-cn-v1`，未知选择、null、错配或跨profile
字段均在任何批准消费/写入/付费前拒绝。

否决直接改现有config或替换key：正式Package、安装回执、激活动作、预算
请求和验收model已绑定DeepSeek，这样会绕过来源和人类批准。
否决原地升级/迁移：当前native生命周期没有upgrade，修改已安装根会使其
回执漂移。使用全新私有Agent根和独立批准存储，复用原累计账本；不复制旧会话。

## 固定运行配置

| 项目 | M3配置 |
| --- | --- |
| 配置ID | minimax-m3-cn-v1 |
| 原生模型标识 | minimax-cn/MiniMax-M3 |
| 供应商模型 | MiniMax-M3 |
| API协议 | OpenAI-compatible chat completions |
| 唯一上游 | https://api.minimax.cn/v1/chat/completions |
| 真正凭据变量 | MINIMAX_API_KEY，只在AgentMo代理中使用 |
| SDK凭据 | 仅本机随机AGENTMO_NATIVE_PROXY_TOKEN，不接触真实key |
| 思考 | thinking.type=disabled |
| 输出上限 | max_completion_tokens=2048，n=1 |
| 服务档位 | standard，拒绝priority |
| 请求/历史/输入 | 48KiB、32条、最新用户文本最多8000 Unicode码点 |
| 重试与fallback | 全部禁用，一次上游尝试 |

保留当前本机回环入口19492/19493作为候选，实际操作前再次核对空闲，不接管
未知进程。供应商的更大上下文和多模态能力不扩大当前纯文本边界。
MiniMax-M3.1-Flash-Preview、M Plan、国际站和其他模型不在本规格中。

官方SDK文档确认M3支持关闭thinking、流式usage和输出限制。当前目标SDK已
识别minimax-cn；但真实M3消息形状仍须用该SDK加模拟上游验证，不能凭标识
或文档宣称集成通过。

## 贯穿正式工件的接口

1. User Need、Design Plan、Blueprint的native分支新增可选字段
   `native_model_profile`；当前只允许显式值`minimax-m3-cn-v1`。该字段在
   non-native分支拒绝；缺省保留DeepSeek，不从自然语言或环境猜测供应商。
   Stage 2复制并核对该字段和真实来源绑定，不能从一份旧批准制造新model选择。
2. Build Contract的native specification.runtimeBinding和Package对应资源
   包含选定profile与真实model；投影和闭包准入核对同一固定选择。
3. nativeBinding增加M3所需的可选`modelProfile`字段。缺省仅表示旧DeepSeek，
   M3必须显式绑定；它进入整个install/activate plan身份、回执binding、消费
   和预算attempt键。实际预检从已准入archive核对该profile，不信任请求自述。
4. probe、install、activation配置和Agent登记检查从同一仓库固定配置选择。
   sensitive action逐项绑定M3上游、目标model和MINIMAX_API_KEY变量名。
   原公开CLI和--runtime-env-file复用，不增加任意--upstream或--base-url覆盖。
5. native acceptance允许两个受支持的配置model，并核对验收model与实际
   nativeBinding、Package/Blueprint来源一致。用例输入、31分预留和19类集合
   不变；runtime/observation/独立review摘要仍必须精确匹配。
   delivery-report不得接受M3证据拼接旧DeepSeekPackage/回执/activate plan。

所有旧native工件和Course Wiki路径保留原行为。默认不能改为M3，不能通过
仅改CLI参数、环境变量或response.model字符串切换配置。

## 共享预算与协议适配

复用course-wiki-budget的账本校验、create-only预留和一次调用机制。加入仅由
仓库固定配置选择的请求/响应模型与上游，旧调用者默认仍为DeepSeek；不接受
调用者传任意URL、模型对象或价目表。不新建账本，不退款、不释放旧slot/claim。

native薄代理规范化M3请求到max_completion_tokens=2048、thinking disabled和
standard。SDK遗漏thinking时只按已批准固定配置补入disabled；显式要求其他
模式、tools/附件/未知字段或错模型时花费前拒绝，不截断输入。M3响应model、
usage和有界纯文本协议须经固定配置验证；其他模型不能作为自动fallback。

国内官方当前标准服务、512K以下的刊例上限是输入4.20元/百万tokens、输出
16.80元/百万tokens，当前折扣价更低。本规格不依赖折扣、缓存或priority。
按既有usage验收上限53248输入tokens和2048输出tokens推算为0.258048元，
向上取整26分，小于现有31分预留。该推算依赖当前价格和token上限，不是
供应商账单证明；执行前重新核对价格，价格或边界漂移时保留预览并拒绝运行。
仍须验证完整请求字节限制、SDK消息形状与输入token边界，不能仅靠返回后
usage校验声称花费前token计量已经被证明。

预算仍CNY100累计上限，当前4743分保守预留。后续若提案五次真实调用，新增
最多155分，合计最多4898分，可用至少5102分；模型切换本身不批准这五次调用。

同时补充现有错误边界的有界诊断：仅允许已有脱敏错误类别与可验证的数字
upstream HTTP状态（若存在）；不保存消息、headers、body或原始异常。
保持客户端失败语义、claim和预留、不重试。这样新失败可区分受控类别，但
不能恢复上次已丢失的真实状态，也不增加单独诊断API调用或持久会话日志。

## 新运行根与批准门禁

私有候选根的本机路径及路径摘要只保存在本次proposal；尚不存在，不初始化。
新Agent ID仍meeting-text，预算引用为原共享账本。独立批准存储必须在对应
具体预览获批后创建，真实identity和消费日志不能提前编造。

实现通过后，重新生成真实Discover/Plan/Blueprint/Build Contract/Package来源
链，保留来源缺口；涉及新增来源或需求摘要的门禁按真实预览重新批准。
安装、独立存储初始化、激活和付费都展示当时确切产物再由用户批准。
旧安装、激活和付费批准均不能授予新的域名/model/root或填造前驱回执。

本规格批准仅允许生成书面实施计划，随后审阅该计划并继续既有单一实现者
流程。没有真实安装、激活、模型请求、账号/额度接口调用、提交或push。

## 验证与审阅范围

覆盖Stage 2字段传播和旧字节兼容；正式来源/Package闭包/profile错配；计划
敏感动作、回执、nonce防重放与安装/激活前拒绝；M3请求/response/费用/去重
负例；真实目标SDK加模拟上游的M3注册/聊天/错误/恢复。合成证据不冒充真实
页面或模型语义。旧Course Wiki与DeepSeek回归必须保留。

新模块的包发布库存、I/O清单、Node20 syntax/producer归属与文档消费者同步。
仓库Node20信任策略不改；新producer用空缺临时收据，成功后发布原字节并跑
发布后消费者。完成整批独立审阅、Stage 2/support-triage、必要打包验证、
npm run check和git diff --check后才能把实施证据记为通过。

真实验收仍需19类固定观察和独立实际内容评审。reviewer/model ID、配置标签
或哈希不认证人类身份、供应商模型权重、语义或生产质量。

## 参考与当前限制

- [MiniMax国内OpenAI接口](https://platform.minimax.cn/docs/api-reference/text-openai-api)
- [MiniMax国内按量定价](https://platform.minimax.cn/docs/pricing/overview)
- 既有规格：2026-09-29-native-chat-isolated-openclaw-design.md。
- 当前失败结果：计划工作区task-6-paid-acceptance-2026-10-13/RESULT.md。

本机.env只做过元数据核对。用户确认了变量名与服务类型；key存在性、有效性、
账户余额、M3实际响应和真实费用均未验证。本规格不声称这些条件已满足。
