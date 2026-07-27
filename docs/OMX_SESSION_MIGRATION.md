# AgentMo OMX Session Migration Handoff

Date: 2026-07-23
Purpose: reset Codex/OMX context after the Phase 02 local release gate and prepare a user-authorized Agent POC without mixing in `pi`, Win9, OpenClaw, or AgentHarness implementation work.
Mode: current durable recovery anchor. Sections explicitly marked historical are context only and do not override this header or Sections 1–3.

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
- AGENTS.md
- docs/OMX_SESSION_MIGRATION.md
- release/README.md
- release/2026.07.23.md
- release/2026.07.21.md
- release/2026.07.20.md
- README.md
- docs/MVP_RUNBOOK.md
- docs/AGENT_BIRTH_GATE.md
- docs/AGENTMO_MVP_LEDGER.md

然后只做恢复和 POC 准备：
1. 确认 `pwd` 是包含 `AGENTS.md` 与 `package.json` 的 AgentMo 仓库根目录。
2. 确认 git status、branch、HEAD。
3. 审查当前未提交 diff 的范围。
4. 阅读 `.planning/phases/02-codex-builder/02-FINAL-RELEASE-REVIEW.md` 与 `.planning/phases/02-codex-builder/02-RELEASE-GATE-ADJUDICATION.md`；保留历史 review reports，不要改历史 CONTEXT/RESEARCH/02-24 reports，也不要改 ROADMAP/STATE/REQUIREMENTS。
5. 核对 Builder v1 contract：无 physical delete；deactivate 追加 tombstone；reactivate/upgrade 追加 immutable successor；uninstall 只是隐藏 deprecated non-delete alias；purge、selector removal、canonical replacement 全部拒绝。
6. 核对 formal UAT contract：start/record/scenario-arm/terminal/inspect/resume/continue；behavior 绑定 exact journal head + candidate；preview 只读；decide 只 caller-reported/nonterminal，因为没有 independent external human decision authority。
7. 不要重跑 aggregate gate，除非源码或测试又变更。不要运行 real UAT，除非用户明确给出 POC brief 并授权；不要把 11/11、synthetic tests 或 caller decision 当成 domain/production certification。
8. 不要 commit，除非我明确要求。

用中文回复。
```

## 2. Current project facts

Project:

```text
$AGENTMO_REPO
```

Current branch and HEAD must be read from the live repository. Do not trust a stored hash in this handoff.

Current important state:

```text
Historical Phase 02 reviews recorded Critical and Warning findings; retain those reports as evidence.
The in-scope repair and local release gate are complete in a still-dirty, uncommitted worktree.
The final aggregate gate passed 760 tests with 0 failures and 1 skip; the fresh independent final review records Critical 0 and Warning 0.
No real Codex/OpenClaw UAT, external human decision, domain-quality certification, production approval, tag, package publication, or GitHub Release has occurred.
```

Focused checkpoints recorded during this iteration:

```text
node --test test/builder-codex-uat.test.js: passed, 27/27
node --test test/builder-immutable-journal-v1.test.js: passed, 4/4
node --test test/artifact-surface-coverage.test.js: passed, 17/17
npm run check: passed, 760 pass, 0 fail, 1 skip
git diff --check: passed
```

Release/publication state:

```text
`release/2026.07.23.md` is the current value-blind status record.
The local mechanism gate is ready for a user-authorized POC, but no commit, tag, or release has been created.
No commit, tag, GitHub Release, npm package publication, production deployment, real UAT, or external human decision is implied.
```

## 3. Current objective for the new session

Current objective:

```text
Accept a user POC brief and use the passed local Builder mechanism to construct one bounded Agent package. Preserve append-only authority and immutable evidence, remain inside AgentMo, and do not read secrets.
```

Stop condition:

```text
Stop when the new session has:
1. confirmed it is operating only in AgentMo;
2. reviewed the current dirty files without reverting concurrent work;
3. confirmed the final release-gate evidence and its scope boundary;
4. received an explicit POC brief before initiating any real host UAT;
5. reported the bounded result and remaining risks;
6. made no external publication or commit unless explicitly instructed.
```

## 4. Archived 2026-07-10 recovery story (historical only)

The G001–G004 material below records the earlier Stage 2 handoff. Do not execute its stored commands or treat its hashes, test counts, dirty-file list, or commit-readiness wording as current. Sections 1–3 and `release/2026.07.23.md` are authoritative for the active recovery.

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

## 5. Archived 2026-07-10 working-tree categories

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

13. Builder v1 performs no physical deletion. Deactivation appends a tombstone; reactivation and upgrade append immutable successors. Old receipts, releases, projected bytes, host evidence, and UAT evidence remain immutable and inert.

14. `uninstall` is a hidden deprecated non-delete alias only. Purge, selector removal, host projection replacement, canonical receipt replacement, and `--remove-host-selector` remain unsupported.

15. A projected-v2 canonical receipt must not be overwritten by an activated-v4 setup receipt. Preserve genesis and use an immutable version-qualified lifecycle successor.

16. Formal UAT uses immutable journal/head/candidate bindings. Verifier decisions are caller-reported and nonterminal; no independent external human decision authority is currently implemented.

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

If context becomes confusing again, stop and read Sections 1–3 of this file, `release/README.md`, and `release/2026.07.22.md` first. The archived 2026-07-10 sections are historical context only.
