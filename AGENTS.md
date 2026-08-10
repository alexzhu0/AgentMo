# AgentMo Agent Instructions

AgentMo is the active project in this repository. Treat this file as the local
operating contract for Codex/OMX sessions started from the AgentMo repository
root.

## Project intent

AgentMo implements its canonical three-stage mechanism:

```text
Discover -> Plan -> Produce
```

The goal is to build domain agents as reproducible software artifacts, not as one-off prompts. AgentMo should preserve:

- data discovery and source manifests;
- user-need briefs;
- blueprint drafting;
- coding/runtime handoff packages;
- scaffold/runtime evidence;
- fail-closed birth reports;
- release and evidence ledgers.

## Scope boundaries

Default scope is this repository only.

Do not read or modify these sibling projects unless the user explicitly asks:

```text
/home/alex/DTAlex/learningGitHub/pi
/home/alex/DTAlex/learningGitHub/AgentHarness
/home/alex/DTAlex/learningGitHub/openclaw
```

When those projects are discussed without an explicit implementation request:

- `pi` is historical context for Win9-on-Pi and Codex-built agents.
- `openclaw` is an architecture/runtime reference already summarized in AgentMo docs.
- `AgentHarness` is governance/control-plane inspiration, not a stable integrated dependency.

## Secret handling

Never read, print, summarize, or copy `.env` contents.

Allowed:

- mention `.env` as a local secret file;
- read `.env.example`;
- use tests and evidence that are value-blind.

Forbidden in committed docs or evidence:

- credential values;
- raw provider payloads;
- raw transcripts;
- credential-bearing OpenClaw state;
- unredacted stdout/stderr previews that could contain secrets.

## Session recovery

For a new or confused session, read these first:

```text
docs/SUPERPOWERS_WORKFLOW.md
docs/CURRENT_STATUS.md
release/README.md
release/2026.08.06.md
docs/MVP_RUNBOOK.md
docs/AGENT_BIRTH_GATE.md
README.md
```

AgentMo uses Superpowers for its project workflow. Every new AgentMo Codex
development session must invoke `superpowers:using-superpowers` first, then
select and use the Superpowers skills applicable to the task. Do not invoke GSD
commands, restore a GSD workflow, or treat the removed legacy planning
workspace as a recovery authority. Use `docs/superpowers/` for Superpowers
design and plan documents; use the maintained docs and `release/` for project
facts and historical evidence.

Then confirm:

```bash
pwd
git status --short
git branch --show-current
git rev-parse --short HEAD
```

Do not commit until the user explicitly asks.

## Validation

For code changes, run:

```bash
npm run check
git diff --check
```

For docs-only changes, run at least:

```bash
git diff --check
```

If changing Stage 2 planning, run `node --test test/design-plan.test.js` and the Stage 2 contract test set documented in `docs/MVP_RUNBOOK.md`. If changing the composed MVP birth-loop, also verify the support-triage vertical slice described in `docs/OMX_SESSION_MIGRATION.md` or `docs/MVP_RUNBOOK.md`.

Runtime compatibility changes must preserve these controls:

- `--runtime-env-file` is AgentMo's only public runtime environment-file option; do not restore a colliding launcher alias. The Bash live-smoke helper owns its environment-file option locally.
- `scripts/node20-distribution-trust.json` is repository-owned policy. Runtime selectors must match it exactly and callers or environment variables must not override the trust anchor.
- Run the Node 20 producer into a new, absent temporary receipt path. Publish those exact bytes only after success, then run the post-publication consumers. Consumer tests must not enter the producer manifest or accept historical trust-marker environment variables.
- Runtime receipts and compatibility rows prove bounded mechanism execution only; they do not certify domain quality, production readiness, or wider OpenClaw compatibility.

## Release records

Maintain `release/YYYY.MM.DD.md` when a change affects:

- AgentMo architecture;
- blueprint/schema/runtime/birth-gate semantics;
- discovery/plan/produce loop behavior;
- runtime promotion evidence;
- certification boundaries;
- session migration or handoff rules;
- large project milestones.

Release records are evidence summaries, not raw logs. Include paths, commands, hashes, status, and remaining risk. Do not include secrets or raw machine transcripts.

## Evidence semantics

Preserve these distinctions:

- `declared-ready` proves wiring and deterministic mechanism evidence only.
- `live-success` proves isolated runtime execution only.
- Neither declared evidence nor live smoke certifies domain quality.
- `birth-report` must remain fail-closed and non-self-certifying.
- `observe-run` is proposal-only and must not mutate blueprint, scaffold, runtime, or evals automatically.

## Commit hygiene

When committing, stage explicit paths only. Do not use:

```bash
git add .
git add -A
```

In this worktree, `AGENTS.md` may be ignored by local `.git/info/exclude`. If the user explicitly wants to commit this file, stage it with:

```bash
git add -f AGENTS.md
```

Recommended commit style is a concise decision record:

```text
<why this change exists>

Constraint: <constraint that shaped the decision>
Rejected: <alternative considered> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <future warning>
Tested: <commands/evidence>
Not-tested: <known gaps>
```

Stage explicit paths only and include verification evidence in the commit body when useful.
