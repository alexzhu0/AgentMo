# AgentMo 项目演进与产品方向

本文件把 release 目录中的分散记录串成一条产品主线，方便理解“为什么做、已经
落地什么、下一步向哪里走”。它是导航页，不替代各日期 release 的精确证据、哈希和
非认证边界。

## 北极星目标

AgentMo 要解决的不是“写一段 Prompt”，而是把领域 Agent 做成可复现的软件产物：

```text
数据与证据 -> 与人的规划 -> 可运行 Agent Package
Discover      Plan             Produce
```

项目有两层长期产物：

1. 面向不同 coding tools 的通用方法论与协议：artifact contracts、skills、hooks、
   plugins、tools、memory/evidence 边界和人工批准点。
2. 由该方法论构建出的 domain Agent Package。首个运行时重点是 OpenClaw；Codex
   是当前的主要构建工具，但协议不能锁死在单一 coding tool 或单一 runtime。

首个 POC 把这条主线缩小为“白领产品经理研究 Agent”：持续收集 AI、知识工作、
文档、会议协作、数据分析及设备/软件趋势的受限证据，形成可查询的 Research DB，
为后续的人类规划与 Agent 设计提供输入。

## 演进时间线

| 阶段 | 核心落地 | 价值与边界 | 详细记录 |
| --- | --- | --- | --- |
| 2026.07.03–07 | MVP evidence spine、Discover/Plan/Produce 基线与首次 DeepSeek/OpenClaw 机制探索 | 建立 artifact/evidence 思维；早期 live 结果不等于生产认证 | `2026.07.03.md`、`2026.07.05.md`、`2026.07.06.md`、`2026.07.07.md` |
| 2026.07.10–13 | Stage 2 design-plan、blueprint/handoff admission、Node/OpenClaw compatibility gate | 从“有需求”变为可审计的规划合同 | `2026.07.10.md`–`2026.07.13.md` |
| 2026.07.15–23 | Codex Builder、append-only lifecycle、hook/UAT fail-closed 修复 | 明确 host mutation、用户批准与非自认证边界 | `2026.07.15.md`–`2026.07.23.md` |
| 2026.07.27–28 | allowlist Discover、Discovery approval、decision ledger、build contract / plan approval | 将资料、规划、OpenClaw 资源家族和批准精确绑定 | `2026.07.27.md`、`2026.07.28.md` |
| 2026.07.29–08.04 | deterministic Package、D-42 archive、生命周期与 Linux native containment | Package/安装机制得到严格建模；Linux native gate 仍独立存在 | `2026.07.29.md`–`2026.08.04.md` |
| 2026.08.05–06 | 白领 Research DB、受限真实采集、DeepSeek/OpenClaw 问答、Dashboard 入口 | 首次端到端 POC 验收；仍不是默认安装、自动日程或生产服务 | `2026.08.05.md`、`2026.08.06.md` |

## 当前已具备的能力

- 受限 Discover：manifest、本地已批准输入及允许列表 HTTPS source 三条路径；对
  检索、来源、可信等级、发布时间、采集时间和去重保留边界化证据。
- 受治理 Plan：discovery approval、decision ledger、design plan、blueprint 和
  build contract 之间使用精确 digest 绑定；声明字段不被误报为已验证事实。
- 可重复的 Produce 机制：Agent Package、OpenClaw 投影、D-42 transport archive 和
  受保护的生命周期/恢复合同。
- 白领研究 POC：两轮合格采集验证了 first-write / second-write 幂等；Research DB 和
  brief 能跨进程恢复；OpenClaw/DeepSeek 只基于本地证据回答，并在证据不足时拒答。
- 隔离 Dashboard：`agentmo poc dashboard` 建立独立 Profile、DeepSeek provider/model
  catalog 和精确 Agent 会话；不改默认 `~/.openclaw`，不自动发布或投递。

## 当前严格边界

- POC 的 `08:00 Asia/Shanghai` 是 schedule preview，不是已启动的 cron job。
- POC 的 Research DB 是受限本地知识库，不代表全网持续抓取、完整 Wiki 或生产 RAG。
- `synthetic-dns-proxy` 只是应对宿主可信代理将固定来源解析到 `198.18.0.0/15` 的
  窄 POC 模式；没有放宽 SSRF 规则，也不是通用代理能力。
- Dashboard 使用临时 workspace 和隔离 Profile；它没有安装到用户默认 OpenClaw，
  也没有成为可分发/可升级的生产 Package。
- macOS 是有效的 POC 开发宿主；Linux 原生 Package/containment 的完整证据必须由
  Linux CI 给出。两者不能互相替代。
- 任何通过的机制、短问答、黑盒 POC 或 Release 记录都不自动证明领域质量、用户
  价值、OpenClaw 广泛兼容性或生产就绪。

## 下一阶段方向

1. **固化当前成果。** 审阅并分组提交 Dashboard、POC、测试和 release 文档；随后
   才决定是否 push 与触发 Linux CI。
2. **把 Discover 做成长期产品能力。** 由人明确来源白名单、证据层级、持久化位置、
   更新频率、人工复核和失败告警；在单独授权后才启用 schedule 或投递。
3. **走完人机共创的 Plan。** 基于 Research DB 与产品经理反馈，形成优先级、用户
   痛点、能力假设、验收指标和可批准的 Agent design plan。
4. **把计划编译成可交付 Package。** 继续保持 target-neutral manifest + OpenClaw
   native projection 的策略；Package 的 install、activation、runtime 与 production
   仍应逐项人工授权、独立验证。
5. **保持多工具可移植性。** Codex/OpenClaw 是第一实现，不应把核心 contracts、
   skills 或 evidence semantics 绑定为不可迁移的私有格式。

## 如何使用本目录

- 要恢复当前工作：先读 `docs/CURRENT_STATUS.md`，再读最新 `2026.08.06.md`。
- 要了解产品方向：读本页。
- 要证明某项历史事实：回到对应日期 release，不以本页替代其哈希、命令和限定语。
- 要开始改动：始终以实时 `git status`、当前 branch 和源码/测试为准；不要将旧
  release 的“下一步”当作未审查的自动指令。
