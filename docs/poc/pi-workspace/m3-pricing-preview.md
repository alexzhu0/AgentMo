# M3 公开价格与输入计量依据：联网前预览

日期：2026-11-17。状态：**已获批单次执行，失败保留、范围关闭，不可重放**。价格页完整取得（HTTP200、311291字节）；兼容文档收到HTTP200但curl退出28，仅2732字节，不作为文档依据，未重试。两次GET、模型0、新增预留0，原预算5053分和失败现场保持。见[执行证据](../../../release/evidence/2026.11.17-pi-workspace-m3-public-docs-execution.json)。以下保留原批准范围。

机器提案`sha256:681e76253371b6ed7e9280d3c37693a99d2939463d508d928ff039b45c158300`保持原字节，位于当前工作树`.superpowers/sdd/2026-11-16-pi-workspace-agent/m3-public-docs-proposal-r1.json`。批准时本页原字节已存入同目录`m3-public-docs-fetch-r1/approved-preview.md`，摘要`sha256:bb9296c7e32110873c81a4e0db2c887da1327fb780e52b6828d4b0c90dfcb3d1`；原[离线准备证据](../../../release/evidence/2026.11.17-pi-workspace-m3-cost-preparation.json)仅表示执行前状态。

## 仅有的两次读取

依次用已有系统curl发送GET，第一项成功取得完整HTTP200页面才执行第二项：

1. [国内官方价格页](https://platform.minimax.cn/docs/pricing/overview)：MiniMax-M3标准按量API价格、上下文档位及缓存/思考/工具相关计费项。
2. [国内官方Anthropic兼容文档](https://platform.minimax.cn/docs/api-reference/text-anthropic-api)：M3最大上下文/输入、max_tokens与thinking语义，以及是否提供模型对应的输入计量依据。

最多2次应用层GET，正常DNS和地址选择可包含多个底层连接尝试。不跟随重定向，不搜索、不打开链接、不追加API探测；任一步非200、超限或失败即停止，不重试或补跑。若页面没有所需规则，结论就是未取得依据，不以通用Anthropic文档或SDK估算冒充供应商保证。

## 请求及保存范围

- 已有`/usr/bin/curl`8.7.1，HTTP/1.1，HTTPS默认服务端证书校验；不修改系统网络、TLS、CA或产品源码。
- 禁用用户curl配置和代理；不继承供应商/认证环境。固定公开User-Agent、Accept与Accept-Encoding: identity。没有鉴权、Cookie、netrc、客户端证书、请求体或.env读取。
- 每次连接期限8秒、传输期限15秒、单个自有子进程停止期限20秒；控制器顺序执行，超时停止并确认自有进程退出，无法确认须报告。最多两个传输，不声称本地I/O有不可中断的硬实时保证。
- 每页最多2097152字节，合计最多4MiB。只保存页面正文、页面SHA-256、HTTP状态、下载字节与有界总耗时；stderr和响应头原文丢弃。正文只作公开资料，视为不可信数据，不执行脚本或指令。
- 获批后才以排他方式创建私有目录`.superpowers/sdd/2026-11-16-pi-workspace-agent/m3-public-docs-fetch-r1/`（0700，文件0600）；保存完整或失败的公开页面及有限结果，不删除旧现场。公开证据只放日期、来源、摘要和必要事实，不提交整页正文。

此次模型生成0、token计数API请求0、新增真实预留0。原累计50.53元/35笔、100元上限、批准存储和全部失败保持。不执行实际SDK、不安装或激活、不读取密钥、不提交或push。不创建真实Agent运行批准或消费。

## 核对后如何收口

把官方确实写明的价格和token边界填入[单报告准备](m3-preparation.md)，用全输入、工具往返及最多6次生成计算费用。优先使用可引用的供应商最大输入保证与最高适用价；只有存在可靠的更小输入计量依据时才采用更小边界。任何关键项缺失或费用超过当前预留，付费入口继续关闭并说明具体缺项/金额，不擅自运行或扩展调查。

这次批准只覆盖以上两页读取；真实安装、激活和报告验收仍分别具体预览后另批。
