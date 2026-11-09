# MiniMax M3同会话追问：历史预览（已单次失败、关闭）

2026-11-09 执行结果：用户已批准本提案；仅执行一次，Pi/CLI就绪后上游ECONNRESET失败，没有最终回复或独立内容评审。新增预留31分、累计4898分，自有服务stopped/ownChildExited=true，无重试或重启。本范围关闭，不能重放；见[脱敏证据](../../../release/evidence/2026.11.09-agentmo-core-mvp-m3-followup.json)。下方原预览保持为历史，不是新的运行授权。

2026-11-06。首条真实验收已完成：`Product: Atlas`得到合法两字段JSON，Product=Atlas、Deadline=null，技术与独立内容评审均通过；1请求/+31分，累计4867分，自有服务已停止。见[首问证据](../../../release/evidence/2026.11.06-agentmo-core-mvp-m3-entry.json)。本次只准备第二项，不执行SDK、激活、读取密钥或发送模型请求。

提案：`sha256:0ee3be27ec7703f638f17378b617cf30d0cfc0428549ca05ae067f9af958cdfc`。激活计划：`sha256:c097741d26dd066ca015db49c33a706f3360e7a570554b50a2f42b33f667ff04`；计划原字节：`sha256:f3df56b1220e529db26bc1f4195d26b60e29829e9b79f2773b4d9009fb5c1115`。

## 文字、判定和费用

只在现有会话A发送一次固定文字：

`Deadline: Friday`

16个Unicode码点，摘要`sha256:5d974bf94c75ef7b07cc21b5f151f411a18b536bff88952cd172305eb7394cb6`。恢复同一Pi原生会话，发送其既有首问/回复和这条追问作为上下文；不新建会话。预期仅JSON对象，恰好Product和Deadline两键，Product保留为Atlas、Deadline更新为字符串Friday；不加围栏、说明、额外字段或推算日期。实际规范化回复须再做独立内容评审。

最多1次MiniMax-M3请求，新增本地预留最多31分（0.31元），累计4867→最多4898分（48.98元）；原10000分上限保持。原四项总新增上限124分/累计4960分不扩大。失败保留预留，不退、不重试、不补跑；本地预留不等于供应商token账单。隔离与最终恢复两项仍须另行具体预览批准。

## 绑定和动作

| 绑定 | 值 |
| --- | --- |
| 实际安装回执 | `sha256:3066fc461489416ccc3eccd74336a71971792016cec2e25e3cfd5c36af5da80c` |
| 固定包 | `sha256:a029179aaa580ada828b7eee8fb8b117a56c283f2a485b1791402332e26526bc` |
| 冻结源码 | `sha256:3a101a8bfdc5a8a11893278af1343d984f9911762afc4c10eb7d06df7391b500` |
| A会话ID摘要 | `sha256:c0f434d31e04e310e7184573a1b062eb8b4d251a3684a8ea986c8f1ef398955b` |
| 首条真实最终回复摘要 | `sha256:f5b30c8fc083d1cf19596c3f9cf07e901bd0118c1839dbc1cb1df4f406c01e93` |
| 首条执行结果摘要 | `sha256:e9fee77e0ecfc9450fcb723be1f7c2da236c7b7b49264a5535f9b7ba7973befd` |
| 实际独立内容评审摘要 | `sha256:e554167e362c760fef41c2333d62a63c9d3161102c891c42d947b1e9940ba04c` |
| 当前批准日志 | `sha256:3c5ce619a7e486da77aeae08541d257aa4fe3867f1fd764b3c28efe1d472c23d`，17消费/63决策 |
| 当前预算 | 29笔/4867分，原10000分上限 |

获批后签发5项新决策：普通写入、内存加载MiniMax key、启动预算代理、启动Pi子进程、空冲突；追加1次消费，预计17/63→18/68，保留旧日志前缀。只使用已安装SDK1.2.0、现有Agent根、原生minimax-cn/MiniMax-M3及原生SessionManager；回环19492/19493。实际回执、来源、源码、SDK/Node/lock、预算、日志或会话绑定漂移即拒绝，不修补后继续。

只有获批后的既有父运行器在内存从主项目.env加载MINIMAX_API_KEY；助手、评审者和SDK子进程不读取其值，SDK只使用一次性本机代理凭据。供应商仅固定`POST https://api.minimax.cn/anthropic/v1/messages`，48KiB/32消息、输出2048 tokens、上游90秒、重试0；无额外联网诊断或其他模型调用。

20分钟工作上限包含I/O和独立评审，另最多300秒自有清理。执行一次，失败停止、不重试、不重启、不补跑；结束停止自有服务，只有stopped且ownChildExited=true才确认停止。保留原预算、全部失败与首条成功证据，不提交或push。

私有完整绑定：`.superpowers/sdd/2026-11-05-agentmo-core-mvp/m3-followup-proposal-r1`。已通过只读preflight；本提案尚无真实运行批准、决策签发、消费、激活、密钥加载、请求或新增预留。首条通过不等于四项全部通过或生产认证，全仓检查缺口保持。
