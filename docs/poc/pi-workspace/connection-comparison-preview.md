# Pi/M3 两条连接路径：无凭据对照预览

日期2026-11-17。状态：**已获批单次完成，范围关闭，不可重放**。旧路径DNS/TCP成功、TLS未观察到完成，35657ms ECONNRESET；Pi默认参数路径HTTP404、TLS1.2，845ms关闭。两项自有socket均确认关闭，模型/SDK/密钥/新增预留0。见[执行证据](../../../release/evidence/2026.11.17-pi-connection-comparison-execution.json)。原批准页面与源码原字节已私有归档，以下保留批准范围。

在同一个已有Node24.18.0进程中，使用同一个https.request客户端，依次执行以下两项，各1次HEAD：

| 项目 | 固定地址 | 请求级TLS范围 |
| --- | --- | --- |
| 当前AgentMo路径 | https://api.minimax.cn/anthropic/v1/messages | 仅TLS1.2，与现有postPiMessages相同 |
| Pi默认连接参数路径 | https://api.minimaxi.com/anthropic/v1/messages | TLS1.2–1.3，与当前Node默认范围相同 |

第二项采用已安装Pi minimax-cn目录的地址和Node默认TLS范围，不导入或执行SDK。两项同时涉及域名与TLS上限差异，结果只回答两条完整路径当前能否到达HTTP阶段，不能单独证明哪个变量导致历史重置，也不证明POST、鉴权或报告生成可用。

## 固定边界

- 最多2次应用层HEAD，固定公开User-Agent、Accept及Accept-Encoding: identity；agent:false、证书验证开启。没有鉴权、Cookie、请求体、重定向或应用层重试；底层DNS和地址选择可包含多个连接尝试。
- 单项期限75秒，覆盖旧失败约68秒的文件时间间隔；每项自有socket停止确认另最多2秒，整个进程160秒取消保护。只处理本次自有连接，不修改系统代理、TLS全局值、证书或产品源码。
- 两项是预先列明的独立对照：第一项网络错误或到期后，确认自有socket已关闭，再执行第二项一次。停止无法确认、环境/来源/批准校验失败或进程到期时终止，不追加请求或补跑。
- 仅保存socket分配、DNS回调、TCP连接、TLS连接、HTTP头到达和关闭的有界相对时间；TLS1.2/TLS1.3白名单标签、数字HTTP状态、白名单网络错误码、期限及关闭布尔值。忽略事件载荷，不读取IP、证书内容、响应头原文、正文或原始异常文本。
- 白名单环境仅PATH/LANG/TZ；兼容macOS系统编码变量键名但不读它的值。未知环境键先拒绝；不读取.env、密钥、netrc或代理凭据。
- 获批后才排他创建本机私有目录`.superpowers/sdd/2026-11-17-pi-connection-comparison/connection-comparison-once`（0700，文件0600），保存单次claim、两项结果和最终摘要；成功或失败均保留，不覆盖旧现场。

本次真实模型请求0、新增预算预留0，不执行SDK、不安装或激活Agent、不提交或push。原累计5084分/36笔、10000分上限和原authority保持。

固定运行器compare.mjs、机器提案proposal.json和后续批准记录位于同一本机私有目录。9组离线自检及白名单预检通过，均为0网络；覆盖固定地址/TLS/公开头、无请求体、事件载荷与异常不泄漏、连接关闭、期限/迟到响应及非法HTTP状态拒绝。提案摘要与原字节依据见[离线诊断证据](../../../release/evidence/2026.11.17-pi-connection-offline-diagnosis.json)。

批准后仅以白名单环境执行该运行器的`--execute-approved-once <提案摘要>`。不消费旧报告批准，不重放失败模型任务；这次批准仅覆盖以上两次无凭据HEAD。
