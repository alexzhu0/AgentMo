# AgentMo Agent Instructions

AgentMo is the active project in this repository. Treat this file as the local operating contract for Codex/OMX sessions started from:

```text
/home/alex/DTAlex/learningGitHub/AgentMo
```

## Project intent

AgentMo implements the **AgentMother** mechanism:

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
docs/OMX_SESSION_MIGRATION.md
release/README.md
docs/MVP_RUNBOOK.md
docs/AGENT_BIRTH_GATE.md
docs/AGENTMO_MVP_LEDGER.md
README.md
```

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

If changing the MVP birth-loop, also verify the support-triage vertical slice described in `docs/OMX_SESSION_MIGRATION.md` or `docs/MVP_RUNBOOK.md`.

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

Recommended commit style for the current MVP work:

```text
feat: add AgentMo MVP birth-loop
```

Include verification evidence in the commit body when useful.
