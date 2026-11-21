# Pi Workspace：具体安装候选预览

日期2026-11-16。状态：r2提案已由用户批准仅安装，并单次安装核验成功，批准关闭不可重放。实际8文件/6目录、回执c1c5af6d，authority24/91且原5053分预算不变；见[安装证据](../../../release/evidence/2026.11.16-pi-workspace-install.json)。下一道[只读预览](readonly-preview.md)后获批准并在启动前权限预检失败，范围已关闭。以下保留原安装范围与批准前条件。提案`sha256:e23676517581d4080da4094d814c09eb4153bf2bb7d1828b4bb4eab9d1ece614`；安装计划`sha256:efe3eaa689d7fad7c75a636f8ca88abdd7ec0bcf4372a7006671f6d4e33483b6`。本页不授权实际安装或运行；旧r1候选与失败记录完整保留。

## 安装对象与确认范围

新Agent为project-brief（项目资料简报），根据两份明确授权的文字资料，使用随包project-brief Skill和受限read/write，生成带引用及信息缺口的report.md。它是本次能力的合成验收载体，不恢复会议助手，不认证真实业务质量。

候选来源只有本次生成的合成方法文档，完整声明与字段在下表精确工件中。Discover与Plan的候选approval字节仅用于生成可检查的包；`approve`字段不是本轮新的真实人类授权。后续批准本安装提案时，还需明确确认这些精确来源与Plan元组，才可用于真实安装。

| 工件 | SHA-256 |
| --- | --- |
| 来源清单 | sha256:8d34be86a70a63dcfd3f81063e51812fb223125d2c3d91be41efd84b6269688f |
| Discovery DB | sha256:17ccbaa92fe850423fafeade81d14fc6b1f52ef347749de12761d1a4a9858bd0 |
| User Need | sha256:4a84bcc982b592a21844a90265d22bc9e11263fcc56635d9cd227dbd5b008600 |
| Design Plan | sha256:cd564dea3ecbf398bd88ba4f069b6cb418d971bd67b5a464e51f779b6aa14b97 |
| Blueprint | sha256:c7deb54796cb56322fd10c9d8f47b0736b449a71a628e9e30a267b12dd57eb75 |
| Build Contract | sha256:b0b962a164211b321fa2fbfc3617cc8227d8ffa3c1752768d2f52373199c089e |
| 候选 Plan approval | sha256:c38c41dbd08ff629d8e28e46c24e6d187f9165075a30afb9c256bfc250c96342 |
| Pi目标描述 | sha256:3b216ff937b7520ec54f4724a08c56fc350cb84b125d79a82d3fe4255dcfb330 |
| 载体准入 | sha256:fa58696032b70a2a6c97eaee49eafa60ecc8ccede24bb609c3aa022867c06627 |
| Discover预览 | sha256:4a5399c78750654a0bdfd45851f15dc3487177bc67e1dffd6224409555ecbab9 |
| Plan预览 | sha256:19a1853983c3276f173d47cb67c9e1c43a44c8ec9cca7003eb3aa241f003fc75 |
| 源码闭包（147文件） | sha256:045db6db7bc44b7edcc27450b648818d3617f21781bfa460dd1cf8c0a39c3201 |
| .d42归档 | sha256:8f1c1b76f34aede3c3f2647f38396cbb6739a6323cc7b0c82ebff2e70c94d89a |
| 安装计划原字节 | sha256:b4449dd87c94ba5375a7ce6e84ca82b87d8d2442eef78907a75d239cf5db698f |

新Plan保留6项partial来源覆盖缺口：授权读取、报告生成、事实忠实性、引用成果、抵御资料指令、越权/覆盖/预算失败边界。合成验证不能抹去来源缺口或替代真实SDK、M3与领域验收。

随包Skill全文（200 UTF-8字节）：

```text
---
name: project-brief
description: Summarize project evidence and gaps
---
Use the approved sources. Cite evidence for conclusions, list missing information, write the report, then explain briefly.
```

## 获批后的唯一真实改动

新根`.agentmo/project-brief-pi-minimax-m3-workspace-2026-11-16-r1`已核验不存在。按既有Pi安装器创建根和6个子目录（0700）：`attempts`、`browser`、`sessions`、`skills`、`skills/project-brief`、`turns`；写入以下8文件（0600）。browser为既有通用包资源，此次不启动浏览器或服务。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| agent.json | 611 | sha256:19caa03a211f708001c792ee9ac16a2ed6a666283cc137255fe1fca9de5a0745 |
| browser/client.js | 6333 | sha256:9d6e66626a6b7c25b3b2382fa558994ee3a53659da2b4c6c1883dd4aa831e494 |
| browser/index.html | 2155 | sha256:18fac10343f2b1c2dd1fb8ecb7420cbb999602b36ab50f35bd81ab02fe3137cb |
| browser/style.css | 2703 | sha256:208b92b6e476873d8382c9865b8bf8a895cb3c2612f0d81b4e5ac6fa393ccac1 |
| runtime-binding.json | 884 | sha256:fd9482f279f8b2e7b75958ee8027cb0604ebe0e4934223bb9cd961b74ecaa164 |
| skills/project-brief/SKILL.md | 200 | sha256:65908f111203326fd9fdc2fab18eb7aeea343043596ce6a07d2991383806f770 |
| system.md | 963 | sha256:daba1668cc09ff5f95abcda68e290ab3d2b977cc66d8025340c8588d91aec6f2 |
| workspace-policy.json | 1084 | sha256:25faf217196e3272a93421c2a9b02563578e838dc5b438164307e825dd9b988a |

安装器还会按实际阶段写入`installation.started.json`、`install-receipt.json`、`installation.complete.json`；失败时尝试记录`installation.incomplete.json`，均0600。沿用现有applyPiInstall及verifyPiInstallation，不伪造成功回执、不覆盖或清理旧根，不登记会话。仅签发普通写入和空冲突2项新单次决策，向原批准存储追加1次消费；成功后只准备真实回执绑定的独立SDK/只读激活预览。

## 原存储与执行前条件

复用`.agentmo/meeting-text-pi-minimax-m3-authority-2026-10-19-r1`与`.agentmo/course-wiki-project-budget-2026-09-20`，不初始化、不重置。维护记录为authority23消费/89决策、预算5053分/35笔/10000分上限；若成功安装，消费变为24/91，预算不变。

本轮只读取历史冻结安装计划中的绑定元数据，没有重新读取真实authority或预算存储；不能把历史绑定称为本机当前重验通过。获批后，在任何签发或消费之前，须只读核验原存储身份、历史日志前缀/当前计数、预算原累计、目标根仍不存在，以及本提案、源码、归档、Node/SDK/lock的精确绑定。任一漂移即停止，不安装、不补跑。

一次整批独立审阅发现5项Important和1项Minor，控制器全部接受并由原工程会话修复；r2集中回归271项全部通过。原r1审阅结论仍为reject，不能写成修复后字节另获独立PASS。r2共45个本批文件已冻结且核对无漂移，最终`npm run check`退出0：主集1535通过/60跳过/0失败/0取消，随后四项官方专项全部通过。旧跨改动检查中止记录和启动配置失败均保留，不改写为通过。完整统计及绑定见[离线交付证据](../../../release/evidence/2026.11.16-pi-workspace-offline.json)。

私有候选：`.superpowers/sdd/2026-11-16-pi-workspace-agent/candidate-r2`；提案：同目录上级`install-proposal-r2.json`。所有写入必须绑定上述精确计划，旧批准和历史执行脚本不能重放。

本提案最多执行一次，失败停止、保留现场、不补跑。不读取.env/密钥，不执行实际SDK、不联网、不激活、不调用模型；新增真实预留0，不提交或push。[M3准备说明](m3-preparation.md)单列固定材料、最多6次请求及费用待证项，不属于安装授权。当前生产workspace费用门禁仍关闭，安装成功也不代表可直接运行模型。
