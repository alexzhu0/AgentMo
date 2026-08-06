# AI Frontier OpenClaw POC v2 Design

## Purpose

Turn the current boot-path POC into an inspectable OpenClaw-style information
agent package. It remains a local, externally seeded demonstration; it is not
a live collector or production deployment.

## Package shape

`agentmo poc build` will write an absent workspace with four explicit layers:

1. **Agent surface** — `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`,
   `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md`. The documents state the
   local-Wiki-only rule, no credential retention, no automatic publication,
   and no autonomous schedule execution.
2. **Skills** — focused Markdown skills for source intake review, paper
   analysis, GitHub release tracking, normalization/deduplication, Wiki
   retrieval, citation answering, and quality review. Skills are instructions
   and declared capabilities, not unreviewed external code or auto-installed
   plugins.
3. **Knowledge** — canonical `wiki.json`, human-readable `WIKI.md`, a
   deterministic `source-index.json`, `entity-index.json`, and a local query
   script. First canonical HTTPS URL wins; records retain source URL,
   published/collected times, type, and trust tier.
4. **Operations** — JSON cron proposals for daily collection, daily curation,
   and weekly review plus a `scripts/cron.mjs` validator/dry-run renderer.
   They can never register, start, or execute a schedule.

## Runtime

`agentmo poc run` retains one isolated OpenClaw profile under the generated
workspace. It may install/trust only the pinned official DeepSeek provider in
that isolated profile, stores only an environment-variable reference rather
than a credential value, creates/reuses the named agent, and invokes one local
turn. It returns only the textual model payload, never session/tool/provider
metadata. No default profile, delivery, cron execution, browsing, live
collection, or user-level configuration is allowed.

## Acceptance

- The generated workspace contains every declared document, skill, index, and
  cron proposal with manifest digest binding.
- All seed records are deduplicated and indexed deterministically.
- `node scripts/wiki.mjs check|query` and `node scripts/cron.mjs check|dry-run`
  are deterministic and make no network or scheduler calls.
- Runtime tests prove secret redaction, isolated profile-only commands,
  bounded diagnostics, and text-only OpenClaw response extraction.
- A real OpenClaw turn remains evidence of one isolated runtime turn only; it
  never certifies freshness, domain quality, production readiness, or the
  normal AgentMo package lifecycle.
