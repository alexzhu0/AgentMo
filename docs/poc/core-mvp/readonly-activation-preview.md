# Pi CLI只读激活预览（待批准）

2026-11-06 执行结果：用户批准本提案后仅执行一次，SDK/API鉴权、创建1空会话、60003ms空闲和自有停止均通过；ownChildExited=true，turn/模型claim/新增预留均0。单次范围已关闭，不得重放。见[只读证据](../../../release/evidence/2026.11.06-agentmo-core-mvp-readonly.json)；下一步[M3首条预览](m3-entry-preview.md)尚未批准或执行。以下为此前原预览。

日期2026-11-06。对象为已安装的新field-extractor。提案`sha256:c323f6d2a97c8b9ea4436aa26bbf3a83962e400d718dd49b4c1aa5dee9320e6a`；激活计划`sha256:d07f6bc6a87c428a374b0cfc8f0c7305a447837201faa38b577607dd735145b1`。当前只做了来源/回执准入及preflight，没有执行SDK或激活。

| 绑定 | 摘要 |
| --- | --- |
| 实际安装回执 | `sha256:3066fc461489416ccc3eccd74336a71971792016cec2e25e3cfd5c36af5da80c` |
| 已执行安装计划 | `sha256:b32079ffc202993e213bda511b3580e0193a987223c80048028526db47697ae9` |
| 激活计划原字节 | `sha256:d89a0b4eeed0eb123d4f5291f5cc8c9a6d6e2a81d2cd9012f7e12c9a89eba033` |
| 包 | `sha256:a029179aaa580ada828b7eee8fb8b117a56c283f2a485b1791402332e26526bc` |
| 运行源码 | `sha256:3a101a8bfdc5a8a11893278af1343d984f9911762afc4c10eb7d06df7391b500` |
| 原批准日志当前头 | `sha256:e81c669d59c89f9e365f7084f151f44129bbb270619036882b378af89f4c9d85` |

新根`.agentmo/field-extractor-pi-minimax-m3-2026-11-06-r1`已真实安装，6文件/4目录及标记/回执通过核验；attempts、sessions、turns目前均为空。来源/Plan元组已随上一道安装提案获用户确认，不再借用或重复询问旧会议批准。

## 获批后的一次操作

本次使用固定激活计划的既有`startPiNative → connectPiCli → live.stop`调用链；未来pi-chat启动参数向量供后续产品入口使用。本轮结果只证明本机SDK/API只读机制，真实TTY任务与M3内容仍待各自证据。

1. 重验8项已安装来源、实际回执、SDK/Node/lock描述、批准日志15消费/54决策与4836分原预算，漂移即停止。
2. 签发4项新决策：普通写入、start-budget-proxy、start-pi-child、空冲突；向原存储追加1次消费。空approvedCases、restartAllowance=0，无load-minimax-key动作。
3. 运行现有Pi SDK1.2.0及既有父/自有子进程，启用127.0.0.1:19492与19493。只通过CLI客户端使用现有本机API，不发送聊天文字。
4. 客户端在内存使用本机临时登录凭据，列出空会话、创建恰好1个空会话，再核对登记与列表一致。登录值不打印、不进入公开证据；助手和观察器不读取login/control正文。
5. 空闲观察60秒，核验没有turn/上游请求claim和新增预算预留。只报告这些实际观察及现有空scope约束，不把它夸大为任意后台网络的全面认证。
6. 关闭客户端并用本次live.stop自有句柄停止。只有stopped且ownChildExited=true才能报告停止成功；否则明确记录停止未确认，不猜PID、不重复启动或重启。

启动300秒、供应商边界90秒、停止300秒不放宽；本轮20分钟工作总限含I/O，失败或到期另最多300秒清理。执行一次，失败停止、不补跑，不删除原现场。批准前不签发这4项决策、不消费、不运行SDK、不创建会话。

## 成本和授权边界

不传runtime-env-file或apiKey，不读取.env或供应商密钥，模型请求0、新预留0；原28笔/4836分、10000分上限保留。当前15/54预计只增加为16/58，旧日志前缀保留。只允许必要回环服务/客户端通信；没有供应商、外部诊断、浏览器操作、安装或更新工具链。

M3真实验收仍另批；本次只读检查即使通过，也不证明模型可用或领域质量。无提交或push。

私有绑定文件在`.superpowers/sdd/2026-11-05-agentmo-core-mvp/readonly-proposal-r1`；其中含精确source-files和未来公开pi-chat参数向量，均未执行。这里的摘要不能代替实际准入和用户批准。
