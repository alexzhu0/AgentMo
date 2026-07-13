# Technology Stack

**Project:** AgentMo
**Researched:** 2026-07-11
**Overall confidence:** HIGH（Codex plugin/hook 兼容细节为 MEDIUM）

## Decision Summary

AgentMo v1 应继续以低依赖、contract-first 的 Node.js CLI 为核心，不引入 GSD Core、Oh My Codex、Superpowers 或 OpenClaw 作为库依赖。它们是设计与兼容性证据，不是 AgentMo 的运行时组成。

关键栈决策如下：

1. 将受支持的 Node 基线提高到 `>=22.19.0`，默认开发与 CI 使用 Node 24 LTS；Node 20 已于 2026-03-24 EOL。
2. 保持 JavaScript ESM、Node built-ins、JSON/JSONL/Markdown 和 `node:test`，v1 核心继续零第三方运行时依赖。
3. Codex adapter 交付 `.codex-plugin/plugin.json` 与 skills；agents 和 hooks 由带所有权回执的 setup 层独立安装，不假设 plugin-local hooks 可用。
4. OpenClaw 是外部目标运行时，通过 CLI、manifest 和受管文件契约集成，不链接 OpenClaw 内部 TypeScript 模块。
5. 普通领域智能体优先 materialize 为 workspace + skills + config patch；需要跨生态运输时生成 content bundle；只有确需进程内 tools 或 typed hooks 时才生成 native plugin。
6. Agent Package 的规范源是确定性目录、manifest 与逐文件 digest；归档只是运输封装，不能成为唯一事实源。
7. memory 保持 Markdown policy/content 与运行时索引分离；eval 保持 deterministic contract test、isolated live smoke、bounded domain eval 三层分离。

## Verified Baselines

这些版本用于研究与首轮兼容验证，不等于无限期支持范围：

| Component | Version / Commit | Role | Dependency status |
|---|---|---|---|
| AgentMo | `0.1.0` / `f50c5afa7958` | 当前实现基线 | 核心产品 |
| Node.js | 本机 `24.18.0` | CLI 与测试运行时 | 必需 |
| Codex CLI | 本机 `0.144.0-alpha.4` | v1 builder host 探测基线 | 外部 host，不链接 |
| OpenClaw | `2026.6.11` / `29d018f0af5e` | v1 target runtime | 外部 CLI，不链接 |
| GSD Core | `1.7.0-rc.4` / `b9c8ea143bc0` | 方法论、capability 与迁移参考 | 不依赖 |
| Oh My Codex | `0.20.0` / `5d43a5bf6f00` | Codex adapter、SSOT、doctor 参考 | 不依赖 |
| Superpowers | `6.1.1` / `d884ae04edeb` | skills、打包、行为 eval 参考 | 不依赖 |

OpenClaw 该基线声明 Node `>=22.19.0 <23 || >=23.11.0`、`pnpm@11.2.2`。`pnpm` 只用于 OpenClaw 源码 checkout；AgentMo 自身仍使用 npm。

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Node.js | `>=22.19.0`；默认 24 LTS | CLI、文件工件、进程执行、hash、测试 | 对齐 OpenClaw 最低线并淘汰 EOL Node 20 |
| JavaScript ESM | Node 原生 | AgentMo 核心实现 | 现有代码稳定，无需 TypeScript 重写或构建步骤 |
| Node built-ins | 与 Node 同版 | `fs/promises`、`crypto`、`child_process`、`path` | 缩小供应链与安装面，现有能力足够 |
| JSON / JSONL | versioned schemas | discovery、plan、package、receipt、evidence | 可校验、可 diff、适合确定性 hash |
| Markdown | UTF-8 | prompts、skills、workspace、memory、runbooks | 同时兼容 Codex 与 OpenClaw 的内容面 |
| npm | Node 24 随附受支持版本 | AgentMo 安装、测试、packed-install | 与当前 package 形态一致；不把 OpenClaw 的 pnpm 泄漏进核心 |

不建议为了 schema 便利立即加入 Zod/Ajv。先继续使用当前显式 validator；当 schema 数量或跨语言消费确实造成重复时，再以 JSON Schema 作为交换格式并评估 validator 依赖。

### Builder Plane: Codex Adapter

| Surface | Recommended form | Runtime rule |
|---|---|---|
| Plugin | `.codex-plugin/plugin.json` | 只声明当前验证器接受的 fields；至少提供 identity、semver、skills 与 interface |
| Skills | `skills/<name>/SKILL.md` + 可选 `agents/openai.yaml` | SKILL.md 为规范源；生成镜像必须通过 drift check |
| Agents | setup-managed `.codex/agents/*.toml` | plugin manifest 不承担 agent 安装；文件带 AgentMo marker 与 digest |
| Hooks | config-layer `hooks.json` + feature flag | 与 plugin 分离；结构化合并，仅拥有 AgentMo handler 条目 |
| State | `.agentmo/` 或明确的 adapter state root | 记录 install receipt、capability probe、schema/version、owned paths/digests |
| Marketplace | `.agents/plugins/marketplace.json` | 作为发现与安装入口，不作为能力是否生效的证据 |

本机 Codex feature probe 显示 `plugins=stable`、`hooks=stable`、`plugin_hooks=removed`。因此：

- v1 不在 Codex plugin manifest 中声明 `hooks`，也不复制 Superpowers 当前的 `"hooks": {}` 兼容技巧。
- setup 必须执行 capability probe；未知、removed 或 undocumented surface 失败关闭。
- hook 安装、刷新、卸载只修改 AgentMo-owned entries；保留其他用户或插件的 hook 与 trust state。
- `doctor` 证明文件、配置和 feature wiring；另用干净 Codex 会话行为 smoke 证明实际激活。

不要引入 Codex SDK 作为 AgentMo 依赖。Builder adapter 是目录/配置/CLI 契约，Codex 自身负责执行。

### Target Plane: OpenClaw Integration

| Surface | Recommended form | Trust / lifecycle boundary |
|---|---|---|
| Runtime | external `openclaw` CLI | probe version/features；始终使用隔离 `OPENCLAW_STATE_DIR` 验证 |
| Workspace | `AGENTS.md`、`SOUL.md`、`USER.md`、`TOOLS.md`、skills、memory policy | 默认选择；内容面最窄，workspace 不是 sandbox |
| Content bundle | 独立 Codex-compatible bundle 子目录 | 只映射 OpenClaw 明确支持的 skills、hook packs、MCP；不得假定全部 Codex surface 被执行 |
| Config patch | declarative JSON patch + ownership metadata | config、credentials、sessions 与 workspace 分离；不直接覆盖用户 config |
| Native plugin | TypeScript/JavaScript + `openclaw.plugin.json` | 仅用于进程内 tool、typed hook 或 runtime capability；与 Gateway 共享信任边界 |
| Internal hook | `HOOK.md` + `handler.ts/js` | 用于粗粒度 command/session/gateway side effects |
| Typed plugin hook | Plugin SDK `api.on(...)` | 用于 prompt、tool、message policy 与 block/cancel 语义 |
| Doctor | `openclaw doctor --lint --json` | read-only preflight；repair 必须是单独获批操作 |

OpenClaw native plugin 不是默认 Agent Package 形态。一个目录同时包含 native manifest 与 Codex bundle marker 时，OpenClaw 优先 native plugin；因此两种产物必须位于不同 target 子目录，避免隐式升级信任面。

AgentMo 不应 import `openclaw/plugin-sdk` 到核心。只有某个生成包声明 native capability 时，该 target 子包才声明与 tested OpenClaw range 对齐的 SDK/peer contract，并独立构建、测试和列出依赖。

### Data and Memory

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Filesystem artifact store | v1 | Discover DB、Plan、Package、receipt、evidence | 当前原子写入与工件边界已经成熟 |
| JSONL | schema-versioned | facts、source ledger、event/evidence ledger | 追加友好，单条记录可 hash 与审计 |
| SHA-256 | Node `crypto` | source、file、manifest、approval、receipt digest | 已在代码中使用；支持 ownership 与 exact-artifact approval |
| Markdown memory | OpenClaw workspace contract | `MEMORY.md`、`memory/*.md` 与编辑偏好 | 可审阅、可迁移，不携带运行时数据库 |
| OpenClaw memory backend | runtime-owned | SQLite/hybrid index 或所选 plugin | 索引和 embeddings 属于外部状态，不进入 Agent Package |

v1 不为 AgentMo 核心引入 SQLite、向量数据库或 embeddings SDK。Package 只声明 `memory-policy.json`、可移植 Markdown 模板、允许写入范围、保留/晋升/过期规则和 provider requirements；OpenClaw 负责实际索引。

行动敏感记忆必须记录 authority、condition、expiry 与 forbidden action，但 memory 不能替代 tool policy、sandbox 或 approval gate。

### Tools, MCP, Hooks, and Capabilities

Agent Package 应使用版本化 `capabilities` 清单，每项至少包含：

- `id`、`version`、owner、target compatibility、required/optional；
- prompts/skills/tools/hooks/memory/eval 的 owned paths；
- permissions、secret key names、network/file/process side effects；
- install mode、runtime mapping、unsupported surfaces；
- source provenance、file digests、tested runtime baseline。

工具首先用 declarative contract 描述。只有能力需要标准化外部 tool server 时才生成 MCP 子包；此时 `@modelcontextprotocol/sdk` 属于生成子包，而非 AgentMo core。发布工具必须绑定 exact artifact digest、approval actor、expiry 与 idempotency key。

定义 AgentMo-neutral lifecycle event envelope，再由 Codex/OpenClaw adapter 映射。不要把任一 host 的 hook event 名直接变成核心协议。

### Evaluation and Verification

| Layer | Technology | Required evidence |
|---|---|---|
| Core contracts | `node:test` + `node:assert/strict` | schemas、negative cases、ownership、migration、determinism |
| Skill behavior | scenario fixtures + fresh Codex session | trigger、non-trigger、compaction recovery、human gate |
| Package conformance | pack/install/doctor/upgrade/rollback/uninstall harness | receipt、digest、preservation、idempotency |
| OpenClaw runtime | isolated CLI smoke | `live-success`，不声称 domain quality |
| Domain quality | bounded cases + rubric/evaluator provenance | 只认证给定 case suite |
| Release | Birth Report + Delivery Report | fail-closed aggregation，不自我认证 |

继续使用当前 eval 模块，不在 v1 引入 Promptfoo、LangSmith 或云 eval 平台。先让 `support-triage` 成为确定性 conformance fixture，再为中文 AI 写作包增加真实来源、引用、事实/推断/争议和 exact-draft approval 场景。

### Packaging and Distribution

规范 Agent Package 目录建议包含：

```text
agent-package/
├── agentmo-package.json
├── provenance/
├── prompts/
├── skills/
├── tools/
├── hooks/
├── memory/
├── evals/
├── targets/openclaw/{workspace,bundle,plugin,config}/
└── evidence/
```

`agentmo-package.json` 是 SSOT，记录 package semver、schema version、compat ranges、capabilities、permissions、逐文件 SHA-256、target mappings、approval requirements 与 certification boundaries。

v1 先把确定性目录 + manifest 作为可安装单元；archive/zip/tgz 为可重复生成的 transport。不要为归档提前引入大型打包框架。Builder CLI 可继续使用 npm package；生成的 Agent Package 不必伪装成 npm library。

### Infrastructure

| Technology | Version | Purpose | Why |
|---|---|---|---|
| GitHub Actions | current hosted actions，固定 major | Node 22.19/24 matrix、packed install、artifact checks | 当前仓库缺少 CI；v1 支持声明需要干净环境证据 |
| Temporary isolated dirs | OS temp + explicit state roots | Codex/OpenClaw install/live tests | 防止污染真实 home、credentials、sessions |
| Docker sandbox | optional | 高风险 tool/plugin 测试 | workspace 本身不是 sandbox；不强迫普通核心测试依赖 Docker |

CI 不读取生产 `.env`。live provider smoke 使用受控 secret store、最小请求、隔离 state，并只保留 scrubbed summary/digests。

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Core language | JavaScript ESM | TypeScript rewrite | 迁移成本高，不能直接改善 v1 package contract |
| Validation | explicit validators | Zod/Ajv now | 新供应链面；当前 validators 与负向测试已足够 |
| Runtime integration | OpenClaw CLI/manifest contract | import OpenClaw internals | 强耦合快速变化的内部模块与庞大依赖树 |
| OpenClaw output | workspace/bundle first | native plugin for every agent | 不必要扩大 Gateway 进程信任面 |
| Codex hooks | separate config-layer install | plugin-local hooks | 当前本机 `plugin_hooks` 已 removed，manifest 支持存在漂移 |
| Memory | Markdown policy + runtime-owned index | AgentMo-owned vector DB | 混淆 package 内容与 credential-bearing runtime state |
| Eval | built-in layered evidence | cloud eval platform first | 引入账号/数据外流/证据语义依赖，v1 无必要 |
| References | copy principles | depend on GSD/OMX/Superpowers | 会继承其命令规模、自动化假设与 host-specific internals |
| Package source | manifest + directory | archive as SSOT | 归档不利于审阅、迁移、局部 ownership 与 deterministic diff |

## Installation

AgentMo 核心不新增依赖：

```bash
npm install
npm run check
npm pack --dry-run
```

完整 OpenClaw 验证环境要求受支持的 Node 22.19+（推荐 Node 24 LTS）与可探测的 `openclaw` CLI。只有使用 OpenClaw source checkout 时，才通过 Corepack 使用其 manifest 固定的 `pnpm@11.2.2`。

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Node/core stack | HIGH | 当前源码、package manifest 与 Node 官方生命周期交叉验证 |
| OpenClaw target stack | HIGH | 基于 `2026.6.11` exact commit 的官方 docs/source 与成功 local smoke |
| Codex plugin/skills | HIGH | 本地官方 manifest/spec、官方 Codex source 与本机 feature probe 一致 |
| Codex hook packaging | MEDIUM | 当前行为清楚，但参考仓库与本机 feature 状态显示上游快速漂移 |
| Memory/eval split | HIGH | AgentMo 与 OpenClaw 当前实现都明确区分内容、索引、运行、领域证据 |
| Archive format | MEDIUM | SSOT 决策明确；最终 transport 格式仍需 packed-install phase 验证 |

## Sources

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — 官方生命周期；Node 20 EOL，Node 22/24 LTS。
- [Node.js EOL policy](https://nodejs.org/en/about/eol) — EOL 版本不再获得安全修复。
- [Codex skill anatomy](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md) — `SKILL.md` 与可选 resources/metadata。
- [OpenAI Codex app-server skills contract](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — skill discovery/invocation evidence。
- [OpenClaw agent workspace](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/concepts/agent-workspace.md) — workspace 与 state/credentials/session 分离。
- [OpenClaw skills](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/tools/skills.md) — precedence、allowlist、gating、snapshot。
- [OpenClaw bundles](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/plugins/bundles.md) — compatible bundle 映射与较窄信任边界。
- [OpenClaw plugin manifest](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/plugins/manifest.md) — native plugin 声明与预执行校验。
- [OpenClaw hooks](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/automation/hooks.md) — internal hooks 与 typed plugin hooks 分工。
- [OpenClaw memory](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/concepts/memory.md) — Markdown memory 与 runtime backend。
- [OpenClaw doctor](https://github.com/openclaw/openclaw/blob/29d018f0af5e/docs/gateway/doctor.md) — `--lint` 与 repair 的证据边界。
- [GSD capability manifest](https://github.com/open-gsd/gsd-core/blob/b9c8ea143bc0/docs/reference/capability-manifest.md) — version、compat、ownership、integrity 模式。
- [GSD trust model](https://github.com/open-gsd/gsd-core/blob/b9c8ea143bc0/docs/explanation/capability-trust-model.md) — install consent、integrity、root confinement。
- [GSD installer migrations](https://github.com/open-gsd/gsd-core/blob/b9c8ea143bc0/docs/installer-migrations.md) — managed/user/unknown ownership 与 rollback。
- [OMX plugin SSOT](https://github.com/Yeachan-Heo/oh-my-codex/blob/5d43a5bf6f00/docs/plugin-bundle-ssot.md) — canonical source、generated mirror、drift verification。
- [OMX Codex hooks](https://github.com/Yeachan-Heo/oh-my-codex/blob/5d43a5bf6f00/docs/codex-native-hooks.md) — hook capability probe、shared ownership、doctor/smoke split。
- [Superpowers plugin manifest](https://github.com/obra/superpowers/blob/d884ae04edeb/.codex-plugin/plugin.json) — skills-first Codex packaging reference；hook 字段不可直接照搬。
- [Superpowers testing](https://github.com/obra/superpowers/blob/d884ae04edeb/docs/testing.md) — infrastructure tests 与 live behavior eval 分层。

---
*Stack research: 2026-07-11；参考仓库仅作一手源码证据，不是 AgentMo 依赖。*
