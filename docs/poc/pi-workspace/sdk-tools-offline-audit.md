# Pi SDK read/write 与 M3 费用依据：离线核对

日期2026-11-16。只读检查固定SDK1.2.0已安装文件和AgentMo源码，未导入或执行实际SDK，未联网更新价格。原累计5053分/35笔、10000分上限及全部失败现场保持。

2026-11-17最新状态：r2实际工具兼容验证已通过，以下11月16日判断保留为历史。新的[M3报告与费用核对](m3-preparation.md)补入SDK估算、通用count_tokens与上下文目录的证明边界。[两页官方资料读取](../../../release/evidence/2026.11.17-pi-workspace-m3-public-docs-execution.json)随后获批单次执行：价格页完整取得，兼容页超时后关闭；当前标准价已核对，输入token上界仍缺，未重试或调用模型。

## 接口核对结果

| 边界 | 固定SDK/本地事实 | 当前结论 |
| --- | --- | --- |
| 工具选择 | SDK的core/sdk.js保留显式tools列表；AgentMo传noTools=all及read/write | 静态接法一致；实际装配仍须验证 |
| 扩展注册 | SDK扩展loader接受对象schema并注册工具；AgentMo通过loadExtensionFromFactory注册顺序工具 | 沿用原生扩展，不执行任意来源代码 |
| 原生wire | SDK的api/anthropic-messages.js非strict转换保留type/properties/required，去掉顶层additionalProperties | 本地workspaceWireToolSchemas及固定来源fixture已对应；宿主参数继续严格拒绝额外字段 |
| read | 父进程createWorkspaceTools只返回批准资料快照或随包Skill正文 | 本次验证只授权Atlas计划和project-brief Skill |
| write | write校验固定output/report.md、最多一次、引用已读取来源，再写report.staged.md | 本次只验证暂存，不能声称正式成果发布或业务质量通过 |
| 原生循环/历史 | createPiSession复用Pi模型循环、SessionManager与工具消息；宿主核对每次wire和成功终态历史 | 假SDK回归通过，实际单次执行在首个wire校验失败，工具往返仍未通过 |

源码入口：[SDK适配](../../../src/pi-sdk.js)、[宿主工具](../../../src/pi-workspace-files.js)、[wire与历史](../../../src/pi-workspace-protocol.js)。固定SDK转换摘录及来源摘要见[已保存fixture](../../../test/fixtures/pi-workspace/sdk-1.2.0-tools-wire.json)。本轮额外记录8个静态依据文件的原字节摘要，见[离线证据](../../../release/evidence/2026.11.16-pi-workspace-tools-preparation.json)。

## 费用依据及未证明部分

[历史M3规格](../../superpowers/specs/2026-10-13-native-chat-minimax-m3-design.md)记录当时国内标准服务输入4.20元/百万tokens、输出16.80元/百万tokens。它是历史快照，本轮未联网确认现价。

如果计费输入最多53248 tokens、输出最多2048 tokens，按上述历史价：

```text
单请求条件成本 = (53248×4.20 + 2048×16.80) / 1000000
               = 0.258048元
六请求条件成本 = 1.548288元
六请求本地预留 = 6×0.31 = 1.86元
```

算术成立，发送前上界仍未证明，原因有两项：

1. 完整请求JSON不超过49152 UTF-8字节，不足以严格推出供应商计费输入不超过53248 tokens。现有固定SDK/仓库没有可据此成立的M3 tokenizer及服务端工具schema提示开销上界合同。
2. SDK/provider返回usage后的53248/2048检查发生在请求已产生费用之后，不能代替花费前限制。当前价与计费规则也没有在本轮离线工作中重新核实。

因此保留31分为原合成测试参数和本地预留额度，不能宣称供应商账单已受它严格约束。生产workspaceCostEnvelopeProven保持false，不改价、不增加原预算、不旁路门禁。[M3准备说明](m3-preparation.md)继续不能作为付费运行批准。

## 最小后继验证

[无凭据工具预览](sdk-tools-preview.md)只执行一个合成任务：固定SDK读取Skill、读取一份合成资料、暂存报告、完成回复。四个上游响应由内存假数据提供，网络连接和端口监听全部拒绝；不经过真实供应商，不使用真实预算或批准存储。它可核实实际SDK协议与工具装配，不能证明M3生成质量或费用上界。


后续实际结果：[单次无凭据工具执行](../../../release/evidence/2026.11.16-pi-workspace-tools-execution.json)已获批并运行，在首个原生请求的wire断言失败，尚未提供模拟SSE回复或执行read/write。具体字段差异未保存，静态一致结论不能升级成实际兼容。子进程已停止、原预算与authority不变，原批准关闭。


后续修复：已静态确认固定SDK默认附加eager_input_streaming:true，现有wire预期遗漏已精确修复，缺失/false/未知字段仍拒绝；19项相关回归、7项运行器检查与最终组合验证完成。[r2无凭据工具预览](sdk-tools-r2-preview.md)待单独批准。旧批未保存字段详情，不宣称唯一旧根因已实证；M3费用门禁保持关闭。


2026-11-17：[r2单次验证](../../../release/evidence/2026.11.17-pi-workspace-tools-r2-execution.json)已按新批准通过，4条wire诊断全部接受，实际SDK完成3个受限工具、1份报告暂存并退出；另以纯数据检查落盘原生历史。旧r1失败保持，不推断旧批唯一根因。费用上界与真实M3成果仍未证明。
