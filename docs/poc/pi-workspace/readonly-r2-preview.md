# Pi Workspace：r2实际SDK与空会话只读检查预览

日期2026-11-16。状态：本提案已获批单次执行并通过，范围关闭、不可重放。实际SDK就绪、1空会话、60001ms空闲后停止，自有子进程已退出；模型0/新增预留0，原预算5053分不变，authority25/95。见[实际执行证据](../../../release/evidence/2026.11.16-pi-workspace-readonly-r2-execution.json)。以下保留原批准范围和执行前条件。旧r1单次失败关闭；本提案不重放旧批准。仅修正私有辅助脚本权限并补齐运行器自身读取路径预检，不改Agent源码、安装或检查范围。

辅助脚本install-inputs.mjs已从0644收紧到0600，内容摘要不变；原0644副本、权限清单及失败记录已封存。r2实际运行与`--preflight-only`使用同一段预检：提案→运行器→辅助脚本→安装来源/回执→产品预检→authority/预算→空运行目录。离线入口在签发决策和启动SDK前退出，不创建批准或运行attempt。真实运行仍必须有新的精确批准。

[离线修复证据](../../../release/evidence/2026.11.16-pi-workspace-readonly-r2-offline.json)记录原权限RED、修复GREEN、实际读取器拒绝旧权限/符号链接/内容漂移，以及缺新批准时执行入口拒绝。已完成的[安装](../../../release/evidence/2026.11.16-pi-workspace-install.json)不授权本次运行。

| 绑定 | SHA-256 |
| --- | --- |
| 本次提案 | sha256:35cc87e74f24024d420575466a8790a1896da6257009724d5b2d67b265cbd272 |
| 激活计划 | sha256:9d929145add1992d65f15dc58df2e48dcca1d3d51f09baabc52263f0568573cd |
| 激活计划原字节 | sha256:df1367db791597d52e79e67a464aba6533e773b0b8586a929e35a5e59b632249 |
| 实际安装回执 | sha256:c1c5af6de7e95b94b268c32ee8a4cfb08d818e71d4224f3580d9ef02ebce2621 |
| 原安装计划 | sha256:efe3eaa689d7fad7c75a636f8ca88abdd7ec0bcf4372a7006671f6d4e33483b6 |
| 运行器 | sha256:ad739fa62124b1e7ef2a29fdcab04a427edbd6a323493e4cd06a02f66cc732a7 |
| 运行源码闭包（147文件） | sha256:045db6db7bc44b7edcc27450b648818d3617f21781bfa460dd1cf8c0a39c3201 |

## 仅执行这些步骤

1. 只读重验实际回执、原存储身份和日志、预算、源码、SDK、Node及空的运行目录。任一漂移即停止。
2. 签发普通写入、启动预算代理、启动Pi子进程、空冲突共4项新单次决策，追加1次消费。原authority从24消费/91决策变为25/95，旧前缀保留。
3. 使用已有Node24.18.0和固定SDK1.2.0，启动127.0.0.1:19492聊天/健康入口与127.0.0.1:19493预算代理。通过CLI客户端鉴权，不打开浏览器；本机登录值仅由客户端在内存使用，不输出。
4. 创建恰好1个空会话，核对客户端列表与落盘注册一致。无任务文字、无聊天发送、不加载workspace任务或执行read/write工具。
5. 观察60秒，确认turn与模型claim为0、原预算完全不变。关闭客户端并停止本次自有服务，核对stopped及ownChildExited=true。

批准前不会创建运行批准记录。获批后只执行一次；失败停止、不重试、不重启、不补跑。20分钟工作取消期限覆盖预检、I/O及观察；清理另最多300秒。取消信号不是操作系统级强制杀进程保证；停止无法确认时如实标记unconfirmed并保留现场，不把超时当作成功。

## 文件、进程与预算范围

- Agent根：当前course-wiki工作树的`.agentmo/project-brief-pi-minimax-m3-workspace-2026-11-16-r1`，不重新安装。
- 原authority：`.agentmo/meeting-text-pi-minimax-m3-authority-2026-10-19-r1`，执行前日志摘要`sha256:30f45d8c40fc5e98e8eaf4ec9a15a872a0f886aa560f61898ca1d19ee0d47d2a`。
- 原预算：`.agentmo/course-wiki-project-budget-2026-09-20`，累计5053分/35笔，10000分上限。本次新增0分、真实模型0请求、供应商连接0。
- SDK：`.agentmo/pi-sdk-1.2.0-toolchain-2026-10-16-r1`；Node为`/usr/local/bin/node`。不安装或更新依赖。
- 写入仅为4项批准及1次消费、本批私有执行证据、Agent的`attempts/pi-*`控制/登录/启动阶段/停止文件，以及一个会话的注册和SDK会话文件。所有本机鉴权值不得进入公开证据；旧安装与全部失败保持。
- 不传`runtimeEnvFile`、`apiKey`或`workspace`，不读取.env或供应商密钥，无模型请求和新预留，不提交或push。

具体调用在工作树根执行：

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C TZ=UTC \
  /usr/local/bin/node \
  .superpowers/sdd/2026-11-16-pi-workspace-agent/run-approved-readonly-r2.mjs \
  --execute-approved-once \
  sha256:35cc87e74f24024d420575466a8790a1896da6257009724d5b2d67b265cbd272
```

机器提案保存在`.superpowers/sdd/2026-11-16-pi-workspace-agent/readonly-proposal-r2/readonly-activation-proposal.json`，绑定全部来源、真实回执、固定运行器和激活计划。运行器沿用既有单空会话流程，增加共用只读预检出口与细分读取阶段；原调用数、费用、超时、停止和批准规则不变。白名单环境下已实际运行完整预检并通过，覆盖运行器自身读取路径；尚未执行SDK或服务启动分支。获批后才写入新的human-readonly-r2-approval.json，旧批准无效。

成功只证明此安装的SDK启动、空会话及空闲停止通路。工作区工具的实际SDK装配、工具请求费用包络和真实M3成果仍未验证；[M3准备说明](m3-preparation.md)继续保持`cost-envelope-unproven`，不能借本批准发送模型请求。
