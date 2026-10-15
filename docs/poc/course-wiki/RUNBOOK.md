# Course Wiki local POC runbook

## Current entry: the existing OpenClaw Gateway (2026-09-15)

2026-09-16 status: PARTIAL. The model channel was restored as a detached local
process (not a login service). Native Gateway CLI paid probes passed definition,
classification and contextual follow-up with verified citations. The subsequent
out-of-material question failed `COURSE_WIKI_MODEL_JSON_INVALID`; the batch stopped
without automatic paid retry. Browser acceptance remains incomplete. Do not label
the agent generally usable or the full project check passed from these probes.

`course-wiki` is registered in the user's existing OpenClaw configuration. Open
the normal authenticated `openclaw dashboard`, select **Course Wiki**, and use its
native chat / New session controls. The local dashboard is on port 18789; the old
port 17892 page is not the acceptance entry. Do not publish or copy the dashboard
authentication token.

The agent has its own workspace, agent state and persistent sessions. Its model
is `course-wiki/deepseek-v4-flash`; the dedicated loopback provider on port 17893
loads the real DeepSeek credential only into the budget-bound process. OpenClaw
uses a file SecretRef for a separate local proxy token, not the provider key.
Default agent settings, other agents and Gateway authentication are unchanged.
Tools and shared skills are disabled for this fixed-public-material POC; no
embedding/search API, attachment processing, or arbitrary filesystem tools are enabled.

### OpenClaw 2026.9.4 upgrade compatibility

The user upgraded the installed Gateway after the initial integration. Its Doctor
migrates `TOOLS.md` into `AGENTS.md` and archives the old workspace setup JSON.
The adapter accepts the exact content-preserving merged template, with no retired
`TOOLS.md`, alongside the original layout. A retained setup archive must be one
bounded ordinary single-link file, with the expected SHA256/UUID filename,
matching bytes and valid state schema; ambiguous or altered files fail closed.
Provisioning preserves an intact migrated layout instead of restoring retired files.
If an archive exists but agent rules are missing, it refuses before writing.

The isolated CLI config now uses `agents.entries`, omits retired `runRetries`,
and selects `course-wiki` explicitly for Wiki commands. Vault scope is global
only inside each isolated corpus root; it is not the user's shared Wiki vault.
Native `DREAMS.md` and date-named files below `memory/.dreams/session-corpus`
and `memory/dreaming/{light,rem,deep}` are bounded untrusted recall, never added
to the approved source manifest. Symlinks, hardlinks, unknown paths, oversized
files and excessive memory entries fail closed. Approved teaching and bootstrap
files remain byte-checked.

Native `openclaw agents list --json` remains the registration check. The upgraded
configuration uses `agents.entries` and `memory.search`; the existing Course Wiki
agent, dedicated model, denied tools, empty skills, and disabled memory search were
confirmed value-blind. Do not reapply the historical `courseGatewayPatch` helper to
the new config layout. Its old `runRetries` tuning was retired by OpenClaw; it is no
longer evidence of native retry policy. The local model channel still never retries
upstream automatically, rejects identical wire replays, and reserves every accepted
request against the unchanged fee ceiling. Broader native retry behavior is unverified.

This compatibility correction does not fix intermittent model JSON failures.
The upgraded native UI has not passed a new paid end-to-end acceptance batch.

### Model channel operation

Start the model channel from this worktree with
`node --env-file="$AGENTMO_RUNTIME_ENV_FILE" scripts/course-wiki-poc.mjs --live --gateway`.
This reuses the R2 allowance and does not reset it. Set the environment-file path
without reading or printing its contents. The channel must stay running; no new
login/autostart service is installed. Restarting this channel does not delete
OpenClaw conversations or the budget ledger.

OpenClaw owns the workspace bootstrap and history. The adapter normalizes only
text content parts, adds a narrow JSON transport instruction, requests a bounded
non-streaming JSON completion and renders validated answer/citation text back as
native SSE. Empty/invalid responses remain failures, with no automatic paid retry.
Provider JSON mode (`response_format`) is disabled after observed whitespace-only
completions; strict local JSON and citation validation remains mandatory. This is
not a proven stability fix: the final three-turn native UI batch passed definition
and contextual comparison, but the missing-evidence question failed with
`COURSE_WIKI_MODEL_JSON_INVALID`. Current status is **PARTIAL**, not ready for an
unattended demonstration. Refresh retained both answers and the failed-turn record.
The dedicated 65536-token model metadata avoids the earlier 8768-token native
compaction threshold; it does not disable compaction or expand the independent
48 KiB request, 32-message, 2048-output-token, or fee bounds.

The immutable teaching snapshot remains exactly three approved public excerpts
and three generated Wiki topics. Native `openclaw-workspace-state.json` metadata
and bounded date-slug files under `memory/` are permitted private session state.
OpenClaw can inject that memory as **untrusted recall**; it is not admitted teaching
evidence, and citations must still resolve to the three original digests. The
existing session-memory hook's `llmSlug` setting was checked value-blind and is
not enabled, so this hook does not introduce a separate slug-generation model call.

Arbitrary document upload/rebuilding remains outside this fixed-material live
demo. Current acceptance results and remaining failures are in `release/2026.09.15.md`.

## Historical CLI-only native workspace checkpoint (2026-09-15)

The primary deliverable is the existing isolated OpenClaw `course-wiki` agent's
persistent workspace, not the old browser wrapper. Its root-relative path is
`.agentmo/course-wiki-interactive-2026-09-15-r2/workspace` in this worktree.
`AGENTS.md`, `SOUL.md`, `IDENTITY.md` and `TOOLS.md` contain its operating rules;
`MEMORY.md` contains all three approved excerpts with digest/line references;
`WIKI.md` retains the generated topics. `source-N.txt` originals and
`SOURCE-MANIFEST.json` retain provenance, licenses and original-file mappings.

Provision without an API call using `node scripts/course-wiki-poc.mjs --live --prepare-workspace`.
Ask from this worktree using
`node --env-file="$AGENTMO_RUNTIME_ENV_FILE" scripts/course-wiki-poc.mjs --live --ask '形容词是什么呢？'`.
Set `AGENTMO_RUNTIME_ENV_FILE` to the approved local secret-file path without reading
or printing it. These two actions do not start an HTTP server. The latter invokes
native `openclaw agent --local`: its user message is only the question; native
bootstrap loads the persistent rules and course evidence. One upstream request per
question uses the existing R2 ledger, without automatic retries or allowance resets.

This is an **immutable three-public-material POC snapshot**. After provisioning,
import and Wiki regeneration fail with `COURSE_WIKI_WORKSPACE_FROZEN` before writes
or API spending. Altered or extra workspace files fail validation before spending;
re-provisioning only completes missing expected files and never overwrites edits.
At this earlier checkpoint, updating arbitrary materials, conversation-history
persistence and Gateway/chat-channel setup were not implemented. The Gateway and
history integration above supersedes that limitation; default-agent changes remain excluded.
The native runner still uses isolated temporary runtime configuration for its budget
proxy, while the workspace itself persists. Tools remain denied; a workspace is not
an OS sandbox. The original page service was stopped for this native handoff; the
historical web entry below is not the current acceptance entry.

Current verification results and remaining gaps are recorded in `release/2026.09.15.md`.

## Historical interactive repair (2026-09-15)

At this historical checkpoint the status was **PARTIAL, not ready for reliable user acceptance**: an adjective
question exposed misleading-search exclusion (fixed), an unreproduced native error,
and intermittent invalid model responses / false missing-evidence answers. The fixed
three approved excerpts are now all verified and supplied within the existing bounds;
this does not prove answer quality. Do not ask the user to repeat tests as a substitute
for controller verification. See the latest section of `release/2026.09.15.md`.

The previous fixed-question handoff rejected ordinary questions; do not use that
result to claim a usable free-text demo. Current repair uses a separately allocated
root `.agentmo/course-wiki-interactive-2026-09-15-r2`, explicit
`course-wiki-interactive-2026-09-15` authority and64requests (CNY19.84 reserved ceiling).
The two old16request ledgers remain unchanged; all3 allocations total at mostCNY29.76
under the user's cumulativeCNY100 authority. No automatic allocation or reset.
Only the existing3public grammar excerpts can be sent to DeepSeek. Free non-sensitive
questions up to2000characters are allowed. Live uploads are disabled in both HTTP
and UI; this is not a demonstration of arbitrary uploaded materials.
The historical loopback URL was `http://127.0.0.1:17892/`. The old launcher was
`node --env-file="$AGENTMO_RUNTIME_ENV_FILE" scripts/course-wiki-poc.mjs --live`.
Set `AGENTMO_RUNTIME_ENV_FILE` to the approved local secret-file path without reading
or printing its contents.
This is value-blind Node environment loading, never shell-source or print the file.
The production launcher now binds the already allocatedR2root/campaign and does not
create/reset it. Budget ledger campaign must equal the server-held authority.
Each answer uses2requests; allowance is shown in the page.
Latest evidence/status: `release/2026.09.15.md`. No overallPASS until fresh check exits.

Status: the local server/UI mechanism is implemented and covered by focused offline
HTTP tests. Real provider acceptance, browser fidelity/interaction QA, independent
review, aggregate `npm run check`, release evidence, and any certification claim are
controller-owned and must be recorded separately.

## What this launcher does

`scripts/course-wiki-poc.mjs` serves one static page on IPv4 loopback. It closes over
one existing Course Wiki root and one server-held live authority (or no authority) at
startup. Browser requests cannot select a root, OpenClaw executable, API key, fee
policy, reset operation, or live authority. The launcher does not prepare, reset,
replace, or delete a Course Wiki root.

The page supports:

- one complete DOCX/Markdown/UTF-8 TXT batch, at most 10 files and 2 MiB per file;
- the selected source list;
- model-generated Wiki topics only (no prewritten or fake empty-state topics);
- Chinese Q&A results, explicit missing-evidence results, and exact citations;
- normalized teaching text, complete original text, provenance, and license views.

Every import is a **full-batch replacement**. A successful new batch replaces the
selected corpus and clears its selected generated topics. A failed batch preserves
the previous selection. Locally importing other files does not automatically grant
provider authorization for Wiki generation or Q&A.

## Start an existing prepared local root

Use a canonical absolute root that was prepared through Task 2's
`prepareCourseWorkspace`. The root must already exist and must not contain symlink
components.

```bash
node scripts/course-wiki-poc.mjs \
  --root /absolute/existing/course-wiki-root \
  --port 17891
```

Then open the printed `http://127.0.0.1:<port>` URL. Without the server-held first
campaign authority, local import and reading work, while provider-backed generation
and questions fail explicitly with `COURSE_WIKI_LIVE_NOT_AUTHORIZED`.

## Controller-only first live campaign

Historical first-campaign acceptance status: **PARTIAL**. The first campaign has consumed 15 request
reservations (CNY 4.65 reserved, not an invoice), leaving one request, which cannot
complete a two-request question. Keep the key-bearing service stopped; the commands
below describe the existing mechanism, not permission to resume spending. The
initially approved 2026-09-15 citation-selection repair was offline-only. The user
subsequently authorized cumulative POC spending up to CNY100 without per-run approval;
the separately allocated retest passed Wiki generation, all five fixed questions,
and one actual-browser repeat. Its local demonstration is at
`http://127.0.0.1:17892`, with the original campaign preserved. This does not renew
the original launcher/root allowance. See
[`2026.09.15.md`](../../../release/2026.09.15.md) for follow-up verification and
[`2026.09.14.md`](../../../release/2026.09.14.md) for historical live results.

The following mode is hard-bound in code to the single root and campaign recorded in
`.superpowers/sdd/2026-09-14-course-wiki-openclaw/live-campaign.md`:

```bash
node scripts/course-wiki-poc.mjs --live --port 17891
```

`--live` rejects `--root`; there is no executable, credential, allowance, reset, or
authority option. It never creates a replacement root or allowance. If the recorded
root is absent, aliased, or broken, startup fails. Do not delete/recreate that root,
its budget, or its retained evidence after an error.

The original first live campaign has one total **CNY 5** cap and is limited to the
exact three recorded public sample digests and the exact five acceptance questions
exported by Task 2. There is no reset, refund, top-up, replacement allowance, or
alternate-root allowance. The text field is not an authorization expansion: other
questions fail closed. The configured request remains `deepseek/deepseek-v4-flash`;
the provider may return
`usage.actualModel: "deepseek-flash"`, which the UI displays separately as runtime
evidence. Neither string by itself proves quality, billing, or wider compatibility.

The API key remains server-process environment only. Do not place it in the browser,
URL, command line, OpenClaw config, logs, or this runbook; do not shell-source or
inspect `.env`. Runtime calls are bounded and may fail or take time. The UI reports
loading and bounded error codes but does not promise a whole workflow completes in
90 seconds.

## HTTP boundary

The server accepts only its exact `127.0.0.1:<port>` Host. Every mutation requires an
exact same-origin `Origin`; missing or conflicting values are rejected before document
normalization or runtime calls. Responses use
no-store, framing, MIME-sniffing, referrer, and content-security headers.

Available routes are deliberately closed:

| Method | Route | Result |
| --- | --- | --- |
| `GET` | `/` | fixed static application page |
| `GET` | `/api/corpus` | selected sources/topics and runtime status, or valid empty selection |
| `POST` | `/api/documents` | normalize and atomically import one complete batch |
| `GET` | `/api/documents/<sha256:digest>` | one selected normalized/original/license view |
| `GET` | `/api/topics/<topic-N>` | one selected generated topic |
| `POST` | `/api/wiki` | server-authorized Wiki generation |
| `POST` | `/api/questions` | server-authorized course turn |

There is no generic file, directory, download, URL-ingest, root, shell, browser, or
credential route. Request bodies and encoded files are bounded before parsing or
normalization. Untrusted filenames, source text, license text, model text, and quotes
are inserted into the page with DOM `textContent`, not active HTML.

An absent `selected.json` is presented as empty only after the Task 2 corpus read
reaches that state on an existing prepared root. Missing/corrupt root state, a present
but broken selection, runtime/authorization failure, and `missingEvidence: true` are
separate outcomes.

## Focused offline verification

```bash
node --test test/course-wiki-server.test.js
node --check src/course-wiki-server.js
node --check scripts/course-wiki-poc.mjs
git diff --check
```

The controller owns the combined Task 1/2/3 test run, exact I/O inventory updates,
full `npm run check`, desktop/mobile browser QA, real acceptance questions, restart
persistence evidence, independent review, and release record. Offline UI tests and
native mechanism tests do not certify source correctness, model quality, production
readiness, or the AgentMo Discover → Plan → Produce lifecycle.
