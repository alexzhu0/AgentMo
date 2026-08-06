# AgentMo 当前状态与恢复入口

更新日期：2026-08-06

本页是短期恢复锚点。它只描述当前工作状态；历史决策、审计和发布证据保留在
`release/` 与 `.planning/`，不应被本页改写。

## 当前结论

AgentMo 的三阶段主线仍是：

```text
Discover -> Plan -> Produce
```

白领研究型 OpenClaw POC 已完成一次独立、受限的验收运行：两次采集分别新增
20 条与 0 条记录；重启后 Research DB 与每日 brief 可读；短问题可由
OpenClaw/DeepSeek 仅基于本地证据回答，缺证据时会拒答。该验收不等于生产可用、
完整来源健康、领域认证或自动化发布。

当前正在维护的改动位于隔离 worktree：

```text
/private/tmp/agentmo-poc-openclaw-builder
branch: codex/poc-openclaw-builder
base HEAD: 22c3c28
```

这里的 Dashboard、文档与测试改动仍未提交。不要假设默认仓库 checkout 已包含它们，
也不要删除或移动其他已有 dirty 文件。

## 可体验的 POC

验收 workspace 位于临时目录：

```text
/private/tmp/agentmo-white-collar-final-poc.rmjWaz/workspace
```

临时目录可能被系统清理；它是可体验的 POC 状态，不是可发布的 Agent Package。
从隔离 worktree 启动 Dashboard：

```bash
cd /private/tmp/agentmo-poc-openclaw-builder

node ./bin/agentmo.js poc dashboard \
  /private/tmp/agentmo-white-collar-final-poc.rmjWaz/workspace \
  --profile agentmo-poc-white-collar-dashboard \
  --model deepseek/deepseek-v4-flash \
  --runtime-env-file /absolute/path/to/runtime.env \
  --port 18889
```

该命令只使用允许名的运行时环境变量；令牌不会打印或持久化。它启动一个前台、
loopback、token-authenticated 的隔离 Gateway，并打开精确的
`white-collar-research-poc` 会话。若端口已被手动 Gateway 占用，命令会拒绝，
而不是停止、覆盖或修改默认 `~/.openclaw`。用启动该命令的终端按 Ctrl-C 停止。

## 已验证的边界

- `poc dashboard` 为隔离 Profile 写入 DeepSeek provider、模型目录与精确 Agent
  注册；不改默认 OpenClaw Profile。
- 采集只能使用注册来源与显式网络模式。公开 DNS 被本机代理映射到保留地址时，
  `synthetic-dns-proxy` 是 POC 的受限例外，不是放宽 SSRF 防护或通用爬虫能力。
- 08:00 Asia/Shanghai 仅有 schedule preview；没有授权或执行 schedule、投递或发布。
- macOS 验证非 Linux 原生文件系统路径会 fail-closed；Linux native Package
  Produce/containment 证据仍应由 Linux CI 提供。

## 当前验证与未完成项

最近一次聚焦验证通过：

```text
node --test test/package-produce.test.js test/openclaw-safe-fs.test.js \
  test/artifact-surface-coverage.test.js test/poc-cli.test.js \
  test/poc-openclaw-runtime.test.js test/discovery-live-transport.test.js
# 46 pass, 0 fail

git diff --check
# pass
```

`npm run check` 不是当前绿色结论：一次聚合尝试进入无关的、长时间 Phase 4
fault-injection 测试后被人为中止；中止前 256 项通过、没有真实断言失败，剩余项为
取消。不要把取消当成全绿，也不要为日常 POC 重跑该全量长套件。

下一步需要明确的人类决定：

1. 复核并按功能分组提交当前 Dashboard/测试/文档改动；之后才可 push。
2. 需要 Package 原生闭环时，执行精确 commit 的 Linux CI gate；这不要求把 Mac
   POC 开发迁移到 Linux。
3. 若要把 POC 变成长期使用的产品能力，先决定来源白名单、持久化位置、schedule
   activation、投递渠道与人工审核边界；它们目前都未获授权。

## 新 session 最小恢复步骤

1. 先读 `AGENTS.md`、本页、`release/README.md`、`README.md`、
   `docs/MVP_RUNBOOK.md` 和 `docs/AGENT_BIRTH_GATE.md`。
2. 在实际工作目录运行 `pwd`、`git status --short`、`git branch --show-current`、
   `git rev-parse --short HEAD`；以实时结果为准。
3. 不读取 `.env` 内容、不记录密钥、不操作 sibling projects，除非用户明确授权。
4. 不把 POC 证据升级为 OpenClaw 安装、runtime 认证、领域质量或生产认证。

相关证据：`release/2026.08.06.md`、
`docs/superpowers/specs/2026-08-05-white-collar-research-db-poc-design.md`、
`docs/superpowers/specs/2026-08-06-poc-dashboard-design.md`。
