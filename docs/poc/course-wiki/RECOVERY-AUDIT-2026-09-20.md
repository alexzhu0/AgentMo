# Course Wiki recovery audit — 2026-09-20

Status: incomplete. This record preserves the initial read-only investigation and
the later recovery handoff below. It is not a new design approval, runtime
authorization, or certification. This documentation update changes no production code.

## Required outcome

Operator-selected DOCX, Markdown and UTF-8 TXT documents become a persistent,
browsable Wiki and an OpenClaw material-grounded question-answering agent.
Ordinary conversation, topic switches, contextual follow-ups and missing evidence
must work. A fixed three-document demo does not fulfill document onboarding.

## 2026-09-28 isolated native definition — single-case PASS

The current native `definition` case passed one real OpenClaw turn, exact
source-line checks and separate semantic `focus`/`support` review. The provider
executed `small-select` then `answer`: two requests, two reservations, no retry.
This does not promote the other catalog cases. The saved artifact records
1/18 selected/executed/reviewed/passed and overall `incomplete`.

Startup was blocked by a stale immutable `controller-context.json.runtimeDigest`,
not by configuration or retry-setting drift. The old profile remains untouched;
host and both controllers now use `native-acceptance-contract-r4` under the same
accepted r3 corpus root. The Wiki generation and budget ledger are unchanged.
The isolated host was stopped after the case; user services were not altered.
Total conservative budget exposure is now CNY 47.12; CNY 52.88 remains.

Exact evidence paths, SHA-256 digests, verification limits and remaining work are
recorded in `release/2026.09.28.md`. The historical failures below are retained;
this fresh definition result supersedes only that case for this runtime digest.
Complete native/lifecycle acceptance, aggregate verification and user-entry
rollout remain outstanding. No formal AgentMo approval is implied.

## 2026-09-25 code-only acceptance integration (not live evidence)

The acceptance catalog now declares per-case small/large-corpus worst-case provider
request bounds. The controller preflights the selected route against the same shared
ledger, and compares each native turn's safe gateway stage/count event with the
ledger reservation delta. The supervised host's exclusive event log contains only
status, bounded failure code, stage names and request counts. A native failure after
one or more reservations is recorded as incomplete with bounded failure accounting;
unreconciled failure evidence remains non-passing. Failure-recovery evidence binds
the current message digest and session digest to the execution digest, while a
separate reviewer must mark the greeting's response type as `conversation`; the
native transport does not itself expose that internal type.

Deterministic acceptance, lifecycle, native-harness, turn, answer and behavior-evidence
suites passed 120/120 without a provider call. The broader seven-file non-paid runtime
suite exited 1 (140 total, 78 passed, 62 failed) because this sandbox refused
`127.0.0.1` loopback binds with `listen EPERM`; dependent assertions then failed.
This is not a live acceptance result or a product PASS/FAIL for those cases.
`npm run check` also stopped at the existing single-flight guard
(`AGENTMO_CHECK_ALREADY_RUNNING`). No r3 generation, shared budget, native profile,
service or user entry point was changed by this code-only work. Independent code
review, supervised isolated live cases, semantic review and redacted ledger evidence
remain required before this audit can be completed.

## Latest recovery handoff — partial evidence only

These observations supersede the initial gap status below where explicitly noted;
they do not turn the original investigation into an acceptance result.

Current checkpoint: R3 Wiki generation `2c9c3243-5df8-441a-954f-e3e4f6fcdf1d`
passed independent all-claim and 14/14 exact-quotation review. Native greeting and
zero-fee renamed duplicate-import passed; duplicate visibility was independently
checked in the actual document UI. Native capabilities still mislocated Wiki
browsing in chat. A separate, previously unexecuted definition question failed
with `COURSE_WIKI_MODEL_RESPONSE_INVALID` (one attempt/reservation, no answer),
so later questions remain unexecuted. Exact historical rejection branch is
unknown; no raw response was retained. The selected native prompt deterministically
omits the exact citation schema supplied in the generation path. A bounded
per-turn contract correction is in progress; accepted Wiki/bootstrap bytes remain
unchanged. New project reservations are 15 / CNY 4.65; total conservative reserved
exposure is CNY 44.33 with CNY 55.67 remaining. No rollout or paid automatic retry.

Fresh full check `32532` exited 1 (1,306 total, 1,115 pass, 95 fail, 41 cancelled,
55 skipped); later lanes did not run. Package closure diagnosis found one admitted
generic library unreachable from declared roots. The exact one-library-root fix
passed independent review, focused package checks, doctor 19/19 and I/O inventory
24/24. Node 20 evidence was freshly reproduced after that fix and published
byte-identically; post-publication checks passed 17/17. Another complete aggregate
is still required. Earlier checkpoints below retain their original chronology.

- Selected-document generation mechanically produced browsable TXT, Markdown and
  DOCX topics. R1 failed independent semantic review for citation coverage and
  verb-phrase terminology. R2 corrected that terminology, but topic 3 still
  includes an example outside its selected citation ranges. Both semantic FAIL
  records remain retained; three generated topics are not a quality pass.
- The native runner's `meta.stopReason` envelope compatibility correction passed
  independent review. Installed-native characterization with a synthetic provider
  passed with one synthetic call in about 2.9 seconds. This establishes the bounded
  transport shape, not conversation quality.
- The real r2 native batch selected eight cases: greeting PASS, capabilities FAIL
  because known supported formats were not explained, then six stopped without
  execution. Sanitized evidence is `live-native-r2-01.json` under
  `.superpowers/sdd/2026-09-20-course-wiki-recovery/`. This is not 18 passing cases.
- A capability-bootstrap correction and a second, citation-first generation-prompt
  correction are in progress. Neither is recorded as PASS at this handoff.
- At this handoff, nine new project request reservations total CNY 2.79. With
  CNY 39.68 conservatively reserved legacy capacity, total reserved exposure is
  CNY 42.47 and CNY 57.53 remains under the CNY 100 cap. These are reservations,
  not a provider invoice; failures are not refunded and generations share the budget.
- The formal Discover → Plan → Produce chain remains unadmitted. User services on
  ports 18789/17893 are unchanged. Owned r2 test services on 17894/17895 have not
  been rolled out to those user entry points.
- The controller reported focused whole-POC session `55984` completed with 249/249
  tests passing, exit 0. That run predates the Task 9 two-string runtime correction;
  it does not verify that later change.
- Full `npm run check` session `61194` exited 1. Its truncated output visibly
  includes the maintained-documentation host-specific POSIX-path failure; the
  available output does not establish that this was the only failure. Later
  fail-fast aggregate lanes were not executed. No full-gate PASS is claimed.
- The documentation-path failure was independently reproduced by
  `node --test test/command-docs.test.js` (10/11 pass, exit 1). Replacing the two
  host-specific documentation paths with portable descriptions made the same
  suite pass 11/11, exit 0; no tests were changed. Full check was not repeated.

Evidence ledgers in `.superpowers/sdd/2026-09-20-course-wiki-recovery/` include
`live-wiki-semantic-review.md`, `live-wiki-semantic-review-r2.md`,
`task-6-native-shape-fix-report.md`, and `task-6-native-shape-fix-review.md`.
The fresh Node 20 evidence remains the separate bounded core result recorded in
`release/2026.09.20.md`, not private-POC or semantic certification.

Remaining work: verify the in-progress corrections; complete independent Wiki
and native conversation quality acceptance; execute the remaining approved
native/lifecycle cases with honest stopped/not-executed accounting; complete fresh
aggregate verification after the documentation repair; complete final review and
the planned user-entry rollout.
No additional gates or runtime permission are created by this handoff.

## Initially verified gaps (historical investigation)

| Requirement | Evidence at initial audit | Conclusion |
| --- | --- | --- |
| Import selected documents in the usable live flow | `src/course-wiki-server.js` rejects live `POST /api/documents`; `authorizedCorpus` in `src/course-wiki-openclaw.js` admits exactly three pinned source digests | Incomplete; do not silently remove the existing data authorization boundary |
| Answer the current question | `validateGrounded` checks Chinese text, citation integrity and missing-evidence shape, not relevance to the current input | Authentic citations cannot establish answer relevance |
| Greetings and capability explanation | Workspace AGENTS and transport contract define only grounded-answer and missing-evidence branches | No explicit ordinary-conversation behavior |
| Meaningful multi-turn acceptance | Gateway test preserves history but returns the same mocked answer for its follow-up | Transport test, not semantic acceptance |
| Useful failure diagnosis | Gateway catch maps every bounded error to HTTP 400 `invalid_request_error` | Model-output failures and request-schema failures are conflated |

## OpenClaw research

Installed distribution inspected in `dist/` beneath the local OpenClaw package
installation root (`<openclaw-install-root>/dist/`):

- `context-engine-maintenance-DjJBGqjx.mjs`, `mergeOrphanedTrailingUserPrompt`:
  previous unfinished user text can be prepended to the active prompt, with an
  explicit context-only marker. This is a possible contributor, not proof that
  the observed stale reply traversed this branch.
- `builtin-openclaw-B-H-7lKk.mjs`, `resolveOrphanRepairPlan`: repair applies when
  the relevant trailing message is a user message.

References:

- https://docs.openclaw.ai/concepts/context
- https://github.com/openclaw/openclaw/issues/79614

The issue describes a similar symptom in a different version/channel and is closed
as not planned. It is not a verified upstream fix for this POC. Do not install an
unverified guard plugin or clear user history to conceal the failure.

## Initial verification performed

`node --test --test-name-pattern='gateway requests preserve conversation|model JSON' test/course-wiki-gateway.test.js`

Exit 0; one matched test, one pass. HTTPS model responses were mocked by that test;
no real provider invocation. This proves only the selected existing mechanism test.

## Initial evidence and decisions (historical investigation)

### Existing AgentMo seams verified

- `src/design-plan.js`, `buildTraceGraph`: links each requirement to an eval case.
- `src/build-contract.js`, acceptance-case projection: currently projects the generic
  expectation `bounded-evidence-or-explicit-gap`; that is not a concrete conversation
  rubric or executable behavioral test.
- `src/domain-eval.js`, `buildDomainEval` / `buildCaseResult`: validates admitted
  artifacts, required case-class coverage, supplied scores/pass flags and hard
  failures. It does not run a conversation or independently judge the answer.
- `src/delivery-report.js`: validates optional domain evaluation and carries its
  bounded certification result. Reusing this aggregation is appropriate; simply
  generating passing case flags would not establish real-entry behavior.

Consequently the missing piece is evidence-producing behavioral evaluation with
explicit rubrics, not another report aggregator. Its design still needs review.

1. Locate the message boundary at which latest-input focus is lost. Retain only
   bounded structural diagnostics, not raw requests, transcripts or credentials.
2. Review the conversation/grounded-answer separation before changing the protocol.
3. Define an explicit selected-document data authorization flow rather than extending
   the historical sample campaign implicitly to arbitrary uploaded data.
4. Reuse AgentMo domain-case/evaluation and delivery mechanisms where appropriate;
   require independent real-entry behavioral evidence, not a second success flag.
5. Acceptance must include greeting, definition, follow-up, topic switch, recovery
   after failure, absent evidence, document import, Wiki persistence and restart.

No commit, push, dependency installation, service reconfiguration or live API calls
were performed for the initial read-only audit or this documentation update. The
later recovery execution is reported separately above. The overall goal remains
active and unachieved.
