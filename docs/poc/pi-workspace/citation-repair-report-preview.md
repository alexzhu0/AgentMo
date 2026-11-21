# Pi 引用修复包的单次 M3 报告预览

2026-11-21。离线修复、回归和安装包已就绪，等待本次具体批准。上一批运行已关闭。[上一批执行记录](../../../release/2026.11.21.md)

上次写入参数的正文有23处格式正确的引用标记，清单只有2条概括范围，两边没有精确对应。Pi 发给模型的写入说明现要求先完成正文，再把每种不同的标记按来源、起始行和结束行逐项列入清单。同一来源的不同范围也分别列出，单行仍写出起止行。提示附上一个完整的正文与清单配对示例，现有写入校验和工具协议保持原样。[离线修复证据](../../../release/evidence/2026.11.21-pi-citation-repair.json)

## 本次执行范围

1. 在全新的 `.agentmo/project-brief-pi-minimax-m3-report-2026-11-21-r3` 按精确计划安装8个文件、6个目录及安装标记和回执，复用原批准存储。安装后核验回执。旧根及失败现场保留。
2. 使用本机现有 Pi SDK 1.2.0、Node 24.18.0 和回环端口 `127.0.0.1:19492/19493`，创建1个空会话后停止自有服务。此段模型请求为0。
3. 在该新会话经 CLI 运行1个报告任务，读原两份 Atlas 合成资料与随包 `project-brief` Skill。生成1份最多8192字节的 Markdown 报告。逐项独立评审事实、实际读取的来源及行号，核对正文和引用清单对应、成果摘要、完成记录与停机。实测通过后交付报告、CLI 用法和结果。

材料为[Atlas 计划](materials/atlas-plan.md)和[Atlas 状态](materials/atlas-status.md)，仍为原152和217字节，随包 Skill 保持200字节。固定任务原文如下。

> Read the two approved project documents and follow the packaged project-brief skill. Write one Markdown report with Conclusions, Evidence and Information gaps. Cite source IDs and line ranges for factual claims. Do not invent missing dates or budget figures. Stage the report with the write tool, then give a brief final summary.

报告须正确说明 Atlas、Maya、Friday、项目目标、试点准备状态、清单审阅情况及尚未确认的供应商日期，明确资料没有数值预算。事实引用须指向这次实际读取的来源和支持对应事实的行。最终成果写入新私有任务目录，核验摘要后保留交付副本。

上限为 **6 次 MiniMax-M3 请求、8 次工具调用、1 次写入**。单次执行，失败即停止，不重试或重启。任务10分钟、每请求90秒、控制器执行段20分钟，每段自有清理另最多300秒。被动观察器只记录有限的连接阶段和状态，不增加请求。复用原账本，保留已累计的51.46元，仅按原规则最多新增1.86元本地预留。最多追加3次批准消费和11项决策。获批后只有既有父运行器在内存加载供应商密钥，助手、评审者和SDK子进程均不读取其值。不提交或推送。

## 固定工件

| 项目 | SHA-256 |
| --- | --- |
| 147文件运行源码 | `sha256:4b4bc5ef8fa463ea085283171da1ad49d58859c988d4033d51c39aa34df5fe40` |
| Build Contract | `sha256:e9e4bb5d34a29ff11c97dd980deb713c27a98a1e90de5e72a3b10b4387e5cce4` |
| Plan 绑定 | `sha256:fd827c14378b2e27694b05b421e2104d98ac493353960d5558d3257b0ca29dcb` |
| 安装包 `.d42` | `sha256:a414f070663ef5b5468603e5ac9bf7b09bf8643f7f4375dcfd88fb99337b84ab` |
| 安装计划 | `sha256:acff0a1be4db584e7a525c75bd048b547688a7491d9f54c02069c1ee17cf518d` |
| 运行器 | `sha256:54665c817401229c018fc024ca8d3b062e6f09a8746f1fc603c3a23888729b8d` |
| 连接观察器 | `sha256:9be9725b6b4e2c46d2bd9e11c3c453e49ec170a478675b26513be1d5dcc944dc` |

新回归先在旧提示上失败，修复后66项相关测试通过。测试用提示里的原样示例通过实际写入校验，概括范围、正文漏列或清单多列的写入仍被拒绝。共用离线预检已通过。整库检查的状态与本次机器提案摘要另见[准备证据](../../../release/evidence/2026.11.21-pi-citation-repair.json)。当前没有新安装、激活或模型调用。真实模型能否稳定遵守引用要求仍待这次验收。
