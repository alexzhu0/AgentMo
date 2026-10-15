# Course Wiki Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver selected-document Wiki and usable native OpenClaw QA, with evidence-producing behavioral acceptance integrated into AgentMo.

**Architecture:** Keep OpenClaw chat and memory-wiki. Repair the existing adapter and document lifecycle, then feed reviewed behavioral results into existing domain evaluation. Preserve separate claims for POC usability and formally authorized AgentMo stage completion.

**Tech Stack:** Node.js >=20, node:test, existing macOS DOCX utilities, installed OpenClaw, DeepSeek; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-course-wiki-recovery-design.md` (user reviewed 2026-09-20).

## Global Constraints

- Work only in the designated `course-wiki` Git worktree (`.worktrees/course-wiki` relative to the main repository); preserve existing uncommitted changes.
- 单用户、单活动知识库、本地受监督运行。
- 每批 1–10 个文件，每文件最多 2 MiB，提取正文合计最多 100,000 字符。
- DOCX, Markdown, UTF-8 TXT only; no DOC/PDF/PPT/OCR/audio/video.
- 人民币 100 元是累计费用上限，不是每次或每个新 workspace 的额度。
- No automatic paid retries, new dependencies, OpenClaw distribution edits, commit, push or publication.
- Never read `.env`, credential-bearing state or retain raw transcripts/provider bodies in evidence.
- Current exact sample authorization must not silently become arbitrary-document authorization.
- Design approval does not approve formal Discover/Plan/Produce/install gates.
- Use Ponytail's minimal-change workflow alongside TDD; preserve safety and provenance checks.
- Each task records RED, GREEN, files changed and exact exit codes. No per-task commits are authorized.

## Review Focus

1. Failed old turn followed by a short greeting must not resurrect the old task — Tasks 1/2/7.
2. Identical bytes under another filename must not create a duplicate billable corpus — Task 4.
3. An in-flight answer during corpus replacement must retain its original source identity — Task 4.
4. Chinese queries over large English documents must not turn retrieval misses into whole-library absence claims — Task 5.
5. Restart after a failed activation or pending semantic review must not manufacture a success result — Tasks 4/6/7.

## Ownership and sequence

Controller owns integration and live-entry acceptance. Worker A owns document lifecycle/UI (Tasks 3/4), worker B owns behavior evidence (Task 6). Controller owns Tasks 1/2/5/7. Run Task 6 alongside Tasks 3/4 only after interface agreement. `src/course-wiki-openclaw.js` and budget integration are serial shared-file work: one writer at a time. Review each deliverable independently before dependent work begins; reviewers do not implement their own findings.

Tasks form one vertical slice, not three new subsystems. Do not spawn additional user-owned tasks or rebuild unrelated AgentMo components.

## File responsibilities

- Existing `src/course-wiki-openclaw.js`: native operations, selected corpus, workspace integration.
- Existing `src/course-wiki-gateway.js`: authenticated transport and error presentation.
- New `src/course-wiki-answer.js`: pure response contract and citation selection validation, extracted only from affected code.
- New `src/course-wiki-corpus.js`: selected-document authorization and immutable corpus generation identity.
- Existing `src/course-wiki-budget.js`: shared cumulative accounting and bounded upstream requests.
- Existing `src/course-wiki-server.js`, `docs/poc/course-wiki/index.html`: document UI, not replacement chat.
- New `src/behavior-evidence.js`: domain-neutral execution/review evidence validation and conversion to existing case rows.
- New `scripts/course-wiki-acceptance.mjs`: course-specific native execution and sanitized evidence collection.
- Existing tests plus `test/course-wiki-answer.test.js`, `test/course-wiki-corpus.test.js`, `test/behavior-evidence.test.js`.

### Task 1: Verify message boundaries without exposing content

**Files:** `src/course-wiki-gateway.js`, `src/course-wiki-openclaw.js`, `test/course-wiki-gateway.test.js`, recovery audit.

**Interfaces:** Optional injected diagnostic callback receives `{caseId, boundary, roles, lastUserDigest, lastUserBytes, queuedContextMarkerPresent}`. Callback failure must not alter outcomes. Default off; caseId is an operator-owned fixture ID, never text derived from user input.

- [ ] Add a failing test for structural-only diagnostics on a synthetic failed-turn→greeting history. Assert exact keys and unchanged request messages.

```js
assert.deepEqual(event.roles, ['system', 'user', 'assistant', 'user']);
assert.equal(event.lastUserBytes, Buffer.byteLength('你好'));
assert.equal(JSON.stringify(event).includes('你好'), false);
assert.deepEqual(forwarded.messages.slice(1), supplied.messages.slice(1));
```

- [ ] Run `node --test test/course-wiki-gateway.test.js`; confirm the new assertion fails for missing diagnostics, not fixture setup.
- [ ] Implement digest/length computation at adapter ingress and pre-provider boundaries using node:crypto. Do not read arbitrary session files. Do not parse the last line as the user's question.
- [ ] Run the same test and a callback-throws test to GREEN.
- [ ] In the existing budget, run one controlled public-input sequence through a fresh native session and one failure-containing test session. Compare with known submitted fixture inputs; observe displayed outcome without retaining raw transcript. No automatic reruns.
- [ ] Record whether newest input reaches the provider unchanged. If it does not, stop behavioral remediation at the failing boundary and revise the proposed fix; do not claim orphan repair as the cause without evidence.

### Task 2: Separate conversational behavior and bounded failures

**Files:** new answer module/test; existing openclaw/gateway modules and tests; `docs/poc/course-wiki/workspace/AGENTS.md`.

**Interfaces:** `validateCourseAnswer(value, documents)` returns `{kind, answer, citations}`; kind is `conversation | grounded | insufficient_evidence`. Citations are materialized from existing source selections. Wiki topic validation remains distinct. `courseFailureStatus(code)` maps input errors→400, upstream/output errors→502, budget exhaustion→429; safe bounded codes only.

- [ ] Write RED tests for greeting without citations, grounded answer without citations, unsupported kind, mixed citation/missing-evidence fields, forged sources, and model JSON errors not masquerading as request schema errors.

```js
assert.equal(validateCourseAnswer({kind:'conversation',answer:'你好，请问想了解哪份材料？',citations:[]}, []).kind, 'conversation');
assert.throws(() => validateCourseAnswer({kind:'grounded',answer:'教材中的定义。',citations:[]}, []));
assert.equal(courseFailureStatus('COURSE_WIKI_MODEL_JSON_INVALID'), 502);
```

- [ ] Run `node --test test/course-wiki-answer.test.js test/course-wiki-gateway.test.js`; establish RED.
- [ ] Extract the affected validator, enforce exact allowed fields and existing Chinese/text/citation bounds. Use a discriminator switch; no general semantic-certification claims or greeting-only regex workaround.
- [ ] Update workspace/transport instructions together: newest explicit request controls the task; history supports referents; conversational responses cannot contain substantive unsupported teaching answers. Keep exact workspace checks and migrate only this known template.
- [ ] Preserve all prior source validation tests. Mock outputs must differ for each follow-up test; test transport and semantic live evaluation remain separately labeled.
- [ ] Run answer/gateway tests to GREEN; verify failed request stays charged once and the next distinct request remains admissible.

### Task 3: Bind selected-document consent and cumulative cost

**Files:** new corpus module/test; budget module/test; script launcher; server tests.

**Interfaces:** `corpusIdentity(documents)` → stable digest over sorted source digests, independent of display filenames. `validateCorpusConsent(consent, {corpusDigest, provider})` accepts only exact `{version:1, corpusDigest, provider:'deepseek', purpose:'wiki-and-qa', confirmed:true}`. Consent is written only by an explicit operator confirmation endpoint after preview, never by a model or upload alone.

- [ ] Write RED tests for absent/wrong-digest/wrong-provider consent, duplicate content with alternate names, changed material invalidating consent, and no provider call before confirmation.

```js
assert.equal(corpusIdentity([docA, docB]), corpusIdentity([docB, docA]));
assert.throws(() => validateCorpusConsent(consent, {corpusDigest:changedDigest,provider:'deepseek'}));
assert.equal(providerCallsBeforeConfirmation, 0);
```

- [ ] Run corpus/budget/server tests and confirm intended RED.
- [ ] Implement canonical identity and exact consent validation. Preserve legacy sample campaigns without rewriting their historical bytes.
- [ ] Bind every new corpus generation to one operator-selected project budget root, not a fresh budget per upload. Reconcile historical reservations value-blind before allocating any new requests; absence/ambiguity blocks new allocation.
- [ ] Keep the total cap at 10,000 fen minus prior reservations. Preserve exclusive pre-request reservation and no refund on failed/uncertain calls. Verify current official maximum input/output pricing before retaining the existing 31-fen reservation; if insufficient, raise reservation within the unchanged total cap, never underestimate.
- [ ] Test simultaneous reservations, process failure after reservation, forged budget references, and reimport/restart without reset. Run tests to GREEN. Do not dump credentials or provider responses.

### Task 4: Stage and activate complete document versions

**Files:** corpus/openclaw/server modules; document page; corresponding corpus/openclaw/server tests.

**Interfaces:** `stageCourseCorpus({root, documents})` → `{corpusDigest, generationId, sources}` (local only); `activateCourseCorpus({root, generationId, consent})` → `{generationId, corpusDigest}` only after Wiki/workspace readiness. Active pointer identifies immutable generation. Existing `runCourseGatewayRequest` pins generation for the entire request under the shared operation lock.

- [ ] RED tests: all three formats; unchanged corpus returns existing result; failed native ingest/compile/lint/generation keeps old active pointer; concurrent request cannot mix sources; restart after incomplete stage uses old complete generation.

```js
assert.equal(afterFailedActivation.generationId, before.generationId);
assert.deepEqual(inFlightAnswer.sourceDigests, originalSourceDigests);
assert.equal(repeatedImport.corpusDigest, firstImport.corpusDigest);
assert.equal(repeatedImportProviderCalls, 0);
```

- [ ] Run corpus/openclaw/server tests and capture RED.
- [ ] Reuse current staged import and no-follow checks. Generate workspace per generation; publish one active pointer only after all required outputs validate. Do not mutate files used by the old active generation. Failed stages are non-active and cannot be selected automatically.
- [ ] Replace permanent `requireUnprovisioned` limitation with serialized generation publication. Before switching the course-wiki runtime view, prevent new requests from entering, drain existing request, verify the prepared view, switch, then reopen admission; preserve prior view on failure. Do not touch other agents or erase history.
- [ ] UI shows preview, explicit model-use confirmation, generating/failed/active states, source and Wiki browsing, and native chat link. Remove the misleading live-upload blanket prohibition only when the new consent flow is enforced. Keep host/origin checks.
- [ ] Run tests to GREEN; browser-check import and failure state without external API using the existing mocked lane.

### Task 5: Bounded native retrieval and variable-size Wiki

**Files:** openclaw module/tests, workspace template, budget integration tests.

**Interfaces:** `selectCourseEvidence({root, generationId, messages, liveAuthorization})` → `{documents, coverage:'complete'|'retrieved', sourceDigests}`. Only normalized, authorized source ranges may be returned. Reuse native search/get and existing Chinese-query translation, not new vector infrastructure.

- [ ] RED tests for >3 documents, one-document corpus, Chinese question over English material, cross-source question, empty retrieval, source spoofing and evidence request exceeding wire budget.

```js
assert.equal(emptySelection.coverage, 'retrieved');
assert.equal(emptySelection.documents.length, 0);
assert.equal(Buffer.byteLength(finalProviderWire) <= 48 * 1024, true);
assert.deepEqual(crossSourceAnswer.sourceDigests.sort(), expectedDigests.sort());
```

- [ ] Run `node --test test/course-wiki-openclaw.test.js test/course-wiki-gateway.test.js`; establish RED.
- [ ] Stop injecting all source text into MEMORY. Keep rules and a bounded source/Wiki directory; verify selected source bodies from native get against stored originals before sending.
- [ ] Resolve follow-up retrieval using conversation context without replacing the active question with a historical one. Missing search hits produce a limited “not found in current retrieved evidence” answer, not a claim about the full library.
- [ ] Generate bounded themes in per-source batches, preserving source coverage metadata; no exact-three-theme condition. Each generation request is separately reserved. Keep results staged until every required batch validates; no partial publication or silent truncation.
- [ ] Run focused tests to GREEN. For unsupported request size, return a clear bounded limit before spending rather than raising all limits silently.

### Task 6: Produce reviewed behavioral evidence for AgentMo

**Files:** new behavior module/test; acceptance script; `docs/poc/course-wiki/acceptance-cases.json`; existing domain-eval/delivery tests; `package.json` and artifact inventory tests if public module ownership changes.

**Interfaces:** `buildBehaviorCaseResult({caseId, caseClass, execution, review})` → existing domain-cases row `{id,caseClass,passed,score,threshold,hardFailureIds,evidenceRefs}`. `execution` carries test identity, input/output digests, generation/runtime identity, mechanical checks and evidence digest; `review` binds the same execution digest, reviewer ID, rubric checks and pass/fail. Missing review returns failed/pending evidence, never success. No course-specific semantics in the generic module.

- [ ] RED tests for unexecuted cases, wrong generation, review bound to another run, missing review, mandatory rubric failure, stale evidence and attempted raw transcript persistence.

```js
assert.equal(buildBehaviorCaseResult({caseId:'greeting',caseClass:'conversation',execution,review:null}).passed, false);
assert.throws(() => buildBehaviorCaseResult({caseId:'greeting',caseClass:'conversation',execution,review:wrongRunReview}));
assert.equal(buildBehaviorCaseResult({caseId:'greeting',caseClass:'conversation',execution,review:failedReview}).score, 0);
```

- [ ] Run `node --test test/behavior-evidence.test.js test/domain-eval.test.js test/delivery-report.test.js`; capture RED.
- [ ] Implement exact field checks and binary score/threshold (0 or 1, threshold 1) using existing persistability/evidence reference conventions. Do not treat output digest or model self-score as correctness proof.
- [ ] Define case rows for every spec acceptance-table entry. Acceptance script drives controlled native sessions sequentially, keeps raw answers transient for independent review, stores only sanitized checks/digests, and stops a failed paid batch without automatic reruns.
- [ ] Connect case classes to the Course Wiki blueprint requirement/eval mapping when that blueprint is independently admitted. Exercise the existing domain-eval and delivery consumption with deterministic fixtures; real full-chain status remains incomplete without its own exact admitted artifacts.
- [ ] Add packed artifact ownership/syntax coverage for shipped generic code, without packaging private POC runtime state. Run focused tests to GREEN.

### Task 7: Independent native acceptance and complete verification

**Files:** RUNBOOK, recovery audit, `release/2026.09.20.md`, `release/README.md`; sanitized local acceptance evidence. Integration repairs only against specific failing cases.

- [ ] Verify current installed version and adapter/config compatibility value-blind before service changes. Preserve unrelated agent settings. Coordinate a bounded course-wiki service transition; no autostart installation.
- [ ] Execute the approved acceptance matrix on fresh public nonsensitive DOCX/MD/TXT material. First confirm dataset use in the new UI. Require greeting, definition, follow-up, topic switch, ambiguity, missing evidence, one controlled failure followed by recovery, cross-file answer, update, duplicate, restart and injection checks.
- [ ] Independently review visible native UI answers and evidence supporting their claims. Record FAIL for safe parsing rejection where a usable answer/refusal was required. No raw transcript in reports.
- [ ] Run all course tests and behavior/domain/delivery tests, then one `npm run check` under existing single-flight rules. Observe the live handle to completion; do not restart solely because a poll timed out.

```sh
node --test test/course-wiki-*.test.js test/behavior-evidence.test.js test/domain-eval.test.js test/delivery-report.test.js
npm run check
git diff --check
```

- [ ] If new owned modules alter Node20 syntax coverage, update repository-owned producer manifest and generate a fresh trusted receipt to an absent path using `scripts/node20-core-lane.sh`; publish exact successful bytes and run consumers. Never use consumers as producer inputs or change the trust anchor. If Stage2 files change, run documented Stage2 contract set and `node --test test/design-plan.test.js`.
- [ ] Independent final reviewer checks changed files, full gate exit codes, runtime/dataset identity, costs, case coverage and preservation of old state. Fix→focused retest→fresh affected aggregate evidence; do not silently suppress failures.
- [ ] Update status separately for fixed-sample demo, document POC and formal AgentMo chain. Handoff includes exact native entry, supported formats, limitations and remaining gates. Do not mark the active goal complete while any required claim lacks direct evidence.

## Self-review and execution handoff

Spec sections 1/2 are covered by Tasks 3–7; message tracing by Task 1; answer behavior by Task 2;
data consent/versioning by Tasks 3/4; retrieval/Wiki by Task 5; AgentMo behavior evidence by Task 6;
all mandatory acceptance rows, security/cost/restart checks and release evidence by Task 7.
The five Review Focus conditions each have explicit owning tests above.

Recommended execution: subagent-driven with serial integration of shared files. User requested
multi-session coordination; preserve that method. After plan approval, use
superpowers:subagent-driven-development. Do not begin implementation merely because the design
was approved. No commit steps are included because repository/user constraints prohibit them.
