# OpenClaw Runtime Notes

OpenClaw materialization, doctor checks, live smoke, eval, birth, delivery, and release evidence are Produce-internal gates in AgentMo. They do not certify runtime parity, domain-wide quality, production readiness, or deployment approval by themselves.

## Runtime compatibility preflight

AgentMo core remains Node.js `>=20`. OpenClaw target mutation separately requires `>=22.19.0 <23 || >=23.11.0`; the range is owned by AgentMo's runtime compatibility module, not by shell or documentation logic. Run the canonical zero-subject check before direct mutation:

```bash
node ./bin/agentmo.js runtime-check --target openclaw
```

This observation is a current-process compatibility gate only. It is not `live-success`, domain-quality evidence, or production approval.

Source inspected for AgentMo runtime profiling:

- Local source: `<openclaw-source-root>` (operator-selected; not read by default)
- Commit: `5bcd25f0fb fix(discord): gate guild metadata reads [AI] (#98966)`
- Package: `openclaw@2026.6.11`
- CLI bin: `openclaw -> openclaw.mjs`

## Architecture facts to preserve

OpenClaw separates four layers that AgentMo must not collapse:

| Layer | OpenClaw examples | AgentMo implication |
| --- | --- | --- |
| Provider | `openai`, `anthropic`, `github-copilot` | Auth/model catalog ownership. |
| Model | `gpt-5.5`, `claude-opus-4-6` | Selected inference target. |
| Agent runtime | `openclaw`, `codex`, `copilot`, `claude-cli` | Loop/backend that executes the prepared turn. |
| Channel | Telegram, Discord, Slack, WhatsApp | Ingress/egress surface, not the domain agent itself. |

The built-in OpenClaw runtime id is `openclaw`. Plugin harnesses can register more runtime ids. `auto` selects a supporting plugin harness when one exists and otherwise falls back to OpenClaw.

## Phase 4 exact target and package boundary

Phase 4 does not treat an installed command name or a semver-only observation
as installation authority. Its selected target descriptor was derived from
retained no-follow reads of the target executable, first-party `package.json`,
and first-party build-info bytes and binds OpenClaw
`2026.7.1-2@0790d9f`. The selected descriptor SHA-256 is
`sha256:0abad669ae3cac7b6219737a728df21799eeec6ac7946e8fd38285f9e4322bee`;
the recipe-bound target/carrier admission SHA-256 is
`sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6`.
A differently observed executable, package, build-info member, revision,
target-root closure, or recipe is not valid under these bytes. It requires a
new descriptor, build contract, plan approval, and target/carrier admission.

The canonical Agent Package directory is deterministic build authority only.
Probe, lifecycle preview, all three approval families, and apply bind the
deterministic D-42 archive by its caller-supplied external SHA-256, internal
manifest digest, canonical inventory digest, and all member
path/type/mode/length/digest facts. The selected archive SHA-256 is
`sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f`;
its manifest is
`sha256:af98b46e5d5a6e46db7c7b020fea51115bae0829d943583ce9d756ce1d1c45`
and its 40-member inventory is
`sha256:d6be393fc176c9f28811e9e8771fae7cff5efb81a824697a6300ae80466c32a5`.
Package roots and standalone manifests are not install transports.

`openclaw-probe` uses fixed `shell:false` observations only in a disposable
synthetic HOME/state/config/workspace with a closed non-secret environment.
This is a read-only capability fingerprint, not plugin load, MCP connection,
agent invocation, schedule execution, credential use, or a live-target result.
The current package intentionally has no MCP carrier or Phase 4 MCP route.

Lifecycle effects are separately authorized: ordinary managed writes, every
exact sensitive action, and the complete exact conflict set are different
authority families. Install starts from verified absence; upgrade and uninstall
start from the exact current receipt; explicit rollback additionally selects an
exact predecessor receipt and archive. Apply re-admits every file with an
external SHA-256, revalidates the retained archive and current target state
before effect, preserves unknown/modified/externally owned assets, and publishes
a complete or incomplete receipt only after post-observation.

The retained-dirfd helper is never taken from PATH and is not shipped as a
binary. The source-only npm tarball carries
`native/openclaw-fs-kernel.c` plus the JavaScript admission facade without npm
install/prepare compilation. Operators explicitly run
`openclaw-fs-kernel-build --binary-out ... --receipt-out ...`; descriptor,
target admission, package production, genesis, preview, and apply then require
the helper path, durable build receipt, and external receipt digest. Admission
rechecks source/compiler/toolchain, fixed argv, closed environment, binary
digest/mode, and retained identities.

Target observation, private journals, authority markers, managed writes, and
publication use retained root/parent descriptors. Linux publication uses
`renameat2(RENAME_NOREPLACE)` and Darwin uses
`renameatx_np(RENAME_EXCL)`; unsupported platforms and symlink/ancestor/identity
drift fail closed. Private objects are complete and fsynced before one
source-consuming no-replace publication. Reopened or ambiguous published
objects are preserved and itemized rather than deleted by pathname. Package
success additionally recomputes the exact nested directory/archive closure
before and after publication. Failure performs no pathname cleanup or recursive
delete and returns every known private temp as exact, mismatched, or unknown
recovery evidence. Helper binary/receipt failures likewise expose one
recoverable pair record.

The public CLI accepts no authority/evidence-root selector. It derives one
canonical ledger from the real OpenClaw target root and exact target descriptor.
Before any marker, journal, official action, or managed effect, `useNonce` must
be globally unique across ordinary, every sensitive, and conflict authority.
Each family then consumes an independent durable final marker, and all three
families are reopened canonically before effect or resume. Final-name-first
exclusive reservation means zero, partial, stale, or unknown markers remain
permanently unusable after a crash. Fresh-process recovery may resume only one
exact attempt with its complete markers and byte-exact private journal.

The four lifecycle flows have bounded Linux-focused fixtures. Genesis derives
absence from retained observations rather than caller truth; preview observes
again. The official config route is Linux-only: the child receives a retained
private candidate through `/proc/self/fd`, the native supervisor must prove the
observed descendant set empty, and only native identity-bound `replaceExact`
publishes the final bytes. Darwin returns
`platform-fd-config-transport-unavailable` with no final-path fallback; this is
honest incomplete evidence, not four-lifecycle macOS support.

Official processes use a Linux-native subreaper/pidfd supervisor. A
bidirectional handshake withholds `exec` until direct pidfd and clock admission
succeed. The inherited seccomp lock rejects x32 on x86_64 and denies `setsid`,
`setpgid`, outbound signal syscalls, `pidfd_send_signal`, and `ptrace`; the
supervisor is non-dumpable and recycles terminal pidfd slots. Non-Linux
platforms return unsupported before spawning. These current-source controls
remain pending Linux adversarial execution and are not a general OS sandbox.

Complete receipts require one-to-one successful managed/supported-external
results, exact three-family nonce consumption, exact post-state, and empty
preservation/recovery sets. The producer publishes retained-session post-state,
one ordered official-action-result per action, and one append-only finalization
inside the canonical ledger. Admission reopens those bytes and recomputes the
receipt; generic JSON plus a digest cannot create authority. Predecessor
receipts recurse through the same producer-auth evidence and full
plan/approval/journal/probe/package/target/source companion graph.

The `secrets apply` and `models auth login` grammar is proposal-only. Phase 4
credential execution is unsupported, starts no process, records
`credentialPresent:false`, and cannot complete a receipt as a successful
credential effect. AgentMo does not read or persist credential values, raw
output, auth/session state, or credential-bearing OpenClaw state.

All Phase 4 target effects exercised by tests used disposable roots and fake
official seams. Real OpenClaw install, upgrade, explicit rollback, uninstall,
activation, runtime/restart, schedule, memory/RAG, domain evaluation, Birth,
Delivery, production readiness, and wider compatibility remain absent and are
owned by Phase 5.

The three Critical findings in the historical 2026-07-31 re-audit now have
focused code/test remediation: exact authority-root identity binding, preserved
candidate path/FD identity, and the Linux descendant supervisor. The current npm
dry-run contains 103 entries, including the root-binding module and the
JavaScript/native supervisor pair. No runtime evidence instance, compiled
helper, receipt, authority state, or install hook enters the tarball. The latest
aggregate attempt reached main 956 pass / 0 fail / 10 skip and packed hook 1/1;
after its load-sensitive hook replay received a test-first bounded timeout fix,
packed behavior passes 8/8. The Linux native runtime gate and a new independent
audit remain mandatory.

## Runtime layout

OpenClaw's runtime architecture maps to AgentMo profile fields as follows:

| OpenClaw surface | Meaning for AgentMo |
| --- | --- |
| `src/agents/embedded-agent-runner/` | Attempt loop, provider stream adapters, model selection, compaction, session wiring. |
| `src/agents/sessions/` | Session persistence, extension loading, resource discovery, skills, prompts, themes. |
| `packages/agent-core/` | Reusable agent core and lower-level harness contracts. |
| `src/agents/runtime/` | OpenClaw facade over the agent core. |
| `src/agents/agent-tools*.ts` | OpenClaw-owned tool definitions, schemas, policy, and hook adapters. |
| `src/agents/agent-hooks/` | Built-in runtime hooks such as compaction safeguards and context pruning. |
| `src/llm/` | Model/provider registry and provider-specific streams. |
| `src/gateway/`, `src/channels/` | WebSocket Gateway and messaging delivery surfaces. |

## Multi-agent isolation rule

OpenClaw defines an agent as a fully scoped brain:

- workspace files: `AGENTS.md`, `SOUL.md`, `USER.md`, local memory, skills;
- state directory: `~/.openclaw/agents/<agentId>/agent`;
- auth profiles: per-agent credentials and model profiles;
- session store: `~/.openclaw/agents/<agentId>/sessions`.

AgentMo should preserve this as a reusable rule: workspace, auth, and session evidence must be scoped per agent unless sharing is explicit. Do not reuse an `agentDir` across agents.

## Session and evidence rule

OpenClaw session inspection is bounded by default:

- session lists return newest 100 rows unless callers ask for another limit;
- trajectory tails redact prompt text, tool args, and tool result bodies;
- trajectory exports live inside `.openclaw/trajectory-exports/` under the selected workspace;
- cleanup and compaction are explicit session-maintenance paths.

AgentMo should encode equivalent evidence boundaries for every runtime profile: default to bounded summaries, require explicit audit expansion, and never treat raw transcripts as normal prompt context.

## Agent loop rule

OpenClaw's loop is intake → context assembly → model inference → tool execution → streaming replies → persistence. Runs are serialized per session key and protected by session write locks. Runtime profiles should therefore record:

- model loop owner;
- canonical thread/session owner;
- dynamic tool and native tool hook support;
- context lifecycle and compaction owner;
- channel delivery owner;
- known unsupported surfaces.

## Transfer into AgentMo

For the Win9 blueprint, Pi remains the certified execution authority. OpenClaw is recorded as an active alternate architecture reference, not as an implicit Pi-compatible API.

The Win9 blueprint therefore records OpenClaw certification metadata as disclosure, not parity certification:

- supported assets: generated OpenClaw scaffold, runtime contract, runbook, and architecture references;
- unsupported surfaces: live Win9 execution authority, Pi tool/eval parity, and production deployment;
- verification commands: AgentMo plan/scaffold/check commands only until OpenClaw-specific integration evidence exists.

Use OpenClaw concepts when designing future agents:

1. Gateway/channel delivery as a control-plane and ingress/egress pattern.
2. Isolated agent workspaces and per-agent session stores as memory/evidence boundaries.
3. Runtime ownership tables to avoid provider/model/runtime/channel confusion.
4. Session trajectory redaction as a default audit posture.
5. Plugin hook names as inspiration only when the active runtime exposes equivalent hooks.

## DeepSeek flash live-smoke posture

AgentMo can now prepare optional local-first OpenClaw smoke runs with DeepSeek flash:

- credentials come from a gitignored env file such as `.env`;
- AgentMo records only env-file basename, allowed key names, present/missing key names, and `valuesPersisted: false`;
- command descriptors preserve execution-affecting OpenClaw flags: `--local` for local embedded execution, `--model <id>` for model override, and `--thinking off` for non-thinking DeepSeek flash smoke runs;
- command and replay descriptors request OpenClaw `--json` output so AgentMo can use structured runtime meta before text-log compatibility matching;
- replay descriptors preserve the same local/model/thinking semantics;
- live child processes can receive proxy env values from the operator shell when those proxy keys are present, while AgentMo evidence persists only proxy key names;
- helper runs use isolated `OPENCLAW_STATE_DIR`, scaffold workspace, and run-output directories;
- helper runs delete credential-bearing OpenClaw state by default unless `--keep-state` is explicit;
- Gateway attempts that fall back to embedded execution must be recorded as `transport: "embedded-fallback"` with `fallbackFrom: "gateway"` and `fallbackEvidence`; structured OpenClaw JSON meta is authoritative even when planned transport is `unknown`, while stdout/stderr matching is only a compatibility fallback.

This remains mechanism evidence only. It does not certify Win9 domain quality, Pi/OpenClaw parity, or production deployment readiness.
