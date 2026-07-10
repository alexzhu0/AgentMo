# AgentMo 三方协作机制：Alex / Echo / Codex

Echo，这份文件不是普通开源项目的 `CONTRIBUTING.md`。它是我们三方一起维护 AgentMo 的工作协议：

```text
Alex  = 产品方向、业务判断、最终验收与合并决策
Echo  = 工程实现、测试、PR、技术反馈
Codex = 规划拆解、代码审查、文档/release 维护、发布辅助
```

项目地址：

```text
https://github.com/alexzhu0/AgentMo.git
```

协作方式：**collaborator + clone 原仓库 + feature branch + PR**。你是熟悉的工程师伙伴，不需要 fork；但我们仍然用 PR 留证据、方便 review 和回滚。

## 1. 我们在做什么

AgentMo 的目标不是写一个一次性的 prompt，而是做一个可以持续生产领域 Agent 的 **AgentMother 机制**。

核心流程：

```text
Discover -> Plan -> Produce
```

对应三个阶段：

```text
Stage 1: Discover
搜索/收集数据，形成 discovery database。

Stage 2: Plan
结合用户需求和数据库，形成 design-plan / blueprint。

Stage 3: Produce
完成 Agent 设计、实现、运行、验证、birth-report、delivery-report。
```

最重要的工程原则：**三个阶段要解耦**。后一个阶段应该依赖前一个阶段产出的有效 artifact，而不是依赖某条历史命令刚刚跑过。

## 2. 三方分工

### Alex

Alex 负责：

- 定义真实业务目标；
- 判断 AgentMo 下一步做什么；
- 提供业务需求、验收标准和优先级；
- review 关键产品/架构方向；
- 决定是否 merge PR；
- 决定是否 release。

### Echo

Echo 负责：

- clone 仓库并在 feature branch 上开发；
- 把 Alex/Codex 拆出的任务落成代码；
- 补测试、跑验证、提交 PR；
- 在 PR 里说明影响范围、验证命令、风险；
- 对实现中发现的问题反向反馈给 Alex/Codex。

### Codex

Codex 负责：

- 帮 Alex 把需求拆成可执行 TODO；
- 帮 Echo/ Alex review PR；
- 检查三阶段是否仍然解耦；
- 检查测试、文档、release 是否同步；
- 维护 README / runbook / release 记录；
- 在 Alex 授权时执行 commit / push / GitHub Release。

Codex 不是替代 Echo，也不是替代 Alex；它是三方里的规划、审查、维护和发布助手。

## 3. Echo 第一次拉项目

先接受 GitHub collaborator 邀请，然后：

```bash
git clone https://github.com/alexzhu0/AgentMo.git
cd AgentMo
npm install
npm run check
```

如果 `npm run check` 全部通过，说明本地环境 OK。

建议先按顺序读：

```text
README.md
docs/MVP_RUNBOOK.md
docs/STAGE_CONTRACTS.md
release/2026.07.10.md
```

如果你也用 Codex / OMX / AI 编程，再读：

```text
AGENTS.md
docs/OMX_SESSION_MIGRATION.md
```

## 4. 标准任务流

我们每个任务尽量按这个闭环走：

```text
Alex 定目标
-> Codex 拆 TODO / 风险 / 验收标准
-> Echo 开 feature branch 实现
-> Echo 跑测试并开 PR
-> Codex 帮忙 review
-> Alex 决定 merge
-> Codex 按需维护 docs / release / 发布
```

不是每个小改动都要重流程，但默认按照这个机制协作。

## 5. Echo 每次开发流程

不要直接改 `main`。每个任务开一个分支：

```bash
git checkout main
git pull origin main
git checkout -b feature/your-task-name
```

开发完成后先验证：

```bash
npm run check
git diff --check
git status -sb
```

然后显式提交文件：

```bash
git add <具体文件路径>
git commit -m "简短说明"
git push origin feature/your-task-name
```

最后在 GitHub 上开 PR：

```text
feature/your-task-name -> main
```

## 6. PR 需要写清楚

PR 描述建议包含：

```text
本次目标：
改了什么：
影响哪些阶段：
验证命令：
已知风险：
需要 Alex 判断的问题：
```

示例：

```text
本次目标：增强 Stage 2 design-plan 的证据映射。
改了什么：更新 src/design-plan.js 和对应测试。
影响阶段：Stage 2。
验证命令：npm run check; git diff --check。
已知风险：未做真实业务数据验证。
需要 Alex 判断的问题：当前 evidence scoring 是否符合业务预期。
```

## 7. 三方 review 标准

### Alex 看什么

- 业务目标有没有被满足；
- 这是不是 AgentMo 下一步真正需要的能力；
- 是否影响产品方向或阶段边界；
- 是否可以 merge / release。

### Echo 看什么

- 实现是否简单、可维护；
- 测试是否覆盖关键行为；
- 是否有隐藏耦合；
- 是否有更好的工程方案。

### Codex 看什么

- 三阶段 contract 是否仍然清晰；
- artifact schema / CLI / docs 是否同步；
- 是否误读 `.env` 或引入 secret 风险；
- `npm run check` / `git diff --check` 是否通过；
- release 记录是否需要更新。

## 8. 禁止事项

不要直接 push `main`。

不要用：

```bash
git add .
git add -A
```

要显式 add 文件，例如：

```bash
git add src/design-plan.js test/design-plan.test.js README.md
```

不要读取或提交：

```text
.env
密钥文件
token
credential
private key
原始 provider payload
可能含密钥的 raw log
```

不要修改这些兄弟项目：

```text
/home/alex/DTAlex/learningGitHub/pi
/home/alex/DTAlex/learningGitHub/AgentHarness
/home/alex/DTAlex/learningGitHub/openclaw
```

除非 Alex 明确说这次任务要改它们。

## 9. 什么时候要更新文档和 release

如果改了这些内容：

- CLI 命令；
- 三阶段合同；
- artifact schema；
- discovery / design-plan / blueprint / handoff 行为；
- birth-report / delivery-report / evidence 语义；
- runbook；
- 架构；
- 重要功能或里程碑；

就要同步考虑更新：

```text
README.md
docs/STAGE_CONTRACTS.md
docs/MVP_RUNBOOK.md
docs/AGENTMO_MVP_LEDGER.md
release/YYYY.MM.DD.md
release/README.md
```

release 文件按日期写，例如：

```text
release/2026.07.11.md
```

GitHub Release 的正文应该使用对应的 `release/YYYY.MM.DD.md`，不要把这些 Markdown 文件作为 asset 上传。

## 10. 提交信息建议

简单改动可以用一行 commit message。重要改动建议用项目里的 decision-record 风格：

```text
<为什么要做这个改动>

Constraint: <约束>
Rejected: <放弃的方案> | <原因>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <后续维护提醒>
Tested: <验证命令>
Not-tested: <没验证的内容>
```

## 11. 完成标准

一个任务完成，不只是代码写完。至少要满足：

```text
代码/文档已完成
测试已跑
git diff --check 已过
PR 说明清楚
影响阶段清楚
风险写清楚
需要更新的文档/release 已同步或明确说明不需要
```

## 12. 最短协作口诀

```text
Alex 定方向
Codex 拆任务和把关
Echo 开 branch 实现
PR 留证据
Alex merge
Codex 维护 release
```

我们先用小 PR 快速磨合，保持节奏轻，但证据要完整。
