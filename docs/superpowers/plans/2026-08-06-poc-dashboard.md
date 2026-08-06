# AgentMo POC Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-command, secret-safe, isolated OpenClaw Dashboard entry that opens the generated Agent with its bound DeepSeek model.

**Architecture:** Extend the existing POC CLI with a `dashboard` action and add Dashboard lifecycle helpers beside the existing one-shot OpenClaw runtime. Reuse runtime-env allowlisting, plugin/provider setup, isolated profile HOME, and Agent registration; add explicit model-catalog registration, loopback port admission, token-authenticated foreground Gateway execution, and an exact Agent session URL.

**Tech Stack:** Node.js ESM, `node:test`, OpenClaw CLI 2026.7.1-2, existing AgentMo runtime-env and secret-redaction modules.

## Global Constraints

- Work only in `/private/tmp/agentmo-poc-openclaw-builder` on `codex/poc-openclaw-builder`.
- Do not read, print, summarize, or persist `.env` values.
- Do not mutate the default `~/.openclaw`, stop port `18789`, use `--force`, activate schedules, or deliver messages.
- Default Dashboard port is `18889`; admitted override range is `1024..65535`.
- Do not commit until the user explicitly authorizes a commit.

---

### Task 1: Dashboard contract and command construction

**Files:**
- Modify: `test/poc-openclaw-runtime.test.js`
- Modify: `src/poc-openclaw-runtime.js`

**Interfaces:**
- Produces: `buildPocDashboardCommands(options)` returning setup commands plus a foreground Gateway command.
- Produces: `buildPocDashboardUrl({ agentId, port })` returning the exact token-free Agent session URL.
- Consumes: existing `buildIsolatedEnvironment`, DeepSeek validation, and OpenClaw setup conventions.

- [x] **Step 1: Write failing construction tests**

Assert that the generated setup includes plugin trust/install, provider SecretRef, a non-empty DeepSeek model catalog, Agent registration, and `gateway run --port 18889 --bind loopback --auth token --allow-unconfigured`, with no `--force`. Assert the URL equals `http://127.0.0.1:18889/chat?session=agent%3Awhite-collar-research-poc%3Amain`.

- [x] **Step 2: Run the focused test and verify RED**

```bash
node --test test/poc-openclaw-runtime.test.js
```

Expected: failure because the Dashboard exports do not exist.

- [x] **Step 3: Implement minimal command construction**

Add the two exports, strict port validation, token-only child environment handling, model-catalog registration for the exact requested DeepSeek model, and a Gateway command that is foreground, loopback-only, and never forceful.

- [x] **Step 4: Run the focused test and verify GREEN**

```bash
node --test test/poc-openclaw-runtime.test.js
```

Expected: all focused runtime tests pass.

### Task 2: Foreground lifecycle, redaction, and stable failures

**Files:**
- Modify: `test/poc-openclaw-runtime.test.js`
- Modify: `src/poc-openclaw-runtime.js`

**Interfaces:**
- Produces: `runPocOpenClawDashboard(options)` resolving only after the Gateway exits.
- Consumes: `checkPocWorkspace`, `resolveRuntimeEnv`, existing idempotent plugin/Agent result predicates, and injected command/lifecycle seams.

- [x] **Step 1: Write failing lifecycle tests**

Cover ordered setup, idempotent plugin/Agent reuse, occupied-port fail-closed behavior, token/value redaction, public preflight metadata without secrets, foreground Gateway exit propagation, and signal forwarding through an injected lifecycle seam.

- [x] **Step 2: Run the focused test and verify RED**

```bash
node --test test/poc-openclaw-runtime.test.js
```

Expected: lifecycle tests fail because `runPocOpenClawDashboard` is absent.

- [x] **Step 3: Implement the bounded lifecycle**

Load the runtime env through the existing allowlist, create the isolated HOME, test the loopback port before setup, generate an in-memory token, execute idempotent setup, emit token-free readiness metadata, spawn the Gateway without captured secret-bearing output, forward `SIGINT`/`SIGTERM`, and map failures to stable `AGENTMO_POC_DASHBOARD_*` codes.

- [x] **Step 4: Run the focused test and verify GREEN**

```bash
node --test test/poc-openclaw-runtime.test.js
```

Expected: all runtime tests pass without leaked canaries.

### Task 3: Public CLI, help, docs, and regression gate

**Files:**
- Modify: `test/poc-cli.test.js`
- Modify: `src/poc-cli.js`
- Modify: `src/cli.js`
- Modify: `README.md`
- Modify: `release/2026.08.06.md`

**Interfaces:**
- Adds: `agentmo poc dashboard <workspace> --profile <profile> --model deepseek/<model> --runtime-env-file <path> [--port <port>] [--json]`.
- Consumes: `runPocOpenClawDashboard(options)`.

- [x] **Step 1: Write failing CLI tests**

Assert accepted/default port parsing, invalid port/profile/model rejection, documented help, and bounded JSON/text readiness output that excludes environment values and auth tokens.

- [x] **Step 2: Run the focused CLI tests and verify RED**

```bash
node --test test/poc-cli.test.js
```

Expected: dashboard requests are rejected before implementation.

- [x] **Step 3: Wire the command and maintenance docs**

Parse the closed option set, call the runtime helper, document the single command and exact isolation boundary in README, and record commands/status/remaining risk in the existing 2026-08-06 release record without raw logs or secrets.

- [ ] **Step 4: Run focused and aggregate verification**

```bash
node --test test/poc-openclaw-runtime.test.js test/poc-cli.test.js
npm run check
git diff --check
```

Expected: all tests pass and diff-check exits 0.

Focused POC, discovery-transport, and exact I/O inventory verification passed
68/68 with `git diff --check` exit 0. The required repository-wide aggregate
attempt was not green and was stopped after unrelated Phase 4 native
fault-injection failures and an extended no-output interval; no aggregate-green
claim is made for this worktree.

- [x] **Step 5: Run bounded local smoke**

Use the accepted POC workspace, isolated profile, and runtime-env file through `agentmo poc dashboard` on an unused loopback port. Confirm the readiness URL targets `white-collar-research-poc`, the OpenClaw Agent inventory shows `deepseek/deepseek-v4-flash`, and no schedule/delivery/default-profile mutation occurs. Stop the foreground Gateway after verification.
