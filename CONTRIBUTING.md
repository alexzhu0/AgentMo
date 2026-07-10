# Contributing to AgentMo

AgentMo is an artifact-first toolkit for building agents as software. Please keep contributions small, reviewable, and evidence-backed.

## Repository boundaries

Work inside this repository only unless a maintainer explicitly expands scope.

Do not read or modify sibling projects by default:

```text
/home/alex/DTAlex/learningGitHub/pi
/home/alex/DTAlex/learningGitHub/AgentHarness
/home/alex/DTAlex/learningGitHub/openclaw
```

Do not read `.env`, private keys, credential stores, token dumps, or raw logs that may contain secrets. `.env.example` is safe to inspect.

## Project model

AgentMo has three artifact-coupled stages:

1. **Discover**: materialize sanitized source inventory and facts as `agentmo.discovery-db.v1`.
2. **Plan**: combine discovery DB plus `agentmo.user-need.v1` into `agentmo.design-plan.v1`, then draft a valid blueprint/design contract.
3. **Produce**: turn a valid blueprint/design contract into handoff, scaffold, run/eval, birth, domain-eval, and delivery evidence.

Do not introduce hidden dependencies between stages. A later stage should trust valid artifacts, not the command history that created them.

## Development workflow

1. Read `README.md`, `docs/STAGE_CONTRACTS.md`, `docs/MVP_RUNBOOK.md`, and `AGENTS.md` before larger changes.
2. Add or update tests before changing behavior when possible.
3. Keep source changes separate from release/doc maintenance when the diff becomes large.
4. Update docs and `release/YYYY.MM.DD.md` when changing durable behavior, CLI commands, schema semantics, evidence rules, or certification boundaries.
5. Do not claim production readiness, runtime certification, or domain-wide certification unless the corresponding evidence artifact proves it.

## Useful commands

```bash
npm run check
git diff --check
```

For Stage 2 changes, also run:

```bash
node --test test/design-plan.test.js
node --test test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
```

## Commit expectations

Stage explicit paths; do not use `git add .` or `git add -A`.

Use the repo's decision-record style commit messages when practical:

```text
<why this change exists>

Constraint: <constraint that shaped the decision>
Rejected: <alternative> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <future warning>
Tested: <commands/evidence>
Not-tested: <known gaps>
```

## Release records

Release notes live under `release/YYYY.MM.DD.md` and are indexed newest-first in `release/README.md`. Treat those files as the source body for public GitHub Releases when releases are published. Do not upload Markdown release records as assets unless a maintainer explicitly asks for downloadable copies.
