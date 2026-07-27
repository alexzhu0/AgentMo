# Phase 2: Codex Builder - Research

**Researched:** 2026-07-15
**Domain:** Codex Plugin、Skills、Hooks、Custom Agents 与项目级 Builder 生命周期
**Confidence:** HIGH for observed host/official contracts; MEDIUM for the final packed-install composition until exercised in a clean `CODEX_HOME`

<user_constraints>
## User Constraints

- `D-15..D-17`: AgentMo core、artifacts、checkpoint 和 events 必须 host-neutral；Codex 只是首个获得完整 evidence 的 adapter。
- `D-18..D-20`: 一个发行版本、一次显式 setup、项目级默认；`$agentmo` 是唯一主入口，阶段命令是协议面。
- `D-21..D-23`: 稳定工件边界自动 checkpoint + 手动 pause；不以 transcript 为权威，hook 不自动批准或推进。
- `D-24..D-28`: required capability fail-closed、optional explicit degrade、doctor 只读、显式升级、digest ownership、fresh-session behavior evidence 分级。
</user_constraints>

## Summary

本机 `codex-cli 0.144.2` 观察到 `plugins`、`hooks` 为 stable；旧 feature key `plugin_hooks` 已 removed，但当前官方 Hooks 手册明确支持 plugin-bundled hooks。因此 AgentMo 不应探测旧 `plugin_hooks` flag，而应探测 canonical `hooks` feature、Plugin manifest loading、hook trust 和实际事件可见性。

**Primary recommendation:** 发布一个同时是 npm CLI 包与 Codex Plugin root 的自包含产物。`npx @agentmo/builder setup --scope project` 只做显式、可预览的项目投射：生成 repo marketplace、AgentMo plugin、project custom agents 和 `.agentmo/` receipt/checkpoint；Codex-managed cache/config 只通过官方 `codex plugin` 接口操作，不直接写内部 cache。

## Current Codex Contract

| Surface | Evidence | Planning consequence |
|---------|----------|----------------------|
| Plugins | `[OBSERVED] codex features list`: `plugins stable true`; `codex plugin add/list/remove/marketplace` 可用 | 使用正式 `.codex-plugin/plugin.json` 和 repo marketplace；不用自造 plugin registry |
| Repo marketplace | `[CITED]` `$REPO_ROOT/.agents/plugins/marketplace.json`; source may be local/Git/npm | setup 可创建/合并 AgentMo-owned marketplace entry；shared file 必须 marker/structured ownership |
| Plugin components | `[CITED]` manifest 支持 `skills`, `hooks`, `mcpServers`, `apps` | Phase 2 只需要 skills/hooks；不引入 MCP/app |
| Plugin cache | `[CITED]` Codex 安装副本位于 `~/.codex/plugins/cache/...` | cache 是 host-owned；AgentMo receipt 记录 selector/observed version，不直接删除 cache bytes |
| Skills | `[CITED]` repo skills at `.agents/skills`; plugin skills via manifest | canonical skills 生成 plugin projection；禁止双份手写真相 |
| Custom agents | `[CITED]` project agents at `.codex/agents/*.toml` | setup 生成受管 TOML；每个文件逐 digest 归属 |
| Hooks | `[OBSERVED] hooks stable true`; `[CITED]` project/plugin hooks and trust-by-hash | plugin bundle 可带 hooks；首次行为测试必须处理未 trust 时的显式 degraded/blocked 状态 |
| Hook events | `[CITED]` SessionStart, Pre/PostCompact, UserPromptSubmit, Stop 等 | checkpoint/dedup 只依赖稳定 JSON fields；不得读取不稳定 transcript format |
| Hook runtime | `[CITED]` command handlers only; plugin gets `PLUGIN_ROOT`/`PLUGIN_DATA` | hook 调用 bundle 内 Node entrypoint；不依赖全局 AgentMo CLI |

## Concrete MVP Architecture

```text
canonical builder contracts + skills + agent definitions + hook entrypoints
                              │
                     Codex adapter projection
                              │
      npm packed release / plugin root (one version + release digest)
                              │
      setup probe → exact plan → approval → atomic project install
                              │
  repo marketplace + plugin + .codex/agents + .agentmo receipt/checkpoint
                              │
       fresh Codex session → $agentmo → start or validated resume
```

### Ownership split

- **AgentMo-owned:** copied plugin directory, generated custom agent TOMLs, `.agentmo/` state, dedicated files.
- **Shared:** repo marketplace/config entries; modify only exact structured entry or managed marker.
- **Codex-owned:** plugin cache, hook trust database, session/transcript. Inspect through Codex, never delete directly.
- Update classification is `installed digest` vs `current bytes` vs `desired bytes`; corrupt/missing receipt fails closed.

## Existing-Code Integration

- `src/cli.js` / `bin/agentmo.js`: add default builder route plus `builder probe|setup|doctor|upgrade|uninstall|pause|resume|hook` commands without changing stage artifact contracts.
- Reuse exact digest, persistability, redaction and atomic temp-file/rename helpers already used by artifact admission and runtime receipts.
- Add a builder adapter registry distinct from `src/targets/registry.js`; both may share deterministic operation-plan conventions, never support identity.
- `package.json`: publish the plugin tree, canonical assets, runtime entrypoints and schemas; packed-install tests must exercise `npm pack` output rather than repository paths.
- Tests stay on `node:test`; clean-room cases use temporary repo + temporary `CODEX_HOME` and invoke the installed tarball/bundle.

## Pitfalls That Must Become Tests

- Treating removed `plugin_hooks` feature flag as current capability instead of canonical `hooks` plus runtime observation.
- Assuming plugin installation automatically trusts hooks; untrusted or changed hook hash must not produce false readiness.
- Directly deleting Codex cache/config, using filename prefixes, or overwriting user-edited custom agents.
- Calling a globally installed `agentmo` from plugin hooks; this creates OMX-style version skew.
- Persisting `transcript_path` contents; official docs state transcript format is unstable.
- Letting duplicate SessionStart/PostCompact events apply a state transition twice.
- Calling `doctor` a repair or treating install/doctor/hook smoke as domain certification.

<phase_requirements>
## Phase Requirements and Validation Architecture

| ID | Observable proof | Fast automated command / planned suite |
|----|------------------|----------------------------------------|
| CORE-05 | neutral descriptor validates Codex adapter and rejects unsupported/deceptive support claims | `node --test test/builder-adapter-contract.test.js` |
| BLDR-01 | `npm pack` artifact installs plugin/skills/agents/hooks into clean temp project without repo path dependency | `node --test test/builder-packed-install.test.js` |
| BLDR-02 | probe records version/evidence and required/optional capability states; zero writes | `node --test test/codex-builder-probe.test.js` |
| BLDR-03 | `$agentmo` and direct stage routes consume the same admitted artifacts | `node --test test/builder-entry.test.js` |
| BLDR-04 | pause, stable checkpoint, restart/compact resume and duplicate event no-op | `node --test test/builder-checkpoint.test.js test/builder-hook.test.js` |
| BLDR-05 | doctor is read-only and distinguishes declared/observed/verified/degraded | `node --test test/builder-doctor.test.js` |
| BLDR-06 | upgrade/uninstall mutate only pristine receipt-owned bytes and preserve modified/unknown/shared content | `node --test test/builder-lifecycle.test.js` |
| BLDR-07 | fresh-session trigger, non-trigger, pause/restart/dedup behavior is observed | `node --test test/codex-builder-behavior.test.js` plus bounded real-Codex smoke when available |

- Per task: relevant single test file under 30 seconds.
- Per wave and phase gate: `npm run check` and `git diff --check`.
- Real Codex smoke is separate evidence; deterministic fixtures remain required when desktop interaction is unavailable.
</phase_requirements>

## Remaining Unknowns

- CLI `codex plugin add` and desktop repo-marketplace discovery must be exercised under an isolated `CODEX_HOME`; observed help alone does not prove project-only enablement semantics.
- Hook trust UI/CLI automation is intentionally not bypassed in the product path. Tests may use isolated pre-trusted fixtures only when labeled synthetic.
- Current official docs establish plugin-bundled hooks despite the removed legacy `plugin_hooks` feature key; probe must use behavior/version evidence, not that removed key.

## Sources

- `[OBSERVED]` `codex --version`, `codex features list`, `codex plugin --help`, `codex plugin add/remove/list --help` on 2026-07-15.
- `[CITED]` [Build plugins](https://learn.chatgpt.com/docs/build-plugins.md) — repo marketplaces, npm/local sources, plugin structure and cache.
- `[CITED]` [Hooks](https://learn.chatgpt.com/docs/hooks.md) — discovery layers, trust, events, command handlers, `PLUGIN_ROOT`, transcript instability.
- `[CITED]` Codex manual “Custom agents” — `.codex/agents/*.toml` project scope.
- `.reference-repos/{gsd-core,oh-my-codex,superpowers,openclaw}` canonical files listed in `02-CONTEXT.md` — implementation patterns and known anti-patterns.

**Valid until:** 2026-07-22 for Codex host facts; re-run probe before release evidence.
