# Pi/M3 报告首请求：离线原因核对

日期2026-11-17。初始离线核对后，两路径HEAD另获批准并已完成：旧路径复现ECONNRESET且没有TLS完成事件，默认参数路径845ms关闭并收到HTTP404。随后仅做[默认参数离线修复](upstream-defaults-report-preview.md)，69项相关回归及7项观察器测试通过。没有执行SDK、激活或重试模型，原5084分/36笔、10000分上限和全部失败保持；以下离线事实按原证据解释。

## 已确定的失败位置

新安装、实际SDK启动及空会话已通过。真实任务留下received、reserved、sent和failed记录，说明已通过本地授权/协议/预算检查并开始一次上游尝试；sent不证明供应商已经完整收到请求。[原执行结果](../../../release/evidence/2026.11.17-pi-report-delivery-execution.json)记录COURSE_WIKI_UPSTREAM_NETWORK、ECONNRESET，没有HTTP状态字段。

[sendBudgetedCompletion](../../../src/course-wiki-budget.js)只有在本地取消/期限触发时才归类UPSTREAM_TIMEOUT；拿到上游Response后才记录HTTP状态并进入response阶段。本次记录对应等待上游连接/响应的network分支，尚未进入有效回复解析和报告处理。没有401/403/429等供应商HTTP错误证据，不能据此判断key或模型名错误。

sent与failed文件mtime相隔68366.300ms。它包含本地写盘延迟，不是精确网络耗时；失败落盘时距任务期限估算仍有488279ms，源码分类也不是90秒本地超时。当前没有DNS/TCP/TLS分段观测，无法从这批旧记录再定位重置方或具体网络阶段。

## 可以核对的连接配置差异

| 配置 | 本次AgentMo上游 | 已安装Pi provider与Node默认参数 |
| --- | --- | --- |
| 地址 | api.minimax.cn/anthropic/v1/messages | minimax-cn目录的baseUrl为api.minimaxi.com/anthropic |
| TLS范围 | 请求级固定TLS1.2 | 当前Node默认TLS1.2–1.3；SDK配置未固定TLS版本 |
| 实际路由 | SDK先请求本地代理，由AgentMo向外连接 | SDK目录地址不会自动覆盖AgentMo固定地址 |

依据：[上游实现](../../../src/pi-upstream.js)、[SDK适配](../../../src/pi-sdk.js)。固定SDK目录原字节摘要1bbfbd11，完整摘要见[本次离线证据](../../../release/evidence/2026.11.17-pi-connection-offline-diagnosis.json)。证书验证仍开启，JSON字节长度及已使用的鉴权/版本头没有发现可静态证明的错误。

域名和TLS覆盖是明确的配置偏离，尚不能当作重置根因。11月13日同一个旧域名和TLS1.2曾取得真实M3的HTTP200及有效回复，见[历史成功观测](../../../release/evidence/2026.11.13-m3-recovery-execution.json)；因此也不能简单宣布旧地址必然无效。

## 最小下一步

[两条连接路径的对照](../../../release/evidence/2026.11.17-pi-connection-comparison-execution.json)已完成，只证明这两项条件下的连接结果。最小修复选择恢复本次测通的Pi provider地址和Node默认TLS，仍保留证书验证与全部权限/次数限制；没有更换模型、增加重试或追加真实请求。[新修复包的一次报告范围](upstream-defaults-report-preview.md)已准备，真实安装/激活/模型及相关回归验证策略例外仍待新的明确批准。费用证明不再是排查条件。
