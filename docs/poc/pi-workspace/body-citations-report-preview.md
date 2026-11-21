# 正文引用修复包的单次 M3 报告预览

2026-11-21。待批准。新写入工具只接收目标路径和 Markdown 正文。宿主把 `[source-1:L3]` 形式统一为 `[source-1:L3-L3]`，严格核对引用是否来自已读取的授权资料及实际可用行号，再按正文首次出现的顺序生成去重清单。缺引用、格式错误、未知或未读来源、越界和倒序行号均拒绝写入。报告摘要绑定规范化后的正文。

已用上一批失败的 Atlas 正文单独跑过离线写入校验。21 处标记全部保留，5 处单行简写被统一，生成9条清单并在新临时目录暂存成功。没有改写旧批次或产出正式报告。90项相关回归通过，覆盖写入格式、拒绝不合法引用、CLI 的合成读写链路和成果清单。[上一批失败](../../../release/evidence/2026.11.21-pi-citation-repair-execution.json)与[本次准备证据](../../../release/evidence/2026.11.21-pi-body-citations-repair.json)

## 一次执行范围

1. 在新根 `.agentmo/project-brief-pi-minimax-m3-report-2026-11-21-r4` 安装精确计划中的8文件、6目录及标记和回执，核验回执。使用原批准存储、账本和现有 Pi SDK 1.2.0、Node 24.18.0。
2. 在本机回环端口 `127.0.0.1:19492/19493` 创建1个空会话后停止。这段模型请求为0。
3. 通过现有 CLI 在该会话运行1个相同的 Atlas 报告任务。最终核验正式报告、正文标记与自动清单、实际读取的来源行号、规范化文件摘要及停机。独立核对事实和引用支撑后才交付报告、CLI 用法与验收结果。

材料仍是原两份合成资料[Atlas 计划](materials/atlas-plan.md)和[Atlas 状态](materials/atlas-status.md)，共369字节，随包 `project-brief` Skill 为原200字节。固定任务如下。

> Read the two approved project documents and follow the packaged project-brief skill. Write one Markdown report with Conclusions, Evidence and Information gaps. Cite source IDs and line ranges for factual claims. Do not invent missing dates or budget figures. Stage the report with the write tool, then give a brief final summary.

报告应准确反映 Atlas、负责人 Maya、截止 Friday、项目目标、试点状态、清单审阅结果及供应商交付日期尚未确认，并说明资料未提供数值预算。上限为 **6次 MiniMax-M3 请求、8次工具调用、1次写入**，报告最多8192字节。单次执行，失败停止，无重试或重启。报告任务10分钟、每请求90秒，控制器执行段20分钟，每段自有清理另最多300秒。最终停止自有服务。连接观察器只记录有限阶段，不增加请求。

保留累计52.08元的原账本和全部失败现场，本次按原规则最多新增1.86元本地预留。获批后仅既有父运行器在内存加载供应商密钥，助手、评审者和SDK子进程不读取其值。这份预览包含新安装及此次模型运行，当前新根和本次批准均不存在。不提交或推送。

## 固定工件

| 项目 | SHA-256 |
| --- | --- |
| 147文件运行源码 | `sha256:f2f0dba6f9493c16055eebc925f36531c2641b0cd7ada904f72ad242e864def2` |
| Build Contract | `sha256:6b43de3c1453a3166d2ec6a334c55db4054fd457ce87fa9500dd3608ca543014` |
| Plan 绑定 | `sha256:fd701404d7a6b0259e070b36777482b742d101d80387e678ecbecae4ac451a1e` |
| 安装包 `.d42` | `sha256:c5d58de2bfc0d42d1736f0998ba5e89d74a8c827e57111920100905be0682e4a` |
| 安装计划 | `sha256:9adff7434cde5631448dc5f8779c95f7fd00aed21f6c299836e53af092e81a8c` |
| 运行器 | `sha256:54665c817401229c018fc024ca8d3b062e6f09a8746f1fc603c3a23888729b8d` |
| 连接观察器 | `sha256:9be9725b6b4e2c46d2bd9e11c3c453e49ec170a478675b26513be1d5dcc944dc` |

共用离线预检已通过。整库检查的实际进度见准备证据，真实 M3 成果仍待验收。
