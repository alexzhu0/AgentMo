# Pi 生态源码逆向调研与 AgentMo 能力补齐建议

日期：2026-11-13。状态：公开源码调研与开发建议，尚未批准为新产品规格，也未实施新运行能力。

后续决定（2026-11-16）：用户已选择本文路线A的最小范围，并要求一并编写[下一版规格](../superpowers/specs/2026-11-16-pi-workspace-agent-design.md)与[离线实施计划](../superpowers/plans/2026-11-16-pi-workspace-agent.md)。以下保留调研当日结论；新能力尚未实施，真实运行继续另批。

## 结论

AgentMo 继续负责 Discover → Plan → Produce，把需求、来源、能力边界和验收条件固化为可复现的 Agent；Pi 继续负责 provider、Agent 循环、扩展和会话。下一步最有价值的补齐，是让生成的 Agent 在授权资料中完成工作并输出成果文件。现有原生 provider 和 SessionManager 已经接通，不需要重新造运行框架。

这是结合上游实现和本地源码得出的工程判断，不是对上游项目的性能、安全或领域质量认证。以下只借鉴机制，未复制代码、安装项目或执行它们的测试。

## 阅读对象与版本

选择标准是可定位的真实集成代码、与 Pi 的直接关系，以及能否回答资料、工具、会话和交付问题；不是按 stars 排名。快照只代表本次读取时的提交。

| 项目 | 本次固定提交 / 版本 | 值得借鉴的部分 | 兼容性与取舍 |
| --- | --- | --- | --- |
| [Pi 官方](https://github.com/earendil-works/pi/tree/47e9d74f9186de37e700693fac0f6e56a499657a) | 主线 47e9d74；另核实 v1.2.0 对应 06a4669 | 原生工具、ResourceLoader、Skills、会话 SDK | 以我们锁定的 1.2.0 接口为实施依据；主线文档只辅助理解 |
| [PiChat](https://github.com/earendil-works/pi-chat/tree/9adbd29b40ee27ff1decf0fc87cbe180b40924f5) | 9adbd29；package 0.1.0 | 原生工具委托、按渠道划分记忆和 Skills、文件附件交付 | 使用旧包名及宽松 peer 版本，不直接安装；不引入 Discord、Telegram 或 VM |
| [PiClaw](https://github.com/rcarmo/piclaw/tree/68492a34ed6e839bf00edb169452e31cbb845b97) | 68492a3；package 3.3.4，Pi 依赖 1.5.2 | 原生会话与扩展装配、工具操作覆盖、文件记忆 | 借鉴接法；不复制较新 SDK 接口，不引入整个 Bun/Web 平台 |
| [Pi MCP Adapter](https://github.com/nicobailon/pi-mcp-adapter/tree/1382423d353a06146f1b720631dccbfe81a1905d) | 固定提交 1382423 | 工具审批、连接复用、空闲关闭 | MCP 是后续可选项，不是本次首要缺口；不采信未经本地验证的性能比较 |
| [OpenClaw](https://github.com/openclaw/openclaw/tree/a7d05c7af04aa17ac57c994da238d0c60f058ca6) | a7d05c7；package 2026.11.3 | 用作大型产品与运行层边界的对照 | 当前入口已使用自身 AgentSession/agent-core；不能据历史关联当作可直接复用的 Pi SDK 应用 |

Pi 官方旧仓库入口 badlogic/pi-mono 当前指向 earendil-works/pi。本次核实了 [v1.2.0 标签](https://github.com/earendil-works/pi/tree/06a466935536f8c9bcacb2d5efc0fc021be1bdff)，没有把最新文档 API 当成已安装版本的保证。OpenClaw 的判断来自其当前 [package.json](https://github.com/openclaw/openclaw/blob/a7d05c7af04aa17ac57c994da238d0c60f058ca6/package.json) 与 [session SDK 入口](https://github.com/openclaw/openclaw/blob/a7d05c7af04aa17ac57c994da238d0c60f058ca6/src/agents/sessions/sdk.ts)，并非仅据 README 推断。

完整仓库、提交、文件路径及 Git blob 标识见[来源清单](2026-11-13-pi-source-manifest.json)。本次是静态阅读，未验证上游完整产品、依赖供应链或测试通过情况。PiChat 的 README 许可文字与实际文件有出入；本次以其 [LICENSE](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/LICENSE) 的 Apache-2.0 为准，不复制实现。

## 从实现中提取的四个模式

### 1. 用 Pi 原生循环，给工具接上受控的实际操作

Pi 1.2.0 已有工具选择与扩展注册；自定义工具通过扩展注册，既有工具可覆盖其文件操作。PiChat 把原生工具定义委托到自己的执行环境；PiClaw 也通过工具工厂覆盖实际操作。这些实现支持“保留 Pi 循环，把文件权限和产品行为放在宿主边界”的做法。来源：[1.2.0 工具示例](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/05-tools.ts)、[扩展示例](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/06-extensions.ts)、[原生 read 操作接口](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/tools/read.ts#L44)、[PiChat 委托](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/index.ts#L1307)、[PiClaw 工具工厂](https://github.com/rcarmo/piclaw/blob/68492a34ed6e839bf00edb169452e31cbb845b97/runtime/src/agent-pool/tool-factory.ts#L46)。

不能仅设置工作目录就声称文件已隔离。Pi 的路径解析支持绝对路径与用户目录展开，默认 read 操作读取本机文件；Pi 官方也明确要求更强隔离时另设执行边界。我们的最小方案应只允许来源清单中的输入和指定输出根，不默认开放 bash、edit 或任意本机路径。来源：[1.2.0 路径处理](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/src/core/tools/path-utils.ts#L44)、[官方执行边界说明](https://github.com/earendil-works/pi/blob/47e9d74f9186de37e700693fac0f6e56a499657a/README.md#L85)。

PiChat 对宿主文件读取使用 realpath、范围比较、NOFOLLOW 和普通文件检查；这提供了可借鉴的实现位置，但该函数本身不是完整的安全保证，例如不能据此假定已有限定读取字节数。AgentMo 仍需保留自己的受保护路径、链接、大小、编码和输出边界。来源：[PiChat 文件读取](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/index.ts#L127)。

### 2. Skills 和领域资料是可装配资源，聊天记录不是全部知识

Pi 1.2.0 的 ResourceLoader 已支持明确的 Skills 列表和上下文文件覆盖。PiChat 先展示 Skills 元数据，匹配时再读取正文；同时区分账号共享资料与渠道资料。对 AgentMo 的启发是：把用户批准的 SKILL.md、任务模板和领域约束作为包资源装配，复用原生加载接口。来源：[1.2.0 Skills 示例](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/04-skills.ts)、[上下文示例](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/07-context-files.ts)、[PiChat Skills 提示装配](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/index.ts#L220)。

上游示例会从常见用户目录自动发现资源；这不是 AgentMo 应直接采用的权限策略。应保留明确资源清单，不扫描用户全局目录，不执行从资料中临时生成的扩展。读取公开源码不等于批准运行第三方扩展。

### 3. 保留原生会话，把长期记忆做成小而可检查的文件

Pi 原生 SessionManager 已有创建、打开和继续会话的接口；PiClaw 的持久化层也围绕公开会话方法组织。AgentMo 已经使用原生创建/打开并取得恢复样本，无需重写 JSONL 历史或另建会话引擎。来源：[1.2.0 会话示例](https://github.com/earendil-works/pi/blob/06a466935536f8c9bcacb2d5efc0fc021be1bdff/packages/coding-agent/examples/sdk/11-sessions.ts)、[PiClaw 持久化接口](https://github.com/rcarmo/piclaw/blob/68492a34ed6e839bf00edb169452e31cbb845b97/runtime/src/agent-pool/session-persistence.ts)。

PiClaw 把长期资料分为用户、反馈、项目与参考文件，并对记忆索引设置行数/字节上限。可借鉴的是显式文件与有界注入；没有证据要求我们现在增加向量库、后台 Dream、定时总结或自动记忆模型调用。第一项真实工作如不需要跨任务记忆，应直接延后这一能力。来源：[PiClaw 记忆实现](https://github.com/rcarmo/piclaw/blob/68492a34ed6e839bf00edb169452e31cbb845b97/runtime/src/agent-memory/refresh.ts#L7)。

### 4. 外部工具按需连接，工具权限和连接生命周期单独控制

Pi MCP Adapter 有单次允许、会话允许和拒绝等审批分支；连接管理记录使用中请求，空闲判断避免关闭仍在工作的连接，生命周期控制器可关闭空闲服务。这些是可参考的具体实现。它包含重连等策略，不能直接移植为 AgentMo 的默认行为。来源：[工具审批](https://github.com/nicobailon/pi-mcp-adapter/blob/1382423d353a06146f1b720631dccbfe81a1905d/tool-approval.ts#L139)、[连接空闲判断](https://github.com/nicobailon/pi-mcp-adapter/blob/1382423d353a06146f1b720631dccbfe81a1905d/server-manager.ts#L2244)、[空闲关闭](https://github.com/nicobailon/pi-mcp-adapter/blob/1382423d353a06146f1b720631dccbfe81a1905d/lifecycle.ts#L140)。

按需发现/启动是其 README 声明的设计；本次没有运行或测量它，也没有验证 README 对其它实现的性能比较。Pi 自身已有 MCP 支持，因此当前没有引入额外适配器的必要。等真实工作需要一个明确外部服务时，再比较原生 MCP、直接小工具和第三方适配器。

## 对照 AgentMo：已经有的能力与真实缺口

本地基线：codex/course-wiki，HEAD 2979a7086b522e114a766efd5e17b7ac2a2b6e55，工作树已有未提交修改。本次只读下列源码，没有修改产品实现。

| 能力 | 当前事实 | 下一步含义 |
| --- | --- | --- |
| 构建工厂 | Discover → Plan → Produce、来源、合同、包、安装/运行证据均已实现 | 保留现有三阶段；把新增能力落实到已有合同与包，不另建一套流程 |
| 原生 provider / 会话 | [pi-sdk.js](../../src/pi-sdk.js) 已调用原生 MiniMax provider 和 SessionManager.create/open | 保留已接通路径；不用迁移会话引擎或换 provider |
| 输入资料 | 构建时有 discover-workspace；[现有 CLI](../CORE_MVP_RUNBOOK.md) 的 /file 能捕获授权 .txt/.md | 不是完全不能读文件；缺的是 Agent 在任务中按需读取多份授权资料 |
| 业务工具 | [Pi 包投影](../../src/targets/pi-package.js) 声明 tools/扩展为空、MCP 关闭；pi-sdk 禁用全部工具 | 这是原 MVP 零工具边界，不是 Pi 本身缺能力；需要显式可选能力 |
| 工具协议与循环 | pi-sdk 的上下文只接受文字，拒绝工具事件，且只允许一个最终回复；[请求校验](../../src/course-wiki-budget.js) 不接受 tools/tool_use/tool_result | 不能只打开工具列表；必须配套工具消息与多轮结束条件 |
| 调用预算 | [pi-budget-proxy.js](../../src/pi-budget-proxy.js) 对每条输入使用一次性请求凭据 | 一次用户任务可能需要多次模型交互，需逐请求预留并限制整项任务；原账本不得重置 |
| Skills / 领域上下文 | pi-sdk 的自定义 ResourceLoader 当前返回空 Skills、扩展、提示模板及 agentsFiles | 通过既有加载器接入已批准资源；不另造插件市场 |
| 成果交付 | 现有输入/输出主要是 CLI 文字，Pi 包没有运行时成果文件工具 | 明确输出路径和格式，让任务产出 Markdown/JSON 等可保存文件 |
| 记忆 | 同会话追问、隔离、停止恢复已实测；跨任务项目事实尚无专用机制 | 会话继续复用；项目记忆按真实需求另加，首轮不强求 |
| 用户入口 | 已有薄 CLI、逐次确认与停止；Codex 已负责装配路径及摘要 | 保留现入口，优先展示任务、资料、成本与成果；暂不重写启动器 |

关键代码位置：pi-sdk.js 的原生上下文过滤在 97–104 行，空资源加载在 124–127 行，会话创建/打开在 129–130 行，工具关闭在 140–146 行，工具事件拒绝在 154 行；course-wiki-budget.js 的 Pi 请求校验在 204–211 行；pi-budget-proxy.js 的一次性请求限制在 169–172 行。

### 首要跨层问题：一条任务不总是一条模型请求

以下是根据代码路径作出的推导：模型通常先返回工具调用，宿主执行工具，再将工具结果送回模型生成回答；因此一次工具任务通常需要多次上游请求。当前“每条输入最多一次请求”的预算/凭据规则以及文字专用校验会阻止这个循环。只把 tools 从空列表改为 read/write，无法形成可用能力。

最小修改必须一并涵盖：允许的工具与参数、工具结果消息、任务中每次上游调用的预留、整项任务的调用/费用/时间上限，以及取消和失败终止。由 Pi 驱动原生循环，AgentMo 执行边界校验。不放宽现有文字档位，不借工具开启自动重试，也不复用旧固定样例的 31 分金额作为新任务成本保证。

本次没有验证实际 MiniMax M3 工具生成、工具结果回传或领域质量；它们不能由原文字样例成功推定。后续先做离线协议与假上游验证，真实模型仍需具体预览及新批准。

## 两条可选路线

| 路线 | 最小实现 | 优点 | 代价与适用范围 |
| --- | --- | --- | --- |
| A：有界原生工具任务（建议） | 沿用 Pi 循环；先只接授权输入读取与指定成果文件写入，支持有上限的工具往返 | 生成的 Agent 能主动查资料、完成工作并交付文件；后续 Skills 可复用 | 需要一起适配请求协议和任务预算；真实运行须重新预览 |
| B：固定文字工作流 | 宿主预先捕获明确文件，通过现有文字路径请求一次，再由宿主保存成果 | 修改较少，沿用现有单次调用形态 | 更适合固定转换；Agent 不能在任务中自主选择或追加读取资料 |

建议 A，前提是先选定一项真实工作，确定确实需要按需读取资料。若只需把一份输入改写为一份输出，B 已足够。用户尚未选择这两条路线，本报告不把建议当作批准，也不把路线 B 描述成尚无 /file 入口。

## 建议的下一份最小交付与 TODO

候选真实工作：用户授权一个本地文字资料目录，Agent 读取指定材料，按领域模板生成一份带来源引用的 Markdown 报告，允许对报告追问或更正。具体领域、输入和最终交付物仍待用户选择；不恢复已停止的会议助手。

1. 确定真实任务与输入/输出示例，选定 A 或 B。验收直接围绕这项工作，不再只围绕 Atlas 两字段样例。
2. 在现有 Plan、Build Contract 与 Pi Package 中明确输入清单、输出位置、允许工具和任务上限。保持原文字档位兼容；不新建通用能力平台。
3. 如果选 A，先实现读取/写成果两个操作与有界原生工具循环；只读授权输入、只写指定输出，默认没有 bash、任意联网、MCP、后台任务或自动重试。若需要 Skills，先随包携带一份批准的任务说明。
4. 离线验证正常资料到成果、缺资料不编造、越界和秘密路径拒绝、工具结果回传、调用/费用/时限耗尽停止、取消以及原生会话恢复。使用假 SDK/假上游和独立合成账本，明确与真实模型证据区分。
5. 新实现通过后，准备绑定实际包和回执的具体安装及真实 M3 验收预览，写清材料、模型调用上限、成本与停止行为。当前累计 50.53 元/原 100 元上限保留，不能重置，也不提前授权新增调用。

项目记忆、MCP、网络搜索、多 Agent、消息平台、浏览器产品、调度器和 SDK 升级均排在这份最小交付之后；只有真实工作证明必要才纳入。

## 本次边界与证据状态

本次仅通过 GitHub 连接器读取公开仓库、核实固定提交并与本地源码对照。没有读取 .env 或密钥，没有执行实际 SDK、安装/激活 Agent、请求供应商模型或改动本机运行状态，没有提交或 push。

当前 v0.1 Alpha 的文字样例能力与原失败记录继续有效。四种固定行为的通过证据来自两次独立授权；旧四项整组失败没有改写，网络稳定性、真实 TTY 与领域/生产认证仍不因此获得证明。正式运行边界以[当前状态](../CURRENT_STATUS.md)和后续逐项具体批准为准。

调研文件与索引仅做文档检查；上游程序、工具适配、M3 工具生成与新能力均未执行、未验收。
