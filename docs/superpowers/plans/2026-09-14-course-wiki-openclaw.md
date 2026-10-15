# Course Wiki OpenClaw Implementation Plan

> **Historical preparation-time snapshot:** checklist and “not yet run” statements
> below describe the state when this implementation plan was authored. They are not
> the current execution record. See [release/2026.09.14.md](../../../release/2026.09.14.md)
> for historical live results, and [release/2026.09.15.md](../../../release/2026.09.15.md)
> for the approved offline citation-selection follow-up and remaining gaps.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Follow TDD and independent review. Do not commit or push.

**Goal:** Build a local course-document Wiki and cited Q&A assistant named `course-wiki` on OpenClaw using DeepSeek V4 Flash.

**Architecture:** Reuse the installed memory-wiki CLI/tools for source pages, compiled indexes, synthesis pages and queries. Add a bounded document intake and local UI/runtime boundary; do not reuse the research-domain seed schema or implement another vector database. Keep source evidence, generated synthesis and runtime verification separate.

**Tech Stack:** Node ESM and node:test; installed OpenClaw 2026.7.1-2; macOS textutil for DOCX only after bounded conversion tests. No npm dependency installation by default.

**Spec:** `docs/superpowers/specs/2026-09-14-course-wiki-openclaw-design.md` (confirmed by user).

## Global Constraints

- `course-wiki` is a new isolated profile/agent/workspace/vault, not the default agent.
- Model exactly `deepseek/deepseek-v4-flash`; no fallback. Disable thinking for initial acceptance.
- Only DOCX, Markdown, UTF-8 TXT. Maximum 10 files per batch, 2 MiB each, 100,000 extracted body characters in aggregate.
- No `.env` reads, default profile mutation, credential-store copying, background jobs, public server, new dependencies, commit or push.
- Keep historical material/license/source mappings. Treat file instructions as untrusted data.
- Existing main has unrelated uncommitted changes. User authorized isolated worktree; implementation uses `.worktrees/course-wiki`, branch `codex/course-wiki`.
- Live tests require separate bounded spending/data approval and operator-provided authentication. Only value-blind key checks. Offline work must not wait for a key once the code location is settled.
- `npm run check` and `git diff --check` required for code changes. Capture natural exit and test totals; never infer success from a lost process.
- A working domain POC is not formal AgentMo Discover/Plan/Produce closure or production certification.

## Current checklist

- [x] Fixed source excerpts and SHA-256/line mapping verification.
- [x] User-approved product design and model selection.
- [x] Inspect installed Wiki plugin manifest, CLI ingestion and retrieval source.
- [x] User authorized and created isolated worktree; baseline focused tests 13 pass, exit 0.
- [x] Task 1: bounded intake and source evidence; 23 focused tests, independent review clean.
- [x] Task 2: isolated OpenClaw workspace, Wiki and model boundary; independent review approved, two minor follow-ups recorded.
- [ ] Task 3: upload/Wiki/Q&A view, independent review and verification.
- [ ] Live domain acceptance (spending and credentials required).

## Task 1: Document intake and citation evidence

**Files:** Create `src/course-wiki-documents.js`, `test/course-wiki-documents.test.js`.

**Interfaces:**

```js
// async normalizeDocument({ name, bytes, convertDocx? })
// -> { name, sourceDigest, text, lines }
// validateDocumentBatch(documents) -> documents, or a bounded Error code
// validateCitations(citations, documents) -> true, or a bounded Error code
// citation: { sourceDigest, fromLine, toLine, quote }
```

- [ ] Write RED tests using real buffers for UTF-8 Chinese/English, CRLF normalization,
  empty/NUL/invalid UTF-8 rejection, forbidden extensions, file and batch size limits,
  traversal names, exact quoted-line matching and out-of-range citation rejection.

```js
it('rejects a citation that attributes words to the wrong source', () => {
  const docs = [{ sourceDigest: 'a', lines: ['Nouns name things.'] }];
  assert.throws(() => validateCitations([
    { sourceDigest: 'a', fromLine: 1, toLine: 1, quote: 'Adjectives name things.' }
  ], docs));
});
```

- [ ] Run `node --test test/course-wiki-documents.test.js`; record expected RED reason.
- [ ] Implement byte/extension validation, fatal UTF-8 decoding, line normalization and
  citation checks. Use a bounded no-shell textutil process for DOCX, no external links,
  hard timeout/output cap; use controlled DOCX fixtures and no caller-selected executable.
- [ ] Run GREEN tests and verify the three sample-file hashes before ingestion.
- [ ] Reviewer checks source fidelity, loss prevention, input limits and test coverage.

## Task 2: OpenClaw-native runtime boundary and independent agent

**Files:** Create `src/course-wiki-openclaw.js`, `test/course-wiki-openclaw.test.js`;
create reviewed course instructions as templates alongside this module if needed.

**Interfaces:**

```js
// prepareCourseWorkspace({ root, executable }) -> { agentId, root, configPath }
// importCourseDocuments({ root, documents }) -> { sources }
// runCourseTurn({ root, message, liveAuthorization }) -> { answer, citations, usage }
// Each public operation validates its own root/input; model cannot choose argv or paths.
```

- [ ] Add RED tests for refusal to overwrite existing roots, symlink rejection,
  closed child environment, absence of secrets from configuration/output, no provider call
  without live authorization and immutable exact model selection.

```js
it('does not invoke a provider when live authority is absent', async () => {
  await assert.rejects(runCourseTurn({ root, message: 'Explain nouns.' }),
    { code: 'COURSE_WIKI_LIVE_NOT_AUTHORIZED' });
  assert.equal(providerRequestsObserved, 0);
});
```

- [ ] Run RED; then implement isolated HOME/state/config and prepare `course-wiki`
  workspace instructions. Config allowlists only required Wiki tools, denies generic
  exec/read/write/browser/channel tools, disables bridge/heartbeat/automatic tasks.
- [ ] Use public OpenClaw CLI `wiki init`, `wiki ingest`, `wiki compile`,
  `wiki search`, `wiki get`, `wiki lint`; do not import hashed private dist modules.
  Assign content-digest source titles to avoid native title-slug collisions.
  Stage a new corpus before selecting it; failed imports retain previous usable corpus.
- [ ] Verify native source IDs and source-line mapping after ingest. Preserve originals
  and license metadata; index only selected teaching body for the sample corpus.
- [ ] Configure the explicit DeepSeek model via supported installed provider surfaces.
  Inspect a real offline model-catalog result; if a provider plugin installation is
  necessary, report the exact package requirement instead of installing it automatically.
- [ ] Register with `agents add course-wiki --workspace <isolated-workspace>
  --agent-dir <isolated-agent-dir> --model deepseek/deepseek-v4-flash
  --non-interactive --json` only inside the selected isolated profile/environment.
  Confirm with scoped `agents list --json`; do not use an existing agent as success.
- [ ] Limit each run by timeout, context/output size and tool/call budget. If the
  runtime cannot reliably enforce the accepted cost bound, do not perform live calls.
- [ ] GREEN tests plus a real offline isolated Wiki ingest/search/get probe. Separate
  simulation, registration and native Wiki execution outcomes in the report.
- [ ] Reviewer verifies no host access is granted by prompt alone, default state is
  untouched, and runtime failure cannot be mislabeled as model or domain success.

## Task 3: Minimal local document/Wiki/Q&A interface and acceptance

**Files:** Create `scripts/course-wiki-poc.mjs`, `src/course-wiki-server.js`,
`test/course-wiki-server.test.js`, and `docs/poc/course-wiki/RUNBOOK.md`.
Use a single minimal static page only if native OpenClaw UI does not provide the
required upload/Wiki/source interactions; inspect before choosing implementation.

**Interfaces:** Server uses Task 1 intake/citations and Task 2 workspace/turn operations.
No independent model SDK, vector store or alternate chat runtime.

- [ ] Write RED HTTP tests for loopback-only binding, Host/Origin restrictions, bounded
  request bodies, denied arbitrary file routes, upload errors and cited-source access.

```js
it('rejects cross-origin document upload before ingestion', async () => {
  const response = await fetch(base + '/api/documents', {
    method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}'
  });
  assert.equal(response.status, 403);
  assert.equal(documentsAfterRequest.length, 0);
});
```

- [ ] Run RED; implement file picker/drag upload, document list, Wiki topic display,
  Q&A input and citation view. Render material/model text without active HTML/scripts.
- [ ] Keep deterministic ingest separate from model-authored Chinese summaries.
  Never seed prewritten answers and label them automatic Wiki generation.
- [ ] GREEN HTTP and document/runtime tests; verify actual UI interaction in browser.
- [ ] After bounded live approval and authentication, generate at least three Wiki
  topics and run the five existing acceptance questions. Require source-correct answers,
  at least one cross-document answer, and clear absence-of-evidence response for IELTS.
- [ ] Restart and verify persisted Wiki/source access; record exact tests, counts,
  exit codes, runtime/model and measured usage without secrets/raw provider envelopes.
- [ ] Independent review of complete diff; focused retest, `npm run check`,
  `git diff --check`; update release record and runbook with honest remaining gaps.

## Handoff

The controller retains integration ownership. If subagents are used, delegate one
bounded file set at a time, supply both this plan and approved spec, and require
RED/GREEN evidence plus separate spec/quality review. Do not create user-owned tasks
or start background monitors merely to execute these subtasks.

Historical handoff snapshot: the following paragraph records the preparation-time
handoff and does not claim that Wiki/model calls remain unrun today; current status is
in [release/2026.09.14.md](../../../release/2026.09.14.md).

Implementation is tracked in the plan-owned SDD ledger. User authorized public-sample-only
live acceptance up to CNY 5 and expressly accepted that the legacy API name now
routes to V4.1 Flash. At this snapshot, key presence was verified value-blind and no
live call had yet been made.
Native Wiki init and custom-provider model catalog probes passed without installing
dependencies. Use a bounded forwarding boundary to enforce actual upstream call limits;
never infer a monetary cap from a CLI timeout alone.
