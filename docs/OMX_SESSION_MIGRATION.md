# AgentMo OMX Session Migration Handoff

Date: 2026-07-07
Purpose: reset Codex/OMX context and continue AgentMo work without mixing in `pi`, Win9, OpenClaw, or AgentHarness implementation work.
Mode: Ultragoal-style durable handoff artifact.

## 1. Copy-paste prompt for the new session

Start a fresh terminal session:

```bash
cd /home/alex/DTAlex/learningGitHub/AgentMo
omx --madmax --xhigh
```

Then paste this as the first message:

```text
我们现在只在 /home/alex/DTAlex/learningGitHub/AgentMo 项目里工作。

不要读取或修改 /home/alex/DTAlex/learningGitHub/pi。
不要读取或修改 /home/alex/DTAlex/learningGitHub/AgentHarness。
不要读取或修改 /home/alex/DTAlex/learningGitHub/openclaw。
除非我明确要求，AgentHarness/openclaw 只能作为概念背景使用 AgentMo 仓库内已有文档。
不要读取 .env，不要打印任何密钥。

请先读取：
- docs/OMX_SESSION_MIGRATION.md
- release/README.md
- release/2026.07.03.md
- release/2026.07.05.md
- release/2026.07.06.md
- release/2026.07.07.md
- docs/MVP_RUNBOOK.md
- docs/AGENT_BIRTH_GATE.md
- docs/AGENTMO_MVP_LEDGER.md

然后只做恢复和审查：
1. 确认 pwd 是 /home/alex/DTAlex/learningGitHub/AgentMo。
2. 确认 git status、branch、HEAD。
3. 审查当前未提交 diff 的范围。
4. 运行 npm run check 和 git diff --check。
5. 检查新增 release/ 文档和 MVP birth-loop 文档是否准确。
6. 不要 commit，除非我明确要求。

用中文回复。
```

## 2. Current project facts

Project:

```text
/home/alex/DTAlex/learningGitHub/AgentMo
```

Current branch:

```text
main
```

Current committed HEAD:

```text
93da9b5 feat: make AgentMo runtime evidence replayable and reviewable
```

Current important state:

```text
AgentMo MVP birth-loop is implemented in the working tree.
The implementation is verified locally.
The implementation is not committed yet.
The release/ history directory is newly added and not committed yet.
```

Latest local verification already observed before this handoff:

```text
npm run check: passed
Node tests: 129/129 passed
git diff --check: passed
```

Additional declared support-triage birth-loop evidence:

```text
/tmp/agentmo-release-support-triage-20260707
birthOk=true
birthStatus=declared-ready
evidenceLevel=declared
promotionEligible=false
runtimeCertifiedByBirthReport=false
domainCertifiedByBirthReport=false
```

Artifact hashes:

```text
b340cdf39931611f0601c98045a59c79aa14f50762ad82fe75f3c9fd7b4c04b1  birth-report.json
0eeaea39b30dc52c30cf21327bb15ab4b4fa1d9c756ac484d893f56ca367e8fe  run-eval.json
81bd04ea411ae97bf3870aa2bdd59301cee2f2e8cf8188ba77951e2da83d7231  discover-pack.json
7db97d10a519642352e2870b2714c51e61a07b23571895a8e92ad262be61273e  blueprint-draft.json
```

## 3. Ultragoal objective for the new session

Stable aggregate objective:

```text
Complete the AgentMo MVP handoff stabilization: recover context from repo artifacts, audit the current uncommitted AgentMo MVP birth-loop and release history, verify tests and evidence gates, and prepare a clean commit-ready summary without touching other projects or reading secrets.
```

Stop condition:

```text
Stop when the new session has:
1. confirmed it is operating only in AgentMo;
2. reviewed current dirty files;
3. verified npm run check and git diff --check;
4. reviewed release/ and MVP docs;
5. reported remaining risks and whether the work is commit-ready;
6. made no commit unless explicitly instructed.
```

## 4. Suggested Ultragoal story breakdown

### G001 — Context recovery

Objective:

```text
Read this handoff, release history, MVP docs, and current git status to reconstruct AgentMo context without using old chat memory.
```

Required commands:

```bash
pwd
git status --short
git rev-parse --short HEAD
git branch --show-current
```

Acceptance:

- `pwd` is `/home/alex/DTAlex/learningGitHub/AgentMo`.
- HEAD is `93da9b5` unless the user has committed after this document was written.
- The session explicitly states it will not touch `pi`, AgentHarness, or OpenClaw without instruction.

### G002 — Working tree audit

Objective:

```text
Classify the current uncommitted AgentMo diff into feature code, tests, docs, examples, release records, and safety-sensitive files.
```

Suggested read targets:

```text
src/cli.js
src/birth-report.js
src/blueprint-draft.js
src/discovery-db.js
src/handoff.js
src/runtime-env.js
src/secret-redaction.js
src/user-need.js
docs/AGENT_BIRTH_GATE.md
docs/MVP_RUNBOOK.md
docs/AGENTMO_MVP_LEDGER.md
release/
```

Do not read:

```text
.env
```

Acceptance:

- The audit explains what changed and why.
- The audit identifies whether any unrelated file appears in the AgentMo diff.
- The audit does not include secret values.

### G003 — Verification gate

Objective:

```text
Re-run the repository checks and confirm the MVP birth-loop remains valid.
```

Required commands:

```bash
npm run check
git diff --check
```

Optional declared vertical slice:

```bash
WORK=/tmp/agentmo-session-migration-support-triage
rm -rf "$WORK"
mkdir -p "$WORK"
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json
node ./bin/agentmo.js need-report examples/support-triage.need.json --json
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" --need examples/support-triage.need.json --out "$WORK/support-triage.agentmo.json" --target openclaw --json
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold" --force
node ./bin/agentmo.js run "$WORK/support-triage.agentmo.json" --target openclaw --workspace "$WORK/scaffold/openclaw/workspace" --message "Say exactly: ok" --out "$WORK/run" --json
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" --build-state "$WORK/scaffold/agentmo-build-state.json" --run-state "$RUN_STATE" --run-eval "$WORK/run-eval.json" --expect-status declared --json
```

Acceptance:

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

### Runtime/productization updates

```text
.gitignore
.env.example
README.md
package.json
docs/OPENCLAW_RUNTIME_NOTES.md
docs/RUNTIME_EXECUTION.md
scripts/openclaw-live-smoke.sh
src/cli.js
src/run-state.js
src/runtime-execution.js
src/runtime-plan.js
src/scaffold-files.js
test/cli.test.js
test/live-smoke-script.test.js
test/run-state.test.js
test/runtime-execution.test.js
test/runtime-plan.test.js
test/runtime-replay-eval.test.js
test/scaffold.test.js
```

### MVP birth-loop additions

```text
docs/AGENTMO_MVP_LEDGER.md
docs/AGENT_BIRTH_GATE.md
docs/MVP_RUNBOOK.md
examples/fixtures/
examples/support-triage.agentmo.json
examples/support-triage.discovery.json
examples/support-triage.need.json
src/birth-report.js
src/blueprint-draft.js
src/discovery-db.js
src/handoff.js
src/runtime-env.js
src/secret-redaction.js
src/user-need.js
test/birth-report.test.js
test/blueprint-draft.test.js
test/cli-mvp.test.js
test/discovery-db.test.js
test/handoff.test.js
test/runtime-env.test.js
test/secret-redaction.test.js
test/user-need.test.js
```

### Release history additions

```text
release/README.md
release/2026.07.03.md
release/2026.07.05.md
release/2026.07.06.md
release/2026.07.07.md
docs/OMX_SESSION_MIGRATION.md
```

## 6. Architecture invariants to preserve

1. AgentMo is a three-stage AgentMother mechanism:

   ```text
   Discover -> Plan -> Produce
   ```

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

## 7. What not to do in the new session

Do not:

- read `.env`;
- print secret values;
- modify `/home/alex/DTAlex/learningGitHub/pi`;
- modify `/home/alex/DTAlex/learningGitHub/AgentHarness`;
- modify `/home/alex/DTAlex/learningGitHub/openclaw`;
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

Suggested commit intent:

```text
feat: add AgentMo MVP birth-loop
```

Suggested body/trailers:

```text
Implement the CLI-first AgentMother birth loop so discovery plus user need can produce a blueprint, handoff, runtime evidence, and fail-closed birth report.

Constraint: MVP evidence must remain deterministic, secret-blind, and non-certifying by default.
Rejected: Direct Codex execution inside AgentMo | MVP should generate handoff artifacts first.
Confidence: high
Scope-risk: moderate
Directive: Do not treat declared-ready or live-success evidence as domain certification.
Tested: npm run check; git diff --check; support-triage declared birth-loop
Not-tested: Production OpenClaw deployment; domain certification; AgentHarness integration
```

## 9. Final note for future sessions

If context becomes confusing again, stop and read this file first. It is the canonical local handoff for resetting the AgentMo session.
