# Phase 3: 经批准研究到 Build Contract - Research

**Researched:** 2026-07-27
**Domain:** bounded live source collection, provenance, approval-bound planning, and source-grounded OpenClaw build-contract generation
**Confidence:** HIGH for repository architecture; MEDIUM for provider-specific API policy

## Summary

The immediate blocker is not schema discoverability or Stage 2 contract generation. The black-box POC reached a declaration-only scaffold: current `discover-pack` turns manifest fields into `extraction_field` declarations, and current `discover-workspace` safely ingests approved local files, but no public command performs live retrieval. The generated package therefore names a collector without shipping executable collection behavior. [VERIFIED: `/private/tmp/agentmo-entry-retest.mthIiG/INCREMENTAL_POC_REPORT.md`] [VERIFIED: `src/cli.js`, `src/discovery-db.js`, `src/discovery-source-workspace.js`]

Plan the first executable vertical slice as a new public `discover-live` lane beside—never inside—`discover-pack` and `discover-workspace`. It should admit one exact `agentmo.discovery.v1` manifest by raw-byte digest, derive an explicit HTTPS allowlist from live-enabled source entries, retrieve serially through an injected transport, enforce count/byte/time/content-type/redirect bounds before retaining data, generate canonical retrieval records with body-derived SHA-256 digests and sanitized summaries, preflight the complete artifact set, and publish the same canonical Stage 1 files atomically. [VERIFIED: existing admission and writer patterns in `src/artifact-admission.js`, `src/discovery-source-workspace.js`, and `src/persistability.js`] This is the minimum slice that converts the POC from “manifest materialization only” to executable live collection without dragging Wiki, scheduling, or OpenClaw runtime work into the blocker closure. [VERIFIED: POC blocker statement]

The remainder of Phase 3 should then add provider adapters and evidence classification, mechanical dedup/freshness/conflict/gap reporting, an exact two-digest discovery approval gate, an append-only decision ledger, and an OpenClaw-grounded build contract. The contract must declare prompt surfaces, skills, tools, plugins, memory/RAG/storage, schedules, harness/loop/runtime bindings, permissions, installation, recovery, and evidence obligations even though Phase 3 does not mutate OpenClaw. Deterministic package generation and installation belong to Phase 4; live execution, scheduling, restart recovery, RAG behavior, and runtime evidence belong to Phase 5. [VERIFIED: `.planning/ROADMAP.md`] [VERIFIED: `.reference-repos/openclaw` source at `29d018f0`]

**Primary recommendation:** Implement `discover-live` first with Node core APIs and the repository’s existing exact-admission/persistability seams; prove one real bounded HTTPS retrieval and one fail-closed negative matrix before planning any Wiki or runtime integration.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | Bounded live Web, GitHub, paper, and local research | First slice defines the live transport/adapter seam and exact bounds; later adapter wave adds GitHub and arXiv while retaining `discover-workspace` for local sources. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| DISC-02 | Canonical identity, retrieval time, summary, digest, provenance, confidence, and original reference | Retrieval record contract below makes each field mandatory and body-derived. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| DISC-03 | First-party/context/community distinction and primary-source preference | Add `evidenceClass` and `providerKind` separately from operator-declared trust; adapter defaults are explicit. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| DISC-04 | Path/size/content-type/untrusted-input/secret screening before persistence | Reuse workspace/persistability gates and add network-specific pre-body and streamed-body checks. [VERIFIED: current workspace safety patterns] |
| DISC-05 | Dedup, freshness, conflicts, and gaps without semantic-quality overclaim | Use mechanical observations and label them as such; do not treat token overlap as semantic proof. [VERIFIED: current `design-plan` coverage algorithm and Phase 3 requirement] |
| DISC-06 | Approval binds exact manifest and discovery DB digests | Add a separate `agentmo.discovery-approval.v1`; `design-plan` must require it and re-admit all three exact byte sequences. [VERIFIED: Phase 3 requirement and existing exact-admission pattern] |
| PLAN-01 | Continue planning from approved discovery DB | Make discovery approval a portable durable artifact; no command ancestry or session state is required. [VERIFIED: CORE-04 and Stage contract architecture] |
| PLAN-02 | Decision ledger separates facts, inferences, unknowns, rejected options, and human decisions | Add `agentmo.decision-ledger.v1` with typed entries and source/decision refs; never persist a raw transcript. [VERIFIED: EVID-03 and PLAN-02] |
| PLAN-03 | Bidirectional source ↔ requirement/capability/eval trace | Store normalized edge records in design plan/build contract and validate referential closure. [VERIFIED: existing `requirementsTrace`/`evidenceMap` plus PLAN-03] |
| PLAN-04 | Runtime feasibility, capability, permission, trust surface, unsupported items, alternatives | Require the full source-grounded OpenClaw resource graph and Phase 3/4/5 ownership map; Phase 3 declares it while Phase 4 performs current-target inspection/mutation. [VERIFIED: Phase 3/4 boundary in ROADMAP; `.reference-repos/openclaw` @ `29d018f0`] |
| PLAN-05 | Approval binds exact blueprint and build-contract digests | Add `agentmo.plan-approval.v1`; Phase 4 must admit the approval plus exact blueprint/build-contract bytes. [VERIFIED: PLAN-05 and CORE-04] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Preserve the canonical top-level lifecycle `Discover -> Plan -> Produce`; approval, build contract, runtime, and evidence gates do not become a fourth stage. [VERIFIED: `AGENTS.md`]
- Keep scope inside this repository; do not read or modify `pi`, `AgentHarness`, or `openclaw` without explicit user authorization. [VERIFIED: `AGENTS.md`]
- Never read, print, summarize, or copy `.env`; durable artifacts may contain only `SecretRef`, presence, or redacted summaries, never credential values, raw provider payloads, raw transcripts, or unsafe stdout/stderr. [VERIFIED: `AGENTS.md`]
- Preserve evidence semantics: `declared-ready` is deterministic wiring only, `live-success` is isolated execution only, birth reports are fail-closed/non-self-certifying, and observations are proposal-only. [VERIFIED: `AGENTS.md`]
- Code changes must pass `npm run check` and `git diff --check`; Stage 2 changes must also run `node --test test/design-plan.test.js` and the Stage 2 contract set in `docs/MVP_RUNBOOK.md`. [VERIFIED: `AGENTS.md`]
- Architecture, schema, discovery/plan/produce behavior, and evidence changes require an evidence-summary release record at `release/YYYY.MM.DD.md`; raw logs and secrets are forbidden there. [VERIFIED: `AGENTS.md`]
- Do not commit unless the user explicitly asks; when committing is later authorized, stage explicit paths only and never use `git add .` or `git add -A`. [VERIFIED: `AGENTS.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Manifest admission and source approval | CLI / Core API | Storage | The CLI captures explicit human action; core admission validates exact bytes before parsing or use. [VERIFIED: existing CLI/admission architecture] |
| Live retrieval and bounds | Core collector adapter | External provider | AgentMo owns policy and byte/time/count enforcement; providers own response and rate-limit behavior. [CITED: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api] |
| Source normalization and provenance | Core domain layer | Provider adapter | Provider adapters extract canonical metadata; core emits one common retrieval-record contract. [VERIFIED: existing local workspace separation] |
| Durable discovery artifacts | Storage / persistence layer | Core domain layer | All candidate objects are constructed and fully preflighted before atomic writers create output. [VERIFIED: `src/persistability.js`, `src/discovery-source-workspace.js`] |
| Discovery approval | Core governance layer | CLI | Approval binds raw-byte digests; CLI invocation is the human-operated public surface. [VERIFIED: DISC-06] |
| Decision ledger and trace graph | Plan domain layer | Storage | Typed decisions and edges are durable state; transcript/session context is non-authoritative. [VERIFIED: PLAN-02/03 and EVID-03] |
| Runtime feasibility and build contract | Plan domain layer | OpenClaw target contract | Phase 3 projects every required agent resource onto source-grounded OpenClaw mechanisms without mutating the target. [VERIFIED: Phase 3/4 roadmap boundary; `.reference-repos/openclaw` at `29d018f0`] |
| Wiki, RAG, database, scheduler, and restart behavior | OpenClaw runtime / plugin layer | Generated package | Phase 3 declares exact choices and evidence obligations; Phase 4 materializes them; Phase 5 proves them live. [VERIFIED: `.reference-repos/openclaw/extensions/memory-core`, `extensions/memory-lancedb`, `src/cron`, and embedded runner] |

## OpenClaw Agent Construction Resource Map

The local reference is OpenClaw `2026.6.11` at git commit `29d018f0`; its package requires Node `>=22.19.0 <23 || >=23.11.0`. AgentMo must record both the inspected source commit and the compatible runtime predicate because a generic target name does not bind a concrete runtime contract. [VERIFIED: `.reference-repos/openclaw/package.json`; `.reference-repos/openclaw` git HEAD]

### Source-Grounded Capability Map

| Agent resource | OpenClaw path / symbol | Runtime mechanism discovered | Required `agentmo.build-contract.v1` projection | Generated artifact or Phase 4 action | Required evidence | Owner |
|----------------|------------------------|------------------------------|------------------------------------------------|--------------------------------------|-------------------|-------|
| Prompt engineering | `src/agents/system-prompt.ts`: `buildAgentBootstrapSystemContext`, `buildAgentBootstrapSystemPromptSections`, `buildAgentSystemPrompt`, `buildRuntimeLine` | OpenClaw composes a system prompt from runtime/tool/channel policy plus ordered bootstrap context; prompt construction is runtime code, not one monolithic prompt file. [VERIFIED: OpenClaw source @ `29d018f0`] | `prompt.profile`, `prompt.bootstrapFiles[]`, `prompt.staticSections[]`, `prompt.dynamicSections[]`, `prompt.budgets`, `prompt.sourceDigests`, `prompt.secretPolicy` | Generate only declared workspace files; preserve stable order and distinguish cache-stable from run-dynamic content. | File manifest/digests, rendered prompt inventory, bounded prompt smoke; never claim semantic quality from rendering alone. | Phase 3 declares; Phase 4 generates/inspects; Phase 5 executes/evaluates |
| Workspace context | `src/agents/system-prompt.ts`; bootstrap files referenced by runtime | Canonical context includes `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `BOOTSTRAP.md`, and `MEMORY.md`; `HEARTBEAT.md` is a dynamic scheduled-turn surface. [VERIFIED: OpenClaw source @ `29d018f0`] | One record per file: `path`, `purpose`, `required`, `owner`, `maxChars`, `contentSourceRefs`, `digest`, `secretAllowed:false` | Extend current scaffold beyond its existing five context files when the contract requires bootstrap, root memory, or heartbeat behavior. | Exact generated-file inventory and missing/extra-file test. | Phase 3 declares; Phase 4 generates |
| Skills | `src/skills/loading/workspace.ts`: `buildWorkspaceSkillSnapshot`, `buildWorkspaceSkillsPrompt`, `resolveSkillsPromptForRun`, `loadVisibleWorkspaceSkillEntries`, `syncSkillsToWorkspace`; `src/skills/loading/session.ts` | Skills are discovered from bounded sources, filtered for visibility/eligibility, snapshotted, formatted into a bounded prompt, and optionally synchronized into the workspace. Defaults include 200 loaded per source, 150 in prompt, 18,000 prompt chars, and 256,000 bytes per skill file. [VERIFIED: OpenClaw source @ `29d018f0`] | `skills[]` with id/path/source/precedence/frontmatter/eligibility/runtime requirements/digest; `skillsPolicy` with discovery roots, sync mode, prompt/file/count limits, and snapshot behavior | Generate `workspace/skills/<id>/SKILL.md` plus required assets only; do not copy undeclared skill trees. | Loader/visibility snapshot, budget test, symlink/oversize rejection, stable digest. | Phase 3 declares; Phase 4 generates/loads; Phase 5 exercises |
| Tools | `src/agents/agent-tools.ts`: `createOpenClawCodingTools`; `src/agents/tool-policy-pipeline.ts`: `buildDefaultToolPolicyPipelineSteps`, `applyToolPolicyPipeline`; `src/plugins/trusted-tool-policy.ts`: `runTrustedToolPolicies` | Tool availability is the result of construction plus an ordered policy pipeline and trusted-plugin policies; `TOOLS.md` is guidance, not authority. [VERIFIED: OpenClaw source @ `29d018f0`] | `tools[]` with canonical name, owner, input/output schema refs, side effects, required permissions, replay safety, evidence policy; `toolPolicy` with allow/deny, sandbox, approval mode, pipeline order, and fail-closed default | Generate tool guidance and config patch; install a plugin only when the capability is not already runtime-owned. | Effective tool inventory, deny-case tests, sandbox/approval trace, bounded tool-result evidence. | Phase 3 declares; Phase 4 materializes/inspects; Phase 5 invokes |
| Plugins | `src/plugins/manifest-registry.ts`: `loadPluginManifestRegistry`; `src/plugins/loader.ts`: `loadOpenClawPlugins`; `src/plugins/install.ts`: `installPluginFromInstalledPackageDir`, `installPluginFromArchive`, `installPluginFromDir`, `installPluginFromFile`, `installPluginFromNpmSpec`, `installPluginFromPath`; `src/plugins/install-security-scan.ts` | Plugin manifests are discovered before activation; loaders create the runtime registry; installation has distinct source lanes and security scans. [VERIFIED: OpenClaw source @ `29d018f0`] | `plugins[]` with exact id/version/source kind/source digest/manifest digest/capabilities/kind/activation/required host version/config schema/managed path/trust decision; `pluginPolicy` with install lane, scan requirement, enablement, load precedence, doctor and rollback | Prefer built-in/runtime capability; otherwise copy or install only an approved exact source through the matching lane and emit a reversible config patch. | Pre-install scan, installed manifest/index, activation registry snapshot, doctor result, rollback proof. | Phase 3 decides necessity/contract; Phase 4 installs/inspects; Phase 5 proves runtime behavior |
| Memory prompt and tools | `src/memory/root-memory-files.ts`; `src/plugins/memory-state.ts`; `extensions/memory-core/index.ts` | `MEMORY.md` is the canonical root memory file. A memory-kind plugin owns the capability slot and can register prompt sections, flush plans, runtime, public artifacts, `memory_search`, and `memory_get`. [VERIFIED: OpenClaw source @ `29d018f0`] | `memory.mode`, `memory.slotOwner`, `memory.rootFile`, `memory.additionalPaths`, `memory.promptInjection`, `memory.flushPolicy`, `memory.tools`, `memory.publicArtifacts`, `memory.retention`, `memory.sensitivity` | Generate `MEMORY.md`/memory policy and select exactly one compatible memory-slot owner; never silently combine competing owners. | Slot-decision snapshot, exact-read bounds, search-disabled behavior, flush/public-artifact inventory. | Phase 3 selects/declares; Phase 4 configures; Phase 5 exercises/restarts |
| RAG / embeddings | `src/agents/memory-search.ts`: `resolveMemorySearchConfig`; `extensions/memory-core/src/memory/manager-search.ts`; embedding adapters under provider extensions | Core memory can combine full-text and embedding search over memory files and optional session/wiki corpora. Its vector path uses `sqlite-vec` when ready and bounded fallback scanning otherwise. [VERIFIED: OpenClaw source @ `29d018f0`] | `rag.corpora[]`, `rag.chunking`, `rag.embedding.provider/model/dimensions/secretRef`, `rag.index`, `rag.search.hybridWeights/minScore/maxResults`, `rag.citations`, `rag.sync`, `rag.fallback`, `rag.dataBoundary` | Emit config with `SecretRef` only; declare optional session/wiki corpus explicitly; do not infer embedding credentials. | Index status, query with citations/source lines, disabled/fallback test, restart persistence, corpus-isolation test. | Phase 3 declares; Phase 4 materializes; Phase 5 indexes/queries/restarts |
| Databases / storage | `extensions/memory-core/src/memory/manager-db.ts`: `publishMemoryDatabaseTables`; `src/state/*`; `src/agents/auth-profiles/sqlite.ts`; `src/cron/store/schema.ts`; OpenClaw `AGENTS.md` storage rules | OpenClaw uses a shared state SQLite DB, per-agent `openclaw-agent.sqlite`, and dedicated databases only when ownership/lifecycle/volume require them. Memory-core publishes shadow reindex tables transactionally; auth, cron, task, sandbox, and memory data have distinct owners. [VERIFIED: OpenClaw source @ `29d018f0`] | `storage[]` with logical owner, scope (`shared`/`per-agent`/`dedicated`/`named-file`), schema owner, lifecycle, migration, backup/retention, sensitivity, max growth, and recovery; no raw absolute production paths in the portable contract | Phase 4 generates directory/config intent, not database bytes; runtime creates owned DBs. Named durable files remain explicit artifacts. | Schema/version inventory, permissions, migration/rollback, restart readback, size/retention checks. | Phase 3 maps ownership; Phase 4 prepares; Phase 5 creates/proves |
| Alternate long-term vector memory | `extensions/memory-lancedb/index.ts`: `MemoryDB`; `extensions/memory-lancedb/openclaw.plugin.json` | `memory-lancedb` is a separate memory-slot plugin with vector store, auto-recall, auto-capture, and `memory_store`/`memory_recall`/`memory_forget`; it is not an additive default beside memory-core. [VERIFIED: OpenClaw source @ `29d018f0`] | Model as an explicit alternative `memory.slotOwner`, never a simultaneous implicit dependency; bind provider, dimensions, capture/recall limits, storage options, and privacy policy | Install/configure only when approved need cannot be met by memory-core. | Slot exclusivity, capture gating, recall cap, forget behavior, credential absence from artifacts. | Phase 3 decision; Phase 4 install/configure; Phase 5 live proof |
| Cron / scheduling | `src/cron/service.ts`: `CronService`; `src/cron/store/schema.ts`: `getCronStoreKysely`; `src/cron/isolated-agent/run.ts`: `runCronIsolatedAgentTurn`; `run-executor.ts`: `createCronPromptExecutor`, `executeCronRun`; `run-session-state.ts`: `persistCronSkillsSnapshotIfChanged` | Schedules are durable jobs with execution and delivery policy; isolated turns preserve agent/session identity and may persist the skills snapshot used by a cron session. [VERIFIED: OpenClaw source @ `29d018f0`] | `schedules[]` with id, enabled, cadence/timezone, agent/session target, prompt/input ref, delivery target, timeout, retry/failure alert, concurrency/idempotency, skills snapshot policy, retention, required permissions | Generate a schedule plan/CLI descriptor in Phase 4; applying it is an explicit mutation and must not happen during scaffold generation. | Listed job, deterministic next-run, one isolated execution, duplicate-timer/idempotency negative, delivery result, restart continuity. | Phase 3 declares; Phase 4 emits mutation plan; Phase 5 applies/proves |
| Harness | `src/agents/harness/selection.ts`: `resolveAvailableAgentHarnessPolicy`, `selectAgentHarness`, `agentHarnessBuildsOpenClawTools`, `agentHarnessExposesOpenClawTools`, `runAgentHarnessAttempt` | Harness is selected independently from provider/model; built-in OpenClaw and eligible plugin harnesses have different tool construction/exposure behavior. [VERIFIED: OpenClaw source @ `29d018f0`] | `harness.id`, `harness.kind`, `harness.selectionPolicy`, `harness.requiredCapabilities`, `harness.toolOwnership`, `harness.fallback`, `harness.unsupported` | Bind the selected harness in runtime plan/config; do not infer it from model/provider name. | Selection trace, effective tool surface, unsupported/fallback failure. | Phase 3 selects contract; Phase 4 validates availability; Phase 5 executes |
| Agent loop | `src/agents/embedded-agent-runner/run.ts`: `runEmbeddedAgent`; `run/attempt.ts`: `runEmbeddedAttempt`; `src/agents/runtime-plan/build.ts`: `buildAgentRuntimePlan` | The loop resolves workspace, auth/model/fallback, runtime plan, harness, tools, hooks, sessions, lanes, compaction, and tool-loop controls before and during attempts. [VERIFIED: OpenClaw source @ `29d018f0`] | `loop.modelPolicy`, `loop.authProfileRef`, `loop.fallbacks`, `loop.thinking`, `loop.maxAttempts`, `loop.timeout`, `loop.concurrencyLane`, `loop.compaction`, `loop.toolLoopGuard`, `loop.hooks`, `loop.stopReasons` | Phase 4 emits the runtime binding/plan; it must keep provider, model, harness, channel, transport, and session selector distinct. | Declared runtime plan, isolated live attempt trace, stop/fallback/timeout negative cases, bounded trajectory evidence. | Phase 3 declares; Phase 4 binds; Phase 5 runs |
| Permissions / trust boundary | Tool policy files above; `src/security/*`; plugin install scan; sandbox registry | Trust is enforced at multiple boundaries: artifact/source admission, plugin install, plugin activation, effective tool policy, sandbox scope, secret refs, and channel ownership. No single allowlist substitutes for the others. [VERIFIED: OpenClaw source @ `29d018f0`] | `permissions[]` with capability/resource/action/scope/necessity/default/approval; `trustBoundaries[]`; `secrets[]` containing reference/presence only; explicit unsupported capability list | Generate least-privilege config patch and human-readable disclosure; mutation requires exact approved contract. | Effective permissions inventory plus denied network/filesystem/tool/plugin cases; secret value-blind checks. | Phase 3 declares; Phase 4 preflights; Phase 5 verifies |
| Install / load / execute | Plugin install/loader symbols above; current AgentMo `src/scaffold-files.js`, runtime-plan and run surfaces | Install, load, and execute are separate state transitions. A generated scaffold is not an installed plugin, an activated registry entry, or a successful run. [VERIFIED: both repositories] | `installPlan.operations[]` with preconditions, exact inputs, mutation paths, postconditions, rollback; `loadPlan`; `executionPlan`; each has a separate evidence class | Phase 4 produces package and reversible mutation plan, then explicit install; Phase 5 performs isolated execution. | Package manifest → install receipt → registry/load inventory → runtime receipt, with no transitive certification. | Phase 3 contracts; Phase 4 package/install; Phase 5 execute |
| Recovery | `src/config/sessions/store.ts`: `saveSessionStore`, `updateSessionStore`; `embedded-agent-runner/compact.ts`; `compaction-successor-transcript.ts`; `post-compaction-loop-guard.ts`; `run/codex-app-server-recovery.ts`; cron session-state module | Recovery spans durable session updates, transcript archival/successors, compaction checkpoints, post-compaction loop aborts, harness-specific retry, and cron continuation. [VERIFIED: OpenClaw source @ `29d018f0`] | `recovery.session`, `recovery.compaction`, `recovery.restart`, `recovery.cron`, `recovery.pluginDoctor`, `recovery.migrations`, `recovery.rollback`, with failure classification and bounded retries | Phase 4 emits runbook and recovery policy; Phase 5 kills/restarts isolated runtime and proves readback/continuation or reports unsupported. | Restart test, persisted session/memory/job readback, bounded retry, corrupt/incompatible-state fail-closed case, rollback result. | Phase 3 declares; Phase 4 prepares; Phase 5 proves |

### Prescriptive Build-Contract Shape

The build contract should be a target-independent envelope with an OpenClaw binding, not an OpenClaw config dump. The envelope keeps approved intent portable; the binding records how that intent maps to the inspected runtime. [VERIFIED: AgentMo runtime-profile separation and OpenClaw source ownership boundaries]

```json
{
  "schemaVersion": "agentmo.build-contract.v1",
  "subject": { "agentId": "<id>", "target": "openclaw" },
  "bindings": {
    "blueprint": { "digest": "sha256:<64hex>" },
    "discoveryApproval": { "digest": "sha256:<64hex>" },
    "decisionLedger": { "headDigest": "sha256:<64hex>" }
  },
  "targetRuntime": {
    "id": "openclaw",
    "sourceRevision": "29d018f0",
    "observedVersion": "2026.6.11",
    "nodeRange": ">=22.19.0 <23 || >=23.11.0"
  },
  "resources": {
    "prompt": {},
    "skills": [],
    "tools": [],
    "plugins": [],
    "memory": {},
    "rag": {},
    "storage": [],
    "schedules": []
  },
  "execution": {
    "harness": {},
    "loop": {},
    "runtimeBinding": {},
    "installPlan": {},
    "recovery": {}
  },
  "permissions": [],
  "unsupported": [],
  "acceptanceCases": [],
  "evidencePlan": [],
  "certificationBoundary": {
    "declaredReadyIsRuntimeSuccess": false,
    "liveSuccessIsDomainQuality": false,
    "buildContractIsInstallationAuthority": false
  }
}
```

Every resource entry should carry stable identity, source references, necessity, owner, exact digest where content exists, secrets policy, permissions, failure behavior, evidence obligation, and lifecycle phase. This avoids a “misc config” bag that the planner cannot verify for completeness. [VERIFIED: OpenClaw mechanisms above; AgentMo CORE-04/EVID-03]

### Generated OpenClaw Package Map

| Package path / action | Contract source | Purpose and rule |
|-----------------------|-----------------|------------------|
| `openclaw/workspace/AGENTS.md` | `resources.prompt.bootstrapFiles` | Operating instructions; must not duplicate tool authority or embed credentials. [VERIFIED: current AgentMo scaffold and OpenClaw prompt builder] |
| `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md` | prompt/persona/user/tool-guidance records | Separate persona, visible identity, user context, and tool guidance because OpenClaw loads them as distinct bootstrap surfaces. [VERIFIED: OpenClaw prompt builder] |
| `BOOTSTRAP.md` | explicit bootstrap record | Optional first-run/bootstrap instructions; generate only when declared. [VERIFIED: OpenClaw prompt builder] |
| `MEMORY.md` and `memory/*` | memory policy | Durable file-backed memory content/policy; no generated claim that it has been indexed or recalled. [VERIFIED: `root-memory-files.ts`, memory-core] |
| `HEARTBEAT.md` | scheduling/heartbeat record | Dynamic scheduled-turn guidance; generation is not cron registration. [VERIFIED: OpenClaw prompt/scheduled-turn source] |
| `skills/<id>/SKILL.md` plus declared assets | `resources.skills[]` | Bounded, digest-bound skill package respecting loader eligibility and precedence. [VERIFIED: OpenClaw skills loader] |
| `config/openclaw.agent.patch.json` | runtime/resources/permissions | Patch-shaped intent only; must not silently install plugins, create schedules, or write secrets. [VERIFIED: current `src/scaffold-files.js`] |
| `install-plan.json` | `execution.installPlan` | Ordered, reversible mutations with exact pre/post checks; consumed only after plan approval. [VERIFIED: OpenClaw install/load state separation] |
| `schedule-plan.json` | `resources.schedules[]` | Declarative cron jobs and expected evidence; application deferred to the explicit runtime mutation step. [VERIFIED: OpenClaw cron service] |
| `runtime-binding.json` | target runtime, harness, loop, permissions | Exact runtime/version/source/harness/provider/model/tool-policy binding for the run-plan seam. [VERIFIED: OpenClaw runtime-plan/harness source] |
| `evals/*`, `evidence-policy.json`, `recovery-runbook.md` | acceptance/evidence/recovery sections | Tests the intended resource graph and later live behavior without promoting declared evidence into runtime/domain claims. [VERIFIED: AgentMo evidence semantics] |

### Phase Ownership Boundary

- **Phase 3 owns specification and approval:** collect approved evidence, resolve resource choices, state unsupported surfaces and alternatives, emit `agentmo.build-contract.v1`, and bind it with the exact blueprint in `agentmo.plan-approval.v1`. It must not write OpenClaw state, install plugins, register cron jobs, or claim runtime availability. [VERIFIED: `.planning/ROADMAP.md`]
- **Phase 4 owns deterministic production and reversible mutation:** generate the complete package from the exact approved contract, compare it against the inspected OpenClaw surface, preflight versions/permissions, and perform separately authorized install/load operations with receipts. [VERIFIED: `.planning/ROADMAP.md`; OpenClaw install/loader architecture]
- **Phase 5 owns runtime proof:** execute the bound harness/agent loop, exercise tools and memory/RAG, apply and trigger schedules, restart the isolated runtime, verify recovery/readback, run bounded evals, and aggregate non-self-certifying evidence. [VERIFIED: `.planning/ROADMAP.md`; OpenClaw embedded runner/cron/memory architecture]

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Node.js core | `>=20` (host observed `v24.18.0`) | Runtime, URL parsing, crypto, streams, test runner | The package already declares Node `>=20` and uses only core modules. [VERIFIED: `package.json`; environment probe] |
| `URL`, `AbortSignal`, `fetch` or injected transport | Node 20 core | Canonical URLs, timeout cancellation, HTTP retrieval | Node 20 exposes browser-compatible fetch and `AbortSignal.timeout`; use an injected transport so tests do not require the network. [CITED: https://nodejs.org/download/release/latest-v20.x/docs/api/globals.html] |
| `node:crypto` SHA-256 | Node core | Raw response content digest and exact artifact bindings | SHA-256 is already the repository’s canonical digest mechanism. [VERIFIED: codebase grep] |
| `node:test` | Node core | Unit, contract, CLI, and negative tests | All existing tests use the built-in test runner. [VERIFIED: `test/`] |
| Existing AgentMo admission/persistability modules | repository `0.1.0` | Exact raw-byte admission, secret/path audit, preflight, atomic publication | These seams already protect every current durable Stage 1 path. [VERIFIED: `src/artifact-admission.js`, `src/persistability.js`] |
| OpenClaw target contract | inspected `2026.6.11` / commit `29d018f0` | Concrete projection target for prompt, skills, tools, plugins, memory, cron, harness, loop, permissions, install, and recovery | The local source is explicitly authorized and AgentMo already encodes the same target Node range in `src/runtime-compatibility.js`. [VERIFIED: both repositories] |

### Supporting

| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| GitHub REST API | version header must be explicit | GitHub metadata/content adapter | Add after the generic live collector seam; send a fixed `X-GitHub-Api-Version`, use serial/conditional requests, and stop on rate-limit signals. [CITED: https://docs.github.com/en/rest/about-the-rest-api/api-versions] [CITED: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api] |
| arXiv legacy API | current Atom contract | Paper metadata adapter | Persist bounded descriptive metadata/abstracts, not full PDFs; one connection and no more than one request per three seconds. [CITED: https://info.arxiv.org/help/api/user-manual.html] [CITED: https://info.arxiv.org/help/api/tou.html] |
| Existing `discover-workspace` | `agentmo.discovery-workspace.v1` | Local document adapter | Keep as the local-source lane and normalize its output into the same provenance/classification model. [VERIFIED: `src/discovery-source-workspace.js`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node core HTTP/fetch seam | New crawler/browser framework | A crawler expands redirects, robots, JavaScript execution, persistence, and dependency trust before the blocker is closed; defer it. [ASSUMED] |
| Provider-specific metadata adapters | Generic HTML semantic extraction | Generic HTML extraction needs a real parser and source-specific canonicalization; storing a bounded sanitized summary is sufficient for the first executable proof. [ASSUMED] |
| File artifacts | SQLite/Wiki immediately | A database would help query/restart behavior but conflates Phase 3 research evidence with the later Wiki/runtime blocker; defer it. [VERIFIED: POC scope and roadmap boundary] |

**Installation:** No external package is required for the first slice. [VERIFIED: Node core and existing repository stack]

## Package Legitimacy Audit

No new external package is recommended for the first executable slice, so the package-legitimacy gate is not applicable. [VERIFIED: Standard Stack above]

## Architecture Patterns

### System Architecture Diagram

```text
exact manifest bytes + digest
            |
            v
  admission + schema validation
            |
            v
 explicit live-source allowlist ---- reject non-HTTPS / credentials / unsupported adapter
            |
            v
 serial collector orchestrator ---- count deadline / per-source deadline / byte cap
            |
            v
 provider adapter / injected transport
            |
            +---- redirect? ----> revalidate exact destination or fail closed
            |
            +---- bad status/type/size/rate limit? ----> bounded failure record, no source body
            |
            v
 raw-byte digest -> sanitize -> bounded summary/chunks -> provenance/classification
            |
            v
 whole-candidate persistability preflight
            |
            +---- any unsafe candidate? ----> zero committed output
            |
            v
 canonical discovery DB + facts + coverage + source cards/chunks
            |
            v
 exact manifest+DB approval (later wave) -> approved Plan -> build contract -> final approval
```

The primary path ends at canonical Stage 1 artifacts for the first slice; no blueprint, Wiki, scheduler, package, or runtime artifact is written. [VERIFIED: Stage contract independence pattern]

### Recommended Project Structure

```text
src/
├── discovery-live.js             # orchestrator, bounds, common record contract
├── discovery-live-transport.js   # default HTTPS transport + injected test seam
├── discovery-provenance.js       # canonical URL, evidence class, confidence, digest
├── discovery-approval.js         # later: two-digest approval artifact
├── decision-ledger.js            # later: typed Plan decisions
├── build-contract.js             # later: Produce-facing contract
├── plan-approval.js              # later: blueprint+build-contract approval
├── collectors/
│   ├── web.js                    # exact-URL Web metadata/body lane
│   ├── github.js                 # versioned GitHub REST adapter
│   └── arxiv.js                  # Atom metadata adapter
└── cli.js                        # thin public command routing/argument admission

test/
├── discovery-live.test.js
├── discovery-live-security.test.js
├── discovery-approval.test.js
├── decision-ledger.test.js
├── build-contract.test.js
└── phase3-contracts.test.js
```

This structure follows the existing separation between CLI parsing, domain construction, source intake, and persistence. [VERIFIED: `src/cli.js`, `src/discovery-source-workspace.js`, `src/discovery-db.js`]

### Pattern 1: Policy-Owned Orchestrator, Injected Transport

**What:** The orchestrator owns allowlist and limits; a narrow transport returns status, headers, final URL, and a byte stream. Tests inject a deterministic transport, but production CLI never accepts a caller-provided module path or bypass adapter. [VERIFIED: repository’s existing pattern of closed production authority with injected unit seams]

**When to use:** Every live provider adapter.

```javascript
// Source basis: Node 20 fetch/AbortSignal docs plus existing AgentMo adapter patterns.
export async function collectApprovedSource(source, policy, transport = defaultTransport) {
  const requestedUrl = canonicalApprovedHttpsUrl(source.location, policy.allowlist);
  const signal = AbortSignal.timeout(policy.timeoutMs);
  const response = await transport({ url: requestedUrl, signal, redirect: "manual" });
  const finalUrl = validateResponseAndRedirect(response, requestedUrl, policy);
  const bytes = await readAtMost(response.body, policy.maxBytes);
  return buildRetrievalRecord({ source, requestedUrl, finalUrl, bytes, response });
}
```

`AbortSignal.timeout` exists in the Node 20 baseline; byte counting must remain a separate guard. [CITED: https://nodejs.org/download/release/latest-v20.x/docs/api/globals.html]

### Pattern 2: Raw Digest Before Sanitized Summary

**What:** Compute `contentDigest` from the exact bounded response bytes, then decode, normalize, redact, and derive a bounded summary/chunks. Persist the digest and sanitized derivatives, never the raw provider payload. [VERIFIED: DISC-02/EVID-03 and current exact-byte artifact admission model]

**When to use:** Every successful live retrieval.

```javascript
// Source: existing crypto/persistability patterns in this repository.
const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sanitizedText = redactManagedText(decodeAllowedContent(bytes, contentType));
const summary = boundedSummary(sanitizedText, 512);
assertPersistable({ contentDigest, summary }, { subject: "discovery-retrieval-record" });
```

### Pattern 3: Whole-Set Preflight Before Publication

**What:** Build and serialize every output in memory first. If any record, JSONL line, summary, path, or diagnostic fails persistability, create no output directory. Only after all candidates pass should atomic writers publish the set. [VERIFIED: `prepareDiscoveryWorkspace` and writer tests]

**When to use:** `discover-live`, approvals, ledgers, build contracts, and final approval.

### Pattern 4: Approval as a Separate Exact-Binding Artifact

**What:** `agentmo.discovery-approval.v1` contains approval status and exactly two admitted provenance tuples: discovery manifest and derived discovery DB. `design-plan` re-hashes and validates the supplied manifest, DB, and approval bytes; embedded success flags are never authority by themselves. [VERIFIED: DISC-06 and Phase 1.1 authority rules]

**When to use:** Before any live discovery DB enters Plan.

```json
{
  "schemaVersion": "agentmo.discovery-approval.v1",
  "decision": "approved",
  "bindings": {
    "discoveryManifest": {
      "identity": "agentmo.discovery.v1",
      "subject": "discovery-manifest",
      "digest": "sha256:<64hex>"
    },
    "discoveryDb": {
      "identity": "agentmo.discovery-db.v1",
      "subject": "discovery-db",
      "digest": "sha256:<64hex>"
    }
  },
  "scope": "enter-plan-only",
  "certificationBoundary": {
    "sourceQualityCertified": false,
    "runtimeCertified": false,
    "productionApproved": false
  }
}
```

The approval must not contain a free-form transcript or credential-bearing actor state. [VERIFIED: EVID-03]

### Pattern 5: Build Contract as the Produce Input

**What:** `agentmo.build-contract.v1` references the exact blueprint, discovery approval, decision ledger head, capability requirements, permission requirements, target feasibility, unsupported behaviors, acceptance cases, evidence boundaries, and remaining risks. A separate `agentmo.plan-approval.v1` binds the exact blueprint and build-contract bytes. [VERIFIED: PLAN-03/04/05]

**When to use:** Final Phase 3 wave, before Phase 4 package generation.

### Anti-Patterns to Avoid

- **Extending `discover-pack` to fetch:** It is intentionally manifest-only and has tests/docs promising no source reads; add a sibling command. [VERIFIED: `docs/STAGE_CONTRACTS.md`, `test/stage-contracts.test.js`]
- **Treating manifest `trust_level` as retrieved confidence:** Operator declaration is not retrieval or verification evidence; store `declaredTrustLevel` separately from record `confidence` and `evidenceClass`. [VERIFIED: POC overclaim finding]
- **Calling `response.text()` before bounding bytes:** A content-length header is optional or untrusted; stream and stop at `maxBytes + 1`. [ASSUMED]
- **Automatically following redirects:** Every destination must remain inside the explicit approved allowlist; otherwise a redirect bypasses source approval. [ASSUMED]
- **Persisting raw HTML/API/Atom payloads:** Durable evidence should contain content digests and bounded sanitized derivatives, not full provider bodies. [VERIFIED: `AGENTS.md`, EVID-03]
- **Using keyword overlap as semantic quality proof:** Existing Stage 2 matching is mechanical token overlap; label its basis and keep human/eval gates. [VERIFIED: `src/design-plan.js`, DISC-05]
- **Making approval a boolean inside the DB/blueprint:** The approved object could self-certify; use an independently admitted approval artifact that binds exact bytes. [VERIFIED: Phase 1.1 authority rule]
- **Setting generated blueprint provenance `reviewed:true`:** Generation is not human review; Phase 3 must make review an exact external approval input. [VERIFIED: current `blueprint-draft` behavior and PLAN-05]
- **Adding Wiki/scheduler/OpenClaw code to Wave 1:** Those features increase surface area without proving the missing public live collector. [VERIFIED: POC blocker]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Artifact digest admission | Session ancestry or parsed-object digest | Existing `loadAdmittedArtifact` | It hashes one captured raw buffer before parse and binds a canonical subject. [VERIFIED: existing admission contract] |
| Secret/path screening | Collector-specific regex set | Existing redaction, evidence audit, and persistability gates | The repository already centralizes nested value/key/path controls. [VERIFIED: `src/persistability.js`, `src/secret-redaction.js`] |
| Atomic durable writes | Direct `writeFile` per output | Existing persistable atomic writers after whole-set preflight | Prevents partial “success” artifacts and candidate drift. [VERIFIED: workspace writer tests] |
| GitHub pagination and cache validators | Guessing URL shapes or polling blindly | `Link`, `ETag`, `Last-Modified`, and rate-limit headers | GitHub explicitly documents these controls. [CITED: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api] |
| arXiv full-text redistribution policy | Assuming open access means redistribution permission | Metadata-first adapter and per-paper license handling | arXiv metadata is CC0, but e-print redistribution depends on copyright/license. [CITED: https://info.arxiv.org/help/api/tou.html] |
| Human approval authority | Generated success flag | Separate exact-digest approval artifact | Generated artifacts must not self-certify. [VERIFIED: Phase 1.1 authority model] |

**Key insight:** The repository already has the hard durable-artifact primitives. The Phase 3 implementation should concentrate new complexity in a narrow, policy-owned network intake seam and portable approval/trace contracts.

## Common Pitfalls

### Pitfall 1: Bound Declared, Body Unbounded
**What goes wrong:** Count and timeout limits exist, but one response allocates an arbitrarily large body. [ASSUMED]
**Why it happens:** The implementation trusts `content-length` or calls a whole-body helper. [ASSUMED]
**How to avoid:** Reject an oversized declared length and independently stop the stream at `maxBytes + 1`; abort and emit only a bounded code. [ASSUMED]
**Warning signs:** Tests cover timeout/status but not chunked transfer without `content-length`. [ASSUMED]

### Pitfall 2: Redirect Escapes Approval
**What goes wrong:** An approved URL redirects to an unapproved host, private service, login page, or large binary. [ASSUMED]
**Why it happens:** Default redirect following hides intermediate destinations. [ASSUMED]
**How to avoid:** Use manual redirects, cap hops, and revalidate scheme, credentials, hostname, port, and exact destination policy at every hop. [ASSUMED]
**Warning signs:** The retrieval record has only `response.url` and no requested/final URL pair. [ASSUMED]

### Pitfall 3: Partial Publication Looks Successful
**What goes wrong:** Some source cards or DB files exist after one source fails secret/content checks. [VERIFIED: threat addressed by existing workspace tests]
**Why it happens:** Files are written during retrieval. [ASSUMED]
**How to avoid:** Keep retrieval candidates in memory or an uncommitted owned temp area, preflight all outputs, then publish. [VERIFIED: existing persistability architecture]

### Pitfall 4: Provider Metadata Becomes Trust
**What goes wrong:** `verified` from a manifest or official-domain hostname is treated as verified claim content. [VERIFIED: POC semantic overclaim class]
**Why it happens:** Source identity, retrieval success, evidence class, and claim confidence are collapsed into one field. [ASSUMED]
**How to avoid:** Preserve separate fields for declared trust, retrieval status, evidence class, provider provenance, and confidence rationale. [VERIFIED: DISC-02/03]

### Pitfall 5: Approval Does Not Go Stale
**What goes wrong:** A changed summary, confidence, coverage report, or manifest still enters Plan under an old approval. [VERIFIED: DISC-06 threat]
**Why it happens:** Approval binds IDs or parsed subsets rather than raw artifact bytes. [ASSUMED]
**How to avoid:** Bind exact raw-byte manifest and DB digests, then require the approval’s own digest at Plan admission. [VERIFIED: CORE-04/DISC-06]

### Pitfall 6: Generated “Reviewed” Status
**What goes wrong:** A generated blueprint sets `reviewed:true` without an external review artifact. [VERIFIED: current `src/blueprint-draft.js`]
**Why it happens:** Contract validity is conflated with human approval. [VERIFIED: POC boundary]
**How to avoid:** Generated state is `draft`; only exact admitted `plan-approval` permits Phase 4 consumption. [VERIFIED: PLAN-05]

### Pitfall 7: API Policy Drift
**What goes wrong:** GitHub version/rate behavior or arXiv limits change after planning. [CITED: https://docs.github.com/en/rest/about-the-rest-api/api-versions] [CITED: https://info.arxiv.org/help/api/tou.html]
**How to avoid:** Keep provider policy in versioned adapters, expose response-limit evidence, and re-check official docs before implementation of each provider wave. [CITED: same official docs]
**Warning signs:** API version headers or rate rules are scattered through generic collector code. [ASSUMED]

## Code Examples

Verified repository patterns to reuse:

### Exact Input Admission Before Collection

```javascript
// Source: src/cli.js existing discover-pack/discover-workspace pattern.
const manifest = await loadDiscoveryManifest(options.file, {
  subject: "discovery-manifest",
  expectedDigest: options.digests["discovery-manifest"],
});
const live = await buildDiscoveryLive(manifest, {
  manifestPath: options.file,
  transport: defaultLiveTransport,
});
```

### Whole-Candidate Preflight and Atomic Writes

```javascript
// Source: src/discovery-source-workspace.js and src/persistability.js.
const prepared = prepareDiscoveryLive(live);
await writePersistableJsonAtomic(discoveryDbPath, live.discoveryDb, {
  subject: "discovery-db",
});
await writePersistableTextAtomic(factsPath, prepared.factsJsonl, {
  subject: "discovery-facts",
});
```

The actual implementation must preflight every file before the first writer call, matching the current workspace candidate-mismatch protection. [VERIFIED: `prepareDiscoveryWorkspace`]

### Provider-Aware Rate-Limit Result

```javascript
// Source basis: GitHub official rate-limit documentation.
if (response.status === 403 || response.status === 429) {
  return boundedFailure("provider_rate_limited", {
    retryAfterPresent: response.headers.has("retry-after"),
    remainingIsZero: response.headers.get("x-ratelimit-remaining") === "0",
  });
}
```

Do not persist token values, full error bodies, or unbounded headers. [VERIFIED: EVID-03]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manifest URLs represented as inventory only | Exact live retrieval records with body-derived digest and bounded provenance | Phase 3 first slice | Closes the black-box POC’s first executable blocker. [VERIFIED: POC report] |
| `extraction_field` token overlap could appear sufficient | Declaration-only and unverified matches remain at most partial | 2026-07-27 repository fix | The exact POC replay now reports 0 supported, 13 partial, 1 missing. [VERIFIED: `.planning/STATE.md`] |
| Generated design marked reviewed | External exact approval must be authoritative | Phase 3 required change | Prevents blueprint/build contract self-certification. [VERIFIED: PLAN-05] |
| Unversioned GitHub API assumptions | Explicit `X-GitHub-Api-Version` | Current GitHub REST contract | Keeps provider behavior reviewable and makes version drift visible. [CITED: https://docs.github.com/en/rest/about-the-rest-api/api-versions] |
| arXiv full-content harvesting | Metadata-first bounded collection | Current arXiv terms | Avoids assuming redistribution permission for e-print content. [CITED: https://info.arxiv.org/help/api/tou.html] |
| One generated OpenClaw prompt plus a tool list | Resource graph covering bootstrap files, skills, effective tool policy, plugins, memory/storage, cron, harness, loop, install, and recovery | OpenClaw reference `2026.6.11` / `29d018f0` | Phase 3 can now reject incomplete agent designs before Phase 4 generates or mutates a runtime package. [VERIFIED: `.reference-repos/openclaw` source] |
| “Memory” as one generic field | Explicit memory-slot owner plus file memory, RAG/index, corpus, database, capture/recall, retention, and restart policies | OpenClaw reference `2026.6.11` | Avoids selecting incompatible memory plugins or promising retrieval that the package never configures and tests. [VERIFIED: OpenClaw `memory-core`, `memory-lancedb`, and memory-state source] |

**Deprecated/outdated:**

- Treating `discover-pack` as live collection evidence is invalid. [VERIFIED: Stage contracts and POC]
- Treating scaffold tool declarations as executable implementation evidence is invalid. [VERIFIED: POC]
- Treating `reviewed:true` generated by blueprint drafting as human approval must be removed or made non-authoritative. [VERIFIED: PLAN-05]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A metadata-and-bounded-summary live retrieval is sufficient to close the first POC blocker without generic semantic HTML parsing. | Summary / Alternatives | The first slice may prove network execution but yield weak planning facts; gate it as mechanism evidence only. |
| A2 | Manual redirect handling plus exact allowlist validation is the correct first policy; provider adapters may require explicitly approved redirect destinations. | Architecture / Pitfalls | Some official endpoints may fail until their documented redirect target is added. |
| A3 | Streamed `maxBytes + 1` enforcement is required even when `content-length` is present. | Pitfalls | If transport semantics differ, tests must still prove bounded memory/read behavior. |
| A4 | No external HTML/XML parsing package is needed for Wave 1. | Standard Stack | GitHub/arXiv adapters may later require a vetted parser or strictly bounded provider-specific parser. |

## Open Questions

1. **What exact live manifest extension should be canonical?**
   - What we know: current `agentmo.discovery.v1` source entries lack adapter, request, count, byte, time, and content-type bounds. [VERIFIED: `src/artifact-contract.js`]
   - What's unclear: whether to add optional fields to v1 or introduce `agentmo.discovery.v2`.
   - Recommendation: introduce an explicit versioned collector block and preserve v1 local/manifest behavior; do not silently infer live execution from a URL. [ASSUMED]

2. **How should arbitrary Web HTML be normalized?**
   - What we know: the first executable blocker only requires bounded live collection; generic HTML semantic extraction is not present. [VERIFIED: POC]
   - What's unclear: whether Phase 3 must support useful HTML-to-text for every source or only exact metadata/provider adapters.
   - Recommendation: Wave 1 persists a bounded sanitized summary and digest; add a parser only after package legitimacy review and a concrete Web acceptance case. [ASSUMED]

3. **What constitutes human approval identity?**
   - What we know: AgentMo must not self-certify and Phase 2 explicitly distinguishes caller-reported decisions from independent human authority. [VERIFIED: `.planning/STATE.md`]
   - What's unclear: v1 may only prove an explicit local CLI decision, not an independently authenticated person.
   - Recommendation: label approval evidence honestly as explicit operator approval, bind exact bytes, and never claim authenticated organizational authority. [VERIFIED: existing evidence semantics]

4. **Should network address pinning be required in Wave 1?**
   - What we know: exact URL allowlisting alone does not prove the resolved socket target is public. [ASSUMED]
   - What's unclear: whether fixed provider hosts are sufficient for the initial POC or arbitrary approved Web hosts are required immediately.
   - Recommendation: if arbitrary hosts are allowed, the plan must include DNS/IP/redirect negative tests and a socket-binding strategy; otherwise Wave 1 should allow only fixed adapter-owned hosts and document the limitation. [ASSUMED]

5. **Which OpenClaw revision is the Phase 3 compatibility anchor?**
   - What we know: the authorized local reference is version `2026.6.11` at `29d018f0`, and AgentMo’s `OPENCLAW_TARGET_NODE_RANGE` exactly matches the inspected package engine range. The separate Node 20 distribution trust policy governs a producer/receipt path, not the OpenClaw target process predicate. [VERIFIED: `.reference-repos/openclaw/package.json`; `src/runtime-compatibility.js`; `scripts/node20-distribution-trust.json`]
   - What's unclear: whether the milestone must bind exactly this OpenClaw commit/version or an accepted compatibility range.
   - Recommendation: bind research provenance to `29d018f0`, make the build contract state an explicit target compatibility predicate, and require Phase 4 to fail closed on unrecognized drift rather than silently projecting onto a newer runtime. [VERIFIED: repository trust-anchor policy; OpenClaw source snapshot]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Core collector and tests | ✓ | `v24.18.0`; project floor `>=20` | Run Node 20 compatibility lane before release. [VERIFIED: environment and `package.json`] |
| npm | Full project validation | ✓ | `11.16.0` | None required for Wave 1 dependencies. [VERIFIED: environment] |
| Git | diff validation and later authorized commits | ✓ | `2.50.1` | — [VERIFIED: environment] |
| curl | Optional manual live smoke comparison only | ✓ | `8.7.1` | Node collector is authoritative; curl is not a runtime dependency. [VERIFIED: environment] |
| GitHub REST public API | GitHub adapter | Network/provider dependent | current API supports `2026-03-10` and `2022-11-28` on research date | Defer adapter; generic collector remains testable by injected transport. [CITED: https://docs.github.com/en/rest/about-the-rest-api/api-versions] |
| arXiv API | Paper adapter | Network/provider dependent | current legacy Atom API | Defer adapter; local/provider fixtures validate parsing. [CITED: https://info.arxiv.org/help/api/user-manual.html] |
| Local OpenClaw reference source | Build-contract resource mapping | ✓ read-only | `2026.6.11`, commit `29d018f0` | If absent during execution, Phase 4 must use an independently approved exact source/version, not training knowledge. [VERIFIED: local git/package inspection] |
| OpenClaw target Node runtime | Phase 4/5 install and live execution | ✓ current process satisfies inspected range | Host `v24.18.0`; inspected OpenClaw and AgentMo both require `>=22.19.0 <23 || >=23.11.0` | Phase 4 must still run the repository-owned current-process runtime check before every mutation; no caller/env override may replace the predicate. [VERIFIED: environment; OpenClaw `package.json`; `src/runtime-compatibility.js`; `AGENTS.md`] |

**Missing dependencies with no fallback:** None for Wave 1 or declarative OpenClaw contract validation. Runtime availability remains only current-process preflight evidence, not `live-success`. [VERIFIED: environment, OpenClaw engine range, and AgentMo evidence semantics]

**Missing dependencies with fallback:** Live provider availability is not guaranteed in automated tests; use injected transport fixtures and a separately labeled manual live smoke. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node `>=20` [VERIFIED: package/test suite] |
| Config file | none |
| Quick run command | `node --test test/discovery-live.test.js test/discovery-live-security.test.js` |
| Full suite command | `npm run check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | exact allowlist and count/byte/time bounds; Web/GitHub/arXiv/local adapter registry | unit + contract | `node --test test/discovery-live.test.js` | ❌ Wave 0 |
| DISC-02 | retrieval record has exact metadata/provenance/content digest | unit | `node --test test/discovery-live.test.js` | ❌ Wave 0 |
| DISC-03 | evidence class and declared trust remain separate | unit | `node --test test/discovery-live.test.js` | ❌ Wave 0 |
| DISC-04 | path/type/size/untrusted/secret/redirect failures publish no unsafe success artifact | security | `node --test test/discovery-live-security.test.js` | ❌ Wave 0 |
| DISC-05 | mechanical dedup/freshness/conflict/gap report never claims semantic proof | unit + snapshot assertions | `node --test test/discovery-live.test.js test/design-plan.test.js` | ❌ Wave 0 / ✅ existing Plan tests |
| DISC-06 | stale manifest or DB invalidates discovery approval and blocks Plan | contract | `node --test test/discovery-approval.test.js` | ❌ Wave 0 |
| PLAN-01 | Plan resumes from independently admitted approved DB | integration | `node --test test/phase3-contracts.test.js` | ❌ Wave 0 |
| PLAN-02 | ledger entry kinds and transcript rejection | unit + security | `node --test test/decision-ledger.test.js test/persistability.test.js` | ❌ Wave 0 / ✅ persistence |
| PLAN-03 | bidirectional trace graph has referential closure | unit | `node --test test/build-contract.test.js` | ❌ Wave 0 |
| PLAN-04 | feasibility/permission/trust/unsupported/alternative fields are mandatory | unit | `node --test test/build-contract.test.js` | ❌ Wave 0 |
| PLAN-05 | stale blueprint or build contract invalidates final approval | contract | `node --test test/build-contract.test.js test/phase3-contracts.test.js` | ❌ Wave 0 |

The PLAN-04 row must include an OpenClaw resource-completeness matrix, not merely generic feasibility strings. The test should require prompt, skills, tools, plugins, memory, RAG, storage, schedules, harness, loop, runtime binding, permissions, install, recovery, and evidence sections; each required capability must have exactly one owner and a Phase 3/4/5 lifecycle assignment. [VERIFIED: OpenClaw resource map above]

### Exact Focused Commands

```bash
# Wave 1 live collector
node --test test/discovery-live.test.js test/discovery-live-security.test.js

# Stage 1 regression
node --test test/discovery-db.test.js test/discovery-source-workspace.test.js test/stage-contracts.test.js

# Approval / Plan / build-contract closure
node --test test/discovery-approval.test.js test/decision-ledger.test.js test/build-contract.test.js test/openclaw-build-contract.test.js test/openclaw-resource-projection.test.js test/phase3-contracts.test.js

# Required Stage 2 contract set from docs/MVP_RUNBOOK.md
node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js

# Artifact and durable-surface closure after new identities/commands
node --test test/artifact-admission.test.js test/artifact-contract.test.js test/artifact-subjects.test.js test/artifact-surface-coverage.test.js test/persistability.test.js test/command-docs.test.js

# Phase gate
npm run check
git diff --check
```

### Sampling Rate

- **Per task commit:** the task’s focused test file plus `git diff --check`. [VERIFIED: AGENTS validation policy]
- **Per wave merge:** Stage 1 or Stage 2 contract set appropriate to the wave. [VERIFIED: runbook]
- **Phase gate:** full `npm run check`, `git diff --check`, a separately labeled bounded live smoke, and exact approval replay before `$gsd-verify-work`. [VERIFIED: project evidence semantics]

### Wave 0 Gaps

- [ ] `test/discovery-live.test.js` — happy path, canonical record, byte/time/count/content type, deterministic transport
- [ ] `test/discovery-live-security.test.js` — redirect, credential URL, non-HTTPS, private target, rate limit, secret-shaped body, raw payload non-persistence, zero publication
- [ ] `test/discovery-approval.test.js` — exact manifest+DB binding and stale/tampered rejection
- [ ] `test/decision-ledger.test.js` — typed entries, append-only references, transcript/secret rejection
- [ ] `test/build-contract.test.js` — feasibility, permissions, unsupported behavior, traces, blueprint binding
- [ ] `test/openclaw-build-contract.test.js` — mandatory resource sections, stable identities, single ownership, exact source revision/runtime predicate, no secret values, and Phase 3/4/5 lifecycle assignments
- [ ] `test/openclaw-resource-projection.test.js` — every required resource projects to a generated file, config/install/schedule operation, unsupported record, or runtime evidence obligation; no silently dropped prompt/skill/tool/plugin/memory/RAG/storage/cron/harness/loop/recovery capability
- [ ] `test/phase3-contracts.test.js` — public CLI sequence from live discovery through final approval with no Phase 4 mutation
- [ ] Add new durable subjects/commands to artifact registry, subject map, package file list, CLI help, command docs inventory, and I/O surface inventory. [VERIFIED: existing closure tests]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no for public Wave 1; later optional provider auth | No credential input in first slice; future tokens only via runtime `SecretRef`, never durable artifacts. [VERIFIED: EVID-03] |
| V3 Session Management | no | Collection is one bounded CLI operation with portable artifacts, not a web session. [VERIFIED: proposed architecture] |
| V4 Access Control | yes | Exact manifest allowlist and exact approval artifacts gate source access and Plan transition. [VERIFIED: DISC-01/06] |
| V5 Input Validation | yes | URL/scheme/credentials/redirect/content-type/size/time/count/status validation plus existing artifact/persistability gates. [VERIFIED: DISC-04] |
| V6 Cryptography | yes | Node `crypto` SHA-256 for raw content and artifact bindings; never hand-roll cryptography. [VERIFIED: repository digest standard] |
| V10 Malicious Code | yes | Treat all retrieved content as untrusted data; do not execute scripts, HTML, XML entities, or provider instructions. [VERIFIED: untrusted-input boundary] |
| V12 Files and Resources | yes | Whole-set preflight, bounded stream reads, atomic publication, and no path-derived live output. [VERIFIED: current workspace safety architecture] |
| V13 API and Web Service | yes | Serial requests, timeouts, response/status/header bounds, provider rate-limit handling, explicit API versions. [CITED: GitHub official docs] |

### Known Threat Patterns for the Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Allowlist/redirect SSRF | Spoofing / Information Disclosure | Exact HTTPS allowlist, no URL credentials, manual bounded redirects, validate each destination, fixed provider adapters or socket-bound public-address policy. [ASSUMED] |
| DNS rebinding/private address resolution | Spoofing | Do not treat hostname syntax alone as network authority; either fixed adapters or validated address binding with hostile tests. [ASSUMED] |
| Oversized/chunked response | Denial of Service | Count streamed bytes independent of headers and abort at `maxBytes + 1`. [ASSUMED] |
| Slow response | Denial of Service | Per-source and aggregate deadlines via abort signals; serial request budget. [CITED: Node AbortSignal docs] |
| Malicious HTML/JSON/XML instructions | Tampering | Data-only decode, no script execution, no instruction following, bounded sanitize/redact before persistence. [VERIFIED: untrusted-input boundary] |
| Credential or private payload persistence | Information Disclosure | No auth in Wave 1; existing persistability gate; bounded failure metadata only. [VERIFIED: EVID-03] |
| Stale approval replay | Elevation of Privilege | Approval binds exact raw-byte digests and is independently admitted at the transition. [VERIFIED: DISC-06/PLAN-05] |
| Artifact self-certification | Elevation of Privilege | Recompute identities/digests; never trust internal `ok`, `reviewed`, or coverage labels as authority. [VERIFIED: Phase 1.1 evidence model] |
| Rate-limit abuse | Denial of Service | Serial requests; stop on `403`/`429`; honor retry metadata without automatic unbounded retry. [CITED: GitHub official best practices] |
| arXiv copyright overreach | Repudiation / legal risk | Persist CC0 descriptive metadata and links; do not redistribute full e-prints without license/permission. [CITED: arXiv API terms] |
| Plugin supply-chain or manifest drift | Tampering / Elevation of Privilege | Bind exact source/manifest/version, use the correct OpenClaw install lane and security scan, inspect activation registry, and fail closed on host-version or digest drift. [VERIFIED: OpenClaw plugin installer/loader source] |
| Tool guidance mistaken for authority | Elevation of Privilege | Treat `TOOLS.md` as prompt guidance only; verify the effective tool inventory after the complete policy pipeline and trusted-plugin policies. [VERIFIED: OpenClaw tool construction/policy source] |
| Competing memory providers | Tampering / Denial of Service | Select exactly one memory-slot owner and validate its database/corpus/tool contract before install. [VERIFIED: OpenClaw plugin memory-state/config policy] |
| Cron mutation during generation | Elevation of Privilege | Generate an exact schedule plan in Phase 4 and apply it only through explicit approved mutation; prove job identity, delivery, idempotency, and restart continuity in Phase 5. [VERIFIED: OpenClaw cron service/store source] |
| Runtime-version drift | Tampering / Repudiation | Bind the inspected source revision/version and Node predicate; Phase 4 rechecks before mutation and records the observed runtime in its receipt. [VERIFIED: OpenClaw package and AgentMo runtime trust policy] |

## Recommended Executable Wave Plan

### Wave 1 — Close the Black-Box POC Blocker

Implement the explicit live collector contract, injected bounded transport, canonical retrieval record, whole-set fail-closed publication, public `discover-live` command, CLI/help/package/I/O inventory coverage, and deterministic positive/negative tests. [VERIFIED: blocker and existing architecture]

**Exit evidence:** one separately labeled live retrieval produces a DB with at least one `source_chunk` whose record includes requested/final canonical URL, retrieval time, sanitized summary, raw-byte content digest, provider provenance, evidence class, confidence rationale, and bounds; rerunning with a hostile redirect/oversize/secret result yields no successful artifact set. [VERIFIED: DISC-01/02/04]

### Wave 2 — Provider and Discovery Semantics

Add Web, GitHub REST, arXiv Atom, and normalized local adapters; provider policy/version/rate metadata; mechanical dedup/freshness/conflict candidates/gaps; and explicit non-semantic coverage labels. [CITED: provider docs] [VERIFIED: DISC-03/05]

### Wave 3 — Discovery Approval Gate

Create/register/validate `agentmo.discovery-approval.v1`, public preview/approve flow, exact three-artifact admission at `design-plan`, stale/tampered tests, and docs. [VERIFIED: DISC-06]

### Wave 4 — Durable Human Planning State

Create `agentmo.decision-ledger.v1`, typed entries, predecessor binding, bidirectional source/requirement/capability/eval trace, persistent resumption, and transcript/secret negative tests. [VERIFIED: PLAN-01/02/03]

### Wave 5 — Build Contract and Final Approval

Add the complete OpenClaw resource graph from the source-grounded map: prompt/bootstrap surfaces, skills, effective tools/policy, plugins/install lanes, memory-slot/RAG/storage ownership, schedules, harness, loop/runtime binding, permissions/trust boundaries, install/load/execute transitions, recovery, and evidence obligations. Generate `agentmo.build-contract.v1`, correct blueprint `reviewed` semantics, create `agentmo.plan-approval.v1`, and prove resource omission plus stale blueprint/build-contract rejection. [VERIFIED: PLAN-04/05; `.reference-repos/openclaw` @ `29d018f0`]

### Wave 6 — Composed Phase Gate

Run the exact Stage 1/Stage 2/artifact/full commands, replay the black-box POC through approved build contract, update runbook/stage contracts/README/ledger/release record, and preserve non-certification language. [VERIFIED: AGENTS and phase success criteria]

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` — repository scope, safety, validation, release, and evidence constraints.
- `.planning/ROADMAP.md` — Phase 3 goal, boundaries, success criteria, and later-phase separation.
- `.planning/REQUIREMENTS.md` — DISC-01..06 and PLAN-01..05.
- `.planning/STATE.md` — current POC status and Stage 2 semantic remediation.
- `docs/MVP_RUNBOOK.md`, `docs/STAGE_CONTRACTS.md` — current command and artifact contracts.
- `src/cli.js`, `src/discovery-db.js`, `src/discovery-source-workspace.js`, `src/design-plan.js`, `src/blueprint-draft.js`, `src/persistability.js` — live code architecture and gaps.
- `/private/tmp/agentmo-entry-retest.mthIiG/INCREMENTAL_POC_REPORT.md` — black-box blocker evidence.
- `/private/tmp/agentmo-plan-retest.bPb3Sp/agentmo-design-plan.json` — exact post-fix Plan output.
- `.reference-repos/openclaw/package.json`, git commit `29d018f0` — inspected OpenClaw version and Node compatibility predicate.
- `.reference-repos/openclaw/src/agents/system-prompt.ts`, `src/skills/loading/*`, `src/agents/agent-tools.ts`, `src/agents/tool-policy-pipeline.ts` — prompt, workspace context, skills, tools, and policy construction.
- `.reference-repos/openclaw/src/plugins/manifest-registry.ts`, `src/plugins/loader.ts`, `src/plugins/install.ts`, `src/plugins/install-security-scan.ts`, `src/plugins/memory-state.ts` — plugin discovery/install/load/security and memory-slot ownership.
- `.reference-repos/openclaw/extensions/memory-core`, `extensions/memory-lancedb`, `src/agents/memory-search.ts`, `src/state`, `src/agents/auth-profiles/sqlite.ts` — memory/RAG/vector search and shared/per-agent/dedicated storage mechanisms.
- `.reference-repos/openclaw/src/cron`, `src/agents/harness/selection.ts`, `src/agents/embedded-agent-runner`, `src/config/sessions/store.ts` — scheduling, harness/agent loop, session persistence, compaction, and recovery.

### Secondary (MEDIUM confidence)

- https://nodejs.org/download/release/latest-v20.x/docs/api/globals.html — Node 20 fetch and abort APIs.
- https://docs.github.com/en/rest/about-the-rest-api/api-versions — current REST versions and header contract.
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — current primary/rate-limit behavior.
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api — serial requests, redirects, conditional requests, and error handling.
- https://docs.github.com/en/rest/repos/contents — repository content API media and size behavior.
- https://info.arxiv.org/help/api/user-manual.html — query, paging, Atom response, and request pacing.
- https://info.arxiv.org/help/api/tou.html — rate limits, metadata licensing, and content redistribution boundary.

### Tertiary (LOW confidence)

- Assumptions A1–A4 above require implementation-time confirmation through tests and, where applicable, user decision.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — Node core and repository primitives are directly observed; provider APIs are official-doc cited.
- Architecture: HIGH — the first slice follows existing Stage 1 seams, and the build-contract map is grounded in the authorized local OpenClaw source at an exact commit.
- Pitfalls: MEDIUM — repository persistence threats are verified; network SSRF/stream/redirect recommendations require implementation tests.
- Provider policy: MEDIUM — official sources were checked, but APIs are time-sensitive.

**Research date:** 2026-07-27
**Valid until:** 2026-08-03 for GitHub/arXiv policy; repository architecture remains valid until relevant source contracts change.
