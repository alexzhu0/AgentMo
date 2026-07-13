# AgentMo OMX Session Migration Handoff

Date: 2026-07-10
Purpose: reset Codex/OMX context and continue AgentMo Stage 2 design-plan / contributor-handoff work without mixing in `pi`, Win9, OpenClaw, or AgentHarness implementation work.
Mode: Ultragoal-style durable handoff artifact.

## 1. Copy-paste prompt for the new session

Start a fresh terminal session:

```bash
export AGENTMO_REPO="<path-to-AgentMo>"
cd "$AGENTMO_REPO"
omx --madmax --xhigh
```

Then paste this as the first message:

```text
我们现在只在 AgentMo 仓库根目录（`$AGENTMO_REPO`）工作。

不要读取或修改 sibling project `../pi`。
不要读取或修改 sibling project `../AgentHarness`。
不要读取或修改 sibling project `../openclaw`。
除非我明确要求，AgentHarness/openclaw 只能作为概念背景使用 AgentMo 仓库内已有文档。
不要读取 .env，不要打印任何密钥。

请先读取：
- docs/OMX_SESSION_MIGRATION.md
- release/README.md
- release/2026.07.03.md
- release/2026.07.05.md
- release/2026.07.06.md
- release/2026.07.07.md
- release/2026.07.10.md
- CONTRIBUTING.md
- docs/MVP_RUNBOOK.md
- docs/AGENT_BIRTH_GATE.md
- docs/AGENTMO_MVP_LEDGER.md

然后只做恢复和审查：
1. 确认 `pwd` 是包含 `AGENTS.md` 与 `package.json` 的 AgentMo 仓库根目录。
2. 确认 git status、branch、HEAD。
3. 审查当前未提交 diff 的范围。
4. 运行 npm run check 和 git diff --check。
5. 检查 Stage 2 design-plan、CONTRIBUTING、release/ 和 MVP runbook 文档是否准确。
6. 不要 commit，除非我明确要求。

用中文回复。
```

## 2. Current project facts

Project:

```text
$AGENTMO_REPO
```

Current branch:

```text
main
```

Current committed HEAD at the time of this handoff refresh:

```text
f5dd4ea
```

Current important state:

```text
Stage 2 design-plan contract is implemented in the working tree.
Contributor onboarding docs are being added for external programmers.
The implementation is verified locally.
The implementation is not committed yet.
Git status is intentionally dirty with source, tests, docs, and release records.
```

Latest local verification observed before this handoff refresh:

```text
node --test test/design-plan.test.js: passed, 9/9 tests
node --test test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js: passed, 40/40 tests
npm run check: passed, 199/199 tests
git diff --check: passed
```

Release/publication state:

```text
Local code/docs are commit-ready after verification.
No commit has been created for the Stage 2 design-plan work in this handoff.
No tag, GitHub Release, npm package publication, or production deployment is implied.
release/2026.07.10.md is a local date-based release record for future release body use.
```

## 3. Current objective for the new session

Stable aggregate objective:

```text
Complete AgentMo Stage 2 design-plan and contributor-handoff stabilization: recover context from repo artifacts, audit the current uncommitted source/tests/docs/release diff, verify tests and evidence gates, and prepare a clean commit-ready summary without touching sibling projects or reading secrets.
```

Stop condition:

```text
Stop when the new session has:
1. confirmed it is operating only in AgentMo;
2. reviewed current dirty files;
3. verified npm run check and git diff --check;
4. reviewed README, CONTRIBUTING, AGENTS, release/, MVP runbook, and stage contracts;
5. reported remaining risks and whether the work is commit-ready;
6. made no commit unless explicitly instructed.
```

## 4. Suggested recovery story breakdown

### G001 — Context recovery

Objective:

```text
Read this handoff, release history, contributor docs, MVP docs, and current git status to reconstruct AgentMo context without using old chat memory.
```

Required commands:

```bash
pwd
git status --short
git rev-parse --short HEAD
git branch --show-current
```

Acceptance:

- `pwd` resolves to the AgentMo repository root containing `AGENTS.md` and `package.json`.
- HEAD is `f5dd4ea` unless the user has committed after this document was refreshed.
- The session explicitly states it will not touch `pi`, AgentHarness, or OpenClaw without instruction.

### G002 — Working tree audit

Objective:

```text
Classify the current uncommitted AgentMo diff into product behavior, tests, contributor docs, release records, and safety-sensitive files.
```

Suggested read targets:

```text
CONTRIBUTING.md
README.md
AGENTS.md
package.json
src/cli.js
src/design-plan.js
src/source-refs.js
src/blueprint-draft.js
src/user-need.js
test/design-plan.test.js
test/blueprint-draft.test.js
test/cli-mvp.test.js
test/stage-contracts.test.js
test/user-need.test.js
docs/STAGE_CONTRACTS.md
docs/MVP_RUNBOOK.md
docs/AGENTMO_MVP_LEDGER.md
release/README.md
release/2026.07.10.md
```

Do not read:

```text
.env
private keys
credential stores
raw logs likely to contain secrets
```

Acceptance:

- The audit explains what changed and why.
- The audit identifies whether any unrelated file appears in the AgentMo diff.
- The audit does not include secret values.

### G003 — Verification gate

Objective:

```text
Re-run the repository checks and confirm the Stage 2 design-plan path and MVP composition remain valid.
```

Required commands:

```bash
node --test test/design-plan.test.js
node --test test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
npm run check
git diff --check
```

Optional declared vertical slice:

```bash
node ./bin/agentmo.js runtime-check --target openclaw
WORK=/tmp/agentmo-session-migration-support-triage
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
node ./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
node ./bin/agentmo.js design-plan "$WORK/discovery/agentmo-discovery-db.json" --need examples/support-triage.need.json --out "$WORK/agentmo-design-plan.json" --target openclaw --json --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")"
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" --need examples/support-triage.need.json --design-plan "$WORK/agentmo-design-plan.json" --out "$WORK/support-triage.agentmo.json" --target openclaw --json --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")" --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")"
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold" --force --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js run-plan "$WORK/support-triage.agentmo.json" --target openclaw --workspace "$WORK/scaffold/openclaw/workspace" --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" > "$WORK/runtime-plan.json"
node ./bin/agentmo.js run "$WORK/runtime-plan.json" --workspace "$WORK/scaffold/openclaw/workspace" --message "Say exactly: ok" --out "$WORK/run" --json --digest "runtime-plan=$(digest_file "$WORK/runtime-plan.json")"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json --digest "run-state=$(digest_file "$RUN_STATE")" > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" --build-state "$WORK/scaffold/agentmo-build-state.json" --run-state "$RUN_STATE" --run-eval "$WORK/run-eval.json" --expect-status declared --json --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" --digest "run-state=$(digest_file "$RUN_STATE")" --digest "run-eval=$(digest_file "$WORK/run-eval.json")"
```

Acceptance:

- `node --test test/design-plan.test.js` passes.
- Stage 2/contract targeted tests pass.
- `npm run check` passes.
- `git diff --check` passes.
- If optional vertical slice is run, `birth-report.ok` is true and `birthStatus` is `declared-ready`.

### G004 — Commit readiness report

Objective:

```text
Prepare a concise commit-readiness report, but do not commit unless the user explicitly asks.
```

Report must include:

- changed file categories;
- verification commands and results;
- contributor docs status;
- release docs status;
- secret handling status;
- remaining risks;
- recommended commit scope.

Acceptance:

- No commit is created.
- No external project files are touched.
- The user can decide whether to commit AgentMo.

## 5. Current working-tree categories

The current dirty tree is expected to include these categories.

### Product behavior

```text
src/design-plan.js
src/source-refs.js
src/blueprint-draft.js
src/cli.js
src/user-need.js
package.json
```

### Tests

```text
test/design-plan.test.js
test/blueprint-draft.test.js
test/cli-mvp.test.js
test/stage-contracts.test.js
test/user-need.test.js
```

### Maintenance and contributor docs

```text
CONTRIBUTING.md
AGENTS.md
README.md
docs/OMX_SESSION_MIGRATION.md
docs/STAGE_CONTRACTS.md
docs/MVP_RUNBOOK.md
docs/AGENTMO_MVP_LEDGER.md
```

### Release records

```text
release/README.md
release/2026.07.10.md
```

## 6. Architecture invariants to preserve

1. AgentMo is a three-stage agent-building mechanism:

   ```text
   Discover -> Plan -> Produce
   ```

   Stage 2 should remain visible as `agentmo.design-plan.v1` before blueprint drafting when using the recommended AgentMo-generated path.

2. AgentMo is not a prompt generator and not a hidden LLM generator.

3. Declared evidence is not runtime promotion evidence.

4. Live-success evidence is not domain certification.

5. Runtime identity fields must remain separate:

   ```text
   provider, model, thinking, runtime, channel, transport, fallback, selector, workspace, sandbox, env
   ```

6. Durable AgentMo evidence must not store:

   ```text
   credential values, raw transcripts, raw tool bodies, production runtime state, raw stdout/stderr previews for birth evidence
   ```

7. `birth-report` is fail-closed and must not self-certify runtime/domain readiness.

8. `observe-run` is proposal-only and must not mutate blueprint/scaffold/runtime.

9. OpenClaw is an active alternate architecture/runtime profile; it is not automatically Pi parity.

10. AgentHarness is currently an inspiration/governance reference, not a stable integrated dependency.

11. Legacy artifact migration is the one explicit retained-handle filesystem path. Preview and apply independently bind source bytes through retained parent/file handles; publication, verification, staging recovery, truncate/write, and cleanup continue through retained handles rather than re-resolving an attacker-replaceable pathname. Candidate payload, receipt, and marker bytes must pass preflight before output handles open. This exception does not relax canonical artifact loaders or writers.

12. AgentMo core remains Node.js `>=20`; OpenClaw target mutation separately requires `>=22.19.0 <23 || >=23.11.0` and must use `node ./bin/agentmo.js runtime-check --target openclaw` before effects. This preflight is compatibility evidence only.

## 7. What not to do in the new session

Do not:

- read `.env`;
- print secret values;
- modify sibling project `../pi`;
- modify sibling project `../AgentHarness`;
- modify sibling project `../openclaw`;
- run destructive git commands;
- run `git add .`;
- commit without explicit user request;
- claim production readiness from declared evidence;
- claim runtime/domain certification from live smoke alone.

## 8. If the user asks to commit later

Before committing:

```bash
git status --short
npm run check
git diff --check
```

Then stage explicit AgentMo paths only. Never use:

```bash
git add .
git add -A
```

Suggested commit intent and trailers:

```text
Make Stage 2 planning auditable before blueprint drafting

Constraint: Preserve three-stage artifact decoupling and keep the old blueprint-draft DB+need path compatible.
Rejected: Hiding Stage 2 inside blueprint-draft only | It would keep planning rationale implicit and hard to review.
Confidence: high
Scope-risk: moderate
Directive: Keep design-plan as a planning contract; do not let it certify runtime, domain-wide quality, or production approval.
Tested: node --test test/design-plan.test.js; node --test test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js; npm run check; git diff --check
Not-tested: GitHub release publication/tagging was not performed.
```

## 9. Final note for future sessions

If context becomes confusing again, stop and read this file first. It is the canonical local handoff for resetting the AgentMo session.
