# AgentMo 跨电脑开发检查点

日期2026-10-14；2026-10-15获明确授权按最新167文件清单创建检查点并push到origin/codex/course-wiki。
本文件随该检查点提交，实际提交/push结果以Git分支为准；新电脑接班尚未完成。
2026-10-15用户随后明确要求将codex/course-wiki合并到main并push，保留本交接文档。
新电脑改从main接续；实际合并及推送状态以origin/main的Git引用为准。
维护核对日期2026-10-15；恢复入口和验收口径已同步。10月14日的164文件推送清单是历史提案，
本轮文档变化后需用新清单，不视为旧摘要已获批准。
来源为 **AgentMo 原生聊天：接任与交付** (`01a12e5d-7217-79f0-909d-82798db5e4ec`)；
接收电脑/聊天尚未指定或创建，当前聊天仍是唯一实施者，原工作树保留。

## 新电脑快速开始

若尚无项目checkout，在新电脑执行：

```bash
git clone --branch main git@github.com:alexzhu0/AgentMo.git
cd AgentMo
git status --short
git rev-parse HEAD
```

已有checkout时先检查并保留未提交改动；工作区干净后获取origin，切换到main并仅快进更新，
确认包含代码检查点b7bc297ccf100c70941536af575a8441d9b6a58e，不覆盖本机文件。
将本文件交给新电脑的Codex，首轮可直接使用以下任务：

> 接续AgentMo会议文字助手Task 6。先使用superpowers:using-superpowers并读取
> AGENTS.md、docs/SUPERPOWERS_WORKFLOW.md、docs/CURRENT_STATUS.md和本交接文档。
> 先只读核对main的实际提交、98源码快照、本机OS/Node及SDK是否存在；
> 回报缺失的私有工件/账本和首个离线动作。已有实现与离线验证已完成，不重复实现Task 5。
> 不读取或上传.env、凭据或本机运行状态，不激活或调用模型，不重置100元预算。
> 真实安装、激活及验收必须先准备适用于这台电脑的新预览并取得批准。

接班先回报四件事：当前分支/提交；98源码是否匹配；环境和私有资料的缺口；下一步离线工作。
接班核验通过前，源电脑保留资料并只做交接，不在两台电脑并行开发同一职责。
之后依次处理：离线环境验证 → 原预算迁移/共用方案及必要非秘密工件迁移 → 本机生命周期预览 → 获批真实验收。

## 代码与恢复入口

远端为`git@github.com:alexzhu0/AgentMo.git`，当前获批目标为`main`，保留`codex/course-wiki`和本交接文档，不创建Release。
10月14日准备时本地HEAD为`b95dc43839845ad8304e40768787e946d0e4657b`，只读观察到远端main为`14d18c2ed459ca706bf775d0c8548626e6a5ac12`，无同名远端分支；实际push前必须重查。
该分支包含两个既有本地提交；本次授权将167个明确路径形成新的代码检查点再push。
推送完成后的新提交ID以实际Git结果为准，不能把上述历史HEAD当作最新实现版本。

在新电脑按main checkout；源电脑的实际目录是`$AGENTMO_REPO/.worktrees/course-wiki`，
新电脑可以直接在该分支的checkout根目录工作，不必复刻旧绝对路径。
先使用`superpowers:using-superpowers`，阅读本文件、`docs/SUPERPOWERS_WORKFLOW.md`、
`docs/CURRENT_STATUS.md`、`release/2026.10.14.md`、M3规格及实施计划。
用[source-snapshot](2026-10-14-native-m3-source-snapshot.json)逐一核对98个源码/测试文件；
匹配后安装项目依赖并在新环境运行离线检查。先确认Git分支/提交和本机Node版本，
不要执行真实Agent安装或模型调用来代替恢复核验。

## 有效决定与实际成果

目标仍是Discover → Plan → Produce构建OpenClaw会议文字助手，模型固定国内按量MiniMax-M3，
profile=`minimax-m3-cn-v1`。Pi只是选型讨论，尚无迁移实施授权。
标准服务、thinking关闭、2048输出、单回复，无工具、fallback、自动重试；
真实key只给本机预算代理，SDK只持有代理token。

- 98源码冻结摘要为`f0c045f8a940020ca1732ba92e91217431013a4adb3a7763a515634934bb4b10`。
- 最终完整五段检查自然exit0：main1366pass/60skip、durable2、packed-hook1、behavior7pass/1skip、immutable1，零失败/取消。
- 独立代码审阅闭合协议与来源两项重要缺口；最终无critical/important。M3真实安装回执complete，六受管文件、三个官方命令和五批准消费均核对通过。
- 最新Node20成功生产器原字节收据在`release/evidence/2026.10.14-node20-native-minimax-source-receipt.json`，SHA`d91fd522afd42df480d304770aa8b77174b6a0ec33c7627438a23f1b5d92b729`。
- 安装回执SHA`8ff6b5ee6883e1e4fc4bd5cb213705890441cb0a5c62509b16b3e47995f9677a`，仅证明源电脑的受限安装，不证明新电脑已安装。

这些是历史证据，不认证领域质量、生产准备或跨平台兼容。新环境的完整检查尚未执行。
读取范围为当前会话的M3来源/安装批准和维护文档，非完整历史聊天审计。

## 权限与本机资料

用户批准了源电脑的M3 Discover/Plan/Produce、批准存储初始化及精确安装计划。
激活计划身份`b4c43f5e43f5238fff794693ddeb095e71c434326d78ebd8fadc2b37ab195f41`仍未获批：
用户对该问题改为询问跨电脑push，不能把这条回复当作激活批准。
目前没有网关/预算代理/控制接口，没有M3模型调用或付费验收。
先前只授权代码检查点提交及分支push；随后用户明确追加main合并及普通push授权。
本次保留交接文档和源分支，不force、不创建PR/Release，不删除源工作树或本机资料。
跨电脑代码交接不扩大安装、激活、付费或其他对外通信权限；不创建新聊天或归档旧聊天。

Git不携带`.env`、`.agentmo/`、`.superpowers/`、凭据、SDK安装或本机会话/批准消费状态。
源电脑的这些目录全部保留，不能因为push而删除。仓库已跟踪的`AGENTS.md`会随Git历史带走；
机器侧其他未跟踪的约束或配置不会自动迁移，本次不强制添加它们。
新电脑遵守维护文档及人类提供的操作约束，不读取/打印/复制`.env`内容，不访问sibling项目。
只有获批的既有运行器可在内存使用已确认的`MINIMAX_API_KEY`；密钥不进Git、URL或证据。

源电脑精确私有工件索引：`.superpowers/sdd/2026-10-14-native-chat-minimax-m3/`下
`m3-enter-plan-2026-10-14-r1`、`m3-produce-2026-10-14-r1`、`m3-install-preview-2026-10-14-r1`、
`m3-install-2026-10-14-r1`、`m3-activate-preview-2026-10-14-r1`。
新电脑不能假定它们存在或冒用原批准；需要这些非秘密工件时先准备具体值盲迁移清单。
真实状态根/批准存储含本机身份，不能复制后当作新电脑的有效安装或激活授权。

## 下一步与预算约束

新电脑先只读恢复代码和历史证据，再做离线/模拟开发。若准备真实运行，先观察该电脑的
SDK/Node/路径和端口，生成新的正式来源及安装/激活预览，逐项取得人类批准。
原账本累计上限CNY100，25项项目预留、累计保守预留4743分、剩余5257分；
这些是账本事实，不是供应商账单。旧DeepSeek一次502失败与持久claim保留，不退款或补跑。
不能以本摘要代替真实账本、重置100元额度或复制根摘要后自建新的计费权威。
任何新电脑的付费请求前必须先完成明确获批的原账本迁移/共用方案；此前保持零付费调用。

真实M3效果/费用、15项来源缺口及19类原生观察仍待完成，原交付PARTIAL。
接收方须回报实际checkout版本、98文件核对结果、缺少的私有工件/账本和首个离线动作；
只有通过接班核验后才更新唯一实施者索引，避免两台电脑同时写入。
