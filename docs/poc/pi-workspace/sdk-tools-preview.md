# Pi SDK：最小无凭据工具验证预览

日期2026-11-16。状态：本提案已获批单次执行，在首个native-wire校验失败后停止；模拟响应0、工具0，子进程已退出。原预算5053分/35笔、authority25/95保持；范围关闭，不可重放。见[实际执行证据](../../../release/evidence/2026.11.16-pi-workspace-tools-execution.json)。未记录请求字段形状/断言细节，具体不匹配字段尚未确定；以下保留原批准范围和预期检查内容。依据见[接口与费用核对](sdk-tools-offline-audit.md)。本次不是已安装Agent的激活，也不授予M3调用。

| 绑定 | SHA-256 |
| --- | --- |
| 本次提案 | sha256:fee3a0cd08fce0e13da051a3bf1001903b61c84ec2e89e4d1e64cfcb6ec92268 |
| 固定运行器 | sha256:e4ee30c2a5e072095cc301d0f7efb76cc383aebbd886eee977b1ce7f5826db79 |
| 固定合成配方 | sha256:ebd109c4f260af354578da69857f8676d0ac4977a8c7c8f540a0fe7ff1569d70 |
| 实际安装回执 | sha256:c1c5af6de7e95b94b268c32ee8a4cfb08d818e71d4224f3580d9ef02ebce2621 |
| 运行源码闭包（147文件） | sha256:045db6db7bc44b7edcc27450b648818d3617f21781bfa460dd1cf8c0a39c3201 |
| 单份合成输入 | sha256:5c91264d5f07d0bb8d80f957f2448a5175d85a2e656928443173b3ce3b0f5ab7 |

## 单个用例与调用数

固定任务：“Read the packaged project-brief skill and the approved Atlas plan. Stage a short cited report, then summarize completion.”

资料是[Atlas合成计划](materials/atlas-plan.md)，只含Atlas、Maya、Friday及项目目标；方法是已经安装的200字节project-brief Skill。宿主捕获这两个确定资源，SDK使用原生扩展与会话运行。

内存中的假上游依次返回四个固定SSE响应：

1. read读取`skills/project-brief/SKILL.md`。
2. read读取`sources/1.md`，对应上述Atlas计划。
3. write将下列固定报告暂存到`output/report.md`的宿主对应文件`report.staged.md`。
4. 最终文字回复：“Synthetic tool check complete; the cited report is staged.”

```markdown
# Project brief

## Conclusions
Atlas is owned by Maya and targets Friday. [source-1:L3-L5]

## Information gaps
The approved plan does not state a numeric budget.
```

合计最多4次内存模拟请求、3次工具调用、1次暂存写入、1个全新隔离会话。额外请求或工具、协议/引用不符、任何试图建立网络连接或监听端口的操作均失败停止。真实模型调用0、供应商费用0、真实新增预留0；这些响应是固定测试数据，不能当作模型完成了任务。

验收要求：实际SDK仅装配read/write，Skill进入上下文；每次原生请求通过现有wire校验，工具参数和回传结果匹配；最终回复和原生会话历史通过校验；暂存文件原字节及引用匹配；SDK会话dispose完成、自有子进程退出、原预算和authority不变。只验证暂存，不发布正式成果，不重启或测试其它场景。

## 执行与停止范围

- 使用已有Node24.18.0、固定SDK1.2.0，不安装或更新依赖。
- 新建一个当前工作树下的私有合成根`.superpowers/sdd/2026-11-16-pi-workspace-agent/tools-check-run-r1`。它必须原先不存在。根/目录0700，文件0600；写入单次claim、一个合成会话的SDK文件、一个暂存报告及结果。成功或失败都保留，不清理旧现场。
- 不启动已安装Agent、19492/19493服务或预算代理；不创建真实authority决策或消费，不使用真实/合成费用账本。原authority25/95与完整日志摘要4443f14f、原预算5053分/35笔/10000分上限只读核验。
- 不读.env或供应商密钥。适配器要求的API形状参数仅使用固定合成占位符，注入SDK内存后清除；它不具备供应商权限，不从任何凭据文件读取。
- 全局fetch只接受逻辑地址`http://127.0.0.1:19593/v1/messages`及SDK固定beta查询，并直接返回内存Response。该地址不监听、不连接；Socket/TLS/HTTP及listen均被拒绝，没有联网诊断或真实API探测。
- 工作取消期限180秒，覆盖预检与I/O；停止IPC后10秒发SIGTERM、15秒发SIGKILL，16秒确认期限。信号不能保证操作系统立即结束进程；退出不能确认须报告unconfirmed。仅处理本次自有子进程。单次运行，失败停止、不重试、不重启、不补跑。
- 不改产品源码、安装、费用门禁或原失败记录，不提交或push。

独立批准后才创建`human-tools-check-r1-approval.json`。具体调用在当前course-wiki工作树根执行：

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C TZ=UTC \
  /usr/local/bin/node \
  .superpowers/sdd/2026-11-16-pi-workspace-agent/tools-check-runner-r1.mjs \
  --execute-approved-once \
  sha256:fee3a0cd08fce0e13da051a3bf1001903b61c84ec2e89e4d1e64cfcb6ec92268
```

机器提案为同私有目录的`tools-check-proposal-r1.json`，合成配方为`tools-check-fixture-r1.json`。本轮只运行同一脚本的`--preflight-only`，未创建合成根、批准记录或SDK子进程。离线用例验证了内存响应、4次请求硬上限、网络/监听拒绝、完整预检及缺批准拒绝。之前一次手写错误提案摘要在预检入口被拒绝，未产生运行写入；正确摘要预检通过，失败记录保留。

本提案只证明固定SDK工具协议兼容。生产预算代理、已安装Agent的CLI工具完整通路、M3实际生成、正式成果发布和供应商费用上界仍不在本次证明范围，生产付费入口保持关闭。


后续修复：已静态确认固定SDK默认附加eager_input_streaming:true，现有wire预期遗漏已精确修复，缺失/false/未知字段仍拒绝；19项相关回归、7项运行器检查与最终组合验证完成。[r2无凭据工具预览](sdk-tools-r2-preview.md)待单独批准。旧批未保存字段详情，不宣称唯一旧根因已实证；M3费用门禁保持关闭。
