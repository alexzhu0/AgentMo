# External Integrations

**Analysis Date:** 2026-07-10

## APIs & External Services

**OpenClaw runtime:**
- AgentMo plans and optionally launches OpenClaw agent runs through `src/runtime-plan.js` and `src/runtime-execution.js`.
- Integration method: spawn the installed `openclaw` CLI, or run `pnpm openclaw agent` from an explicitly supplied OpenClaw source root.
- The runtime command is an explicit Stage 3 operation; normal discovery, planning, validation, and scaffold commands do not invoke OpenClaw.
- Supported identity fields remain separate: provider, model, thinking, runtime, channel, transport, fallback, selector, workspace, sandbox, and env.

**Model providers:**
- DeepSeek is supported indirectly through the OpenClaw runtime path.
- Authentication is passed through the allowlisted `DEEPSEEK_API_KEY` environment key; values must never appear in artifacts or logs.
- AgentMo has no direct HTTP client or provider SDK in `package.json` or `src/`.

**GitHub collaboration:**
- The canonical repository is documented in `CONTRIBUTING.md` as `https://github.com/alexzhu0/AgentMo.git`.
- GitHub is used for collaborator access, feature branches, PR review, tags, and releases.
- There is no `.github/workflows/` CI configuration in the current tree; verification is currently a documented local responsibility.

## Data Storage

**Databases:**
- No operational database is used by the AgentMo CLI.
- Stage 1 writes a logical discovery database as JSON/JSONL files such as `agentmo-discovery-db.json` and `facts.jsonl`.

**File Storage:**
- The local filesystem stores discovery, plan, blueprint, handoff, build, run, eval, birth, delivery, and release artifacts.
- Atomic temporary-file-plus-rename writes are used for sensitive managed artifacts in modules such as `src/design-plan.js`, `src/discovery-db.js`, and `src/handoff.js`.
- Scaffold output is written only after `src/scaffold.js` rejects a non-empty destination unless `--force` is explicit.

**Caching:**
- No cache service or persistent in-memory cache is used.

## Authentication & Identity

**Application identity:**
- AgentMo does not authenticate end users.
- Domain-agent identity is declared by blueprint `agent_id`, runtime profiles, and explicit runtime selectors.

**Runtime credentials:**
- `src/runtime-env.js` allowlists DeepSeek and OpenClaw gateway env-key names.
- Durable metadata records basename, allowed/present/missing key names, and `valuesPersisted: false`; it does not store values.
- `.env` and local variants are ignored by `.gitignore`; repository instructions prohibit reading or committing them.

## Monitoring & Observability

**Managed evidence:**
- `src/run-state.js` records bounded execution summaries, digests, timing, replay metadata, and mutation flags.
- `src/evidence-audit.js` rejects raw transcript/tool-body/output markers and secret-like values from managed evidence.
- `src/control-snapshot.js` provides an auditable status view from blueprint plus optional build/run state.

**External monitoring:**
- No Sentry, analytics, log aggregation, or telemetry service is integrated.
- Console output is the CLI interface; top-level errors are redacted by `bin/agentmo.js` before printing.

## CI/CD & Deployment

**Packaging:**
- `package.json` exposes the `agentmo` executable and requires Node.js 20+.
- No automated npm publication or deployment pipeline is present in the repository.

**Release process:**
- Date-based evidence records live in `release/YYYY.MM.DD.md`.
- Alex decides merge and release; Echo implements and opens PRs; Codex supports planning, review, documentation, and authorized publication.
- A release record is evidence documentation, not proof that a tag, npm package, or deployment occurred.

## Environment Configuration

**Development:**
- No environment variables are required for the default deterministic test suite.
- Optional live DeepSeek/OpenClaw work expects an operator-controlled env file and isolated `OPENCLAW_STATE_DIR`.
- `README.md` references `.env.example`, but that file is absent from the current working tree; see `CONCERNS.md`.

**Staging/Production:**
- No managed staging or production environment is defined by this repository.
- Production OpenClaw state is rejected by default; use requires explicit `--use-production-openclaw-state` evidence.

## Webhooks & Callbacks

**Incoming:**
- None.

**Outgoing:**
- None from AgentMo itself. Any provider/network activity occurs inside the explicitly launched external OpenClaw runtime.

---

*Integration audit: 2026-07-10*
*Update when adding/removing runtime or release integrations*
