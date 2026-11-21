# Pi SDK：r2最小无凭据工具验证预览

日期2026-11-16。状态：已于2026-11-17获批单次执行并通过，范围关闭、不可重放。4次内存模拟请求/3工具/1暂存完成，暂存164字节报告及落盘合成历史核对通过，子进程退出，原预算5053分不变；见[实际执行证据](../../../release/evidence/2026.11.17-pi-workspace-tools-r2-execution.json)。以下保留原批准范围与执行前条件。旧r1在首个wire失败后关闭并保留。已离线确定固定SDK缺省会附加eager_input_streaming:true，旧预期遗漏；本次精确补入true，仍拒绝false、缺失或其它未知字段。旧批未记录字段差异，因此不宣称这是旧失败的唯一实证根因。

新运行器保留同一合成任务、请求/工具数及停止规则，增加每请求的值盲诊断：顶层键集合是否匹配、未知键数、模型/输出/思考参数是否匹配、system是否匹配、两项工具schema是否匹配、eager标志是否为true、消息数及拒绝类别。只记布尔值/有界计数/固定类别，不保存正文、headers、未知键名或异常差异文本。

安装回执仅作原包及Skill的只读参考；本次SDK会话使用修复后源码的全新描述器，已静态确认SDK闭包、Node、lock和身份全部保持。不会覆盖旧安装，也不把修复后源码当作已安装或获批运行的新版本。

| 绑定 | SHA-256 |
| --- | --- |
| 本次提案 | sha256:d99971a32500a0777d71f98e9ccd9323ce784b4f18df1c06a11ff8113bd90c30 |
| 固定运行器 | sha256:2deff618d4c8460b5d0023483ee93f52cedd69c059a6cb022b076f79a0f29d60 |
| 固定合成配方 | sha256:ebd109c4f260af354578da69857f8676d0ac4977a8c7c8f540a0fe7ff1569d70 |
| 实际安装回执 | sha256:c1c5af6de7e95b94b268c32ee8a4cfb08d818e71d4224f3580d9ef02ebce2621 |
| 运行源码闭包（147文件） | sha256:e1f34bc5ea6ca25a3237f9ac59334122643dabe4a83bd6c07e601d21ea9c61e3 |
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
- 新建一个当前工作树下的私有合成根`.superpowers/sdd/2026-11-16-pi-workspace-agent/tools-check-run-r2`。它必须原先不存在。根/目录0700，文件0600；写入单次claim、一个合成会话的SDK文件、一个暂存报告、每请求诊断及结果。成功或失败都保留，不清理旧现场。
- 不启动已安装Agent、19492/19493服务或预算代理；不创建真实authority决策或消费，不使用真实/合成费用账本。原authority25/95与完整日志摘要4443f14f、原预算5053分/35笔/10000分上限只读核验。
- 不读.env或供应商密钥。适配器要求的API形状参数仅使用固定合成占位符，注入SDK内存后清除；它不具备供应商权限，不从任何凭据文件读取。
- 全局fetch只接受逻辑地址`http://127.0.0.1:19593/v1/messages`及SDK固定beta查询，并直接返回内存Response。该地址不监听、不连接；Socket/TLS/HTTP及listen均被拒绝，没有联网诊断或真实API探测。
- 工作取消期限180秒，覆盖预检与I/O；停止IPC后10秒发SIGTERM、15秒发SIGKILL，16秒确认期限。信号不能保证操作系统立即结束进程；退出不能确认须报告unconfirmed。仅处理本次自有子进程。单次运行，失败停止、不重试、不重启、不补跑。
- 不改产品源码、安装、费用门禁或原失败记录，不提交或push。

独立批准后才创建`human-tools-check-r2-approval.json`。具体调用在当前course-wiki工作树根执行：

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C TZ=UTC \
  /usr/local/bin/node \
  .superpowers/sdd/2026-11-16-pi-workspace-agent/tools-check-runner-r2.mjs \
  --execute-approved-once \
  sha256:d99971a32500a0777d71f98e9ccd9323ce784b4f18df1c06a11ff8113bd90c30
```

机器提案为同私有目录的`tools-check-proposal-r2.json`，合成配方为`tools-check-fixture-r2.json`。本轮只运行同一r2脚本的`--preflight-only`，未创建合成根、批准记录或SDK子进程。7项运行器离线用例覆盖正确工具标志、字段诊断不泄漏输入、固定SSE、4次硬上限、网络/监听拒绝、完整预检及缺批准拒绝。SDK/协议/文件/预算19项回归通过；共享协议已在新冻结树上运行完整npm命令：原命令因沙箱回环监听受限退出1（1433通过/101失败/61跳过），原日志保留。11份受影响文件在主机补验173通过/5跳过/0失败，后续四项官方检查全部退出0；采用[组合验证证据](../../../release/evidence/2026.11.16-pi-workspace-tools-r2-offline.json)，没有单次全绿声明。45文件新冻结无漂移，原安装和失败保持。提案原字节保持生成时状态，最终验证单列于上述证据。

本提案只证明固定SDK工具协议兼容。生产预算代理、已安装Agent的CLI工具完整通路、M3实际生成、正式成果发布和供应商费用上界仍不在本次证明范围，生产付费入口保持关闭。
