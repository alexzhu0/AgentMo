# Phase 3: 经批准研究到 Build Contract - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 30 proposed production/test files or inventory surfaces
**Analogs found:** 30 / 30

## File Classification

| New/Modified File | Role | Data Flow | Closest AgentMo Analog | Match Quality |
|---|---|---|---|---|
| `src/discovery-live.js` | service/orchestrator | request-response + batch | `src/discovery-source-workspace.js` (`buildDiscoveryWorkspace`, `prepareDiscoveryWorkspace`) | exact role, different intake |
| `src/discovery-live-transport.js` | service/adapter | streaming | `src/discovery-source-workspace.js` (`normalizeSourceIntakeIo`, retained-handle reads) | data-flow match |
| `src/discovery-provenance.js` | utility/model | transform | `src/artifact-admission.js` (`digestRawBytes`, `admittedArtifactProvenance`) + `src/source-refs.js` | exact primitives |
| `src/discovery-approval.js` | model/service | request-response | `src/artifact-admission.js` + `src/design-plan.js` source provenance | exact binding pattern |
| `src/decision-ledger.js` | model/service | event-driven/append-only | `src/builder-immutable-journal.js` | exact data-flow |
| `src/build-contract.js` | model/service | transform | `src/design-plan.js` + `src/runtime-plan.js` | role match |
| `src/plan-approval.js` | model/service | request-response | `src/artifact-admission.js` + `src/design-plan.js` | exact binding pattern |
| `src/collectors/web.js` | provider adapter | streaming/request-response | `src/discovery-source-workspace.js` source adapter seam | role match |
| `src/collectors/github.js` | provider adapter | request-response/batch | `src/discovery-source-workspace.js` source adapter seam | role match |
| `src/collectors/arxiv.js` | provider adapter | request-response/transform | `src/discovery-source-workspace.js` source adapter seam | role match |
| `src/cli.js` | controller/CLI | request-response | existing `discover-workspace` and `design-plan` branches | exact |
| `src/discovery.js` / `src/artifact-contract.js` | config/model | transform | current discovery manifest validator and `DISCOVERY_MANIFEST_CONTRACT` | exact |
| `src/design-plan.js` | service/model | transform | current `buildDesignPlan` exact-input construction | exact modification |
| `src/blueprint-draft.js` | service/model | transform | current draft provenance construction | exact modification, unsafe status field noted |
| `src/artifact-registry.js` | registry/config | transform | `DURABLE_ARTIFACT_REGISTRY` | exact |
| `src/artifact-subjects.js` | registry/config | request-response | `DURABLE_COMMAND_SUBJECTS` | exact |
| `package.json` + CLI/help/docs/I/O inventories | config | batch/closure | `test/artifact-surface-coverage.test.js`, `test/command-docs.test.js`, `test/helpers/io-surface-inventory.js` | exact |
| `test/discovery-live.test.js` | test | streaming/request-response | `test/discovery-source-workspace.test.js` | exact role |
| `test/discovery-live-security.test.js` | security test | streaming/request-response | `test/discovery-source-workspace.test.js` fail-closed matrix | exact role |
| `test/discovery-approval.test.js` | contract/security test | request-response | `test/artifact-admission.test.js` | exact |
| `test/decision-ledger.test.js` | durability/security test | event-driven/append-only | `test/builder-immutable-journal-v1.test.js` | exact |
| `test/build-contract.test.js` | contract test | transform | `test/design-plan.test.js` | exact role |
| `test/openclaw-build-contract.test.js` | contract test | transform | `test/scaffold.test.js` + `test/runtime-compatibility.test.js` | role match |
| `test/openclaw-resource-projection.test.js` | closure/inventory test | transform | `test/scaffold.test.js` + `test/artifact-surface-coverage.test.js` | exact invariant style |
| `test/phase3-contracts.test.js` | CLI integration test | request-response | `test/stage-contracts.test.js` | exact |
| `test/artifact-contract.test.js` | contract test | transform | existing discovery/user-need contract cases | exact modification |
| `test/artifact-subjects.test.js` | registry test | request-response | existing command subject matrix | exact modification |
| `test/artifact-surface-coverage.test.js` | closure test | batch | `CLI_OUTPUT_OWNERS` exhaustive equality | exact modification |
| `test/command-docs.test.js` | docs/CLI closure test | batch | existing command/help inventory | exact modification |
| `test/helpers/io-surface-inventory.js` | test registry/config | batch | existing explicit source/sink allowlist | exact modification |

## Pattern Assignments

### `src/discovery-live.js` (service/orchestrator, request-response + batch)

**Primary analog:** `src/discovery-source-workspace.js`

Copy the separation used by `buildDiscoveryWorkspace`: construct all canonical records in memory, accumulate bounded checks, derive canonical DB/facts/cards/chunks, and return a candidate without publishing during intake. Keep transport injected into the builder just as workspace intake accepts an injected `sourceIntakeIo`.

**Whole-set preflight before the first output** (`src/discovery-source-workspace.js:986-1001`):

```javascript
function prepareDiscoveryWorkspace(workspace) {
  assertPersistable(workspace, { subject: "discovery-workspace" });
  const factsJsonl = serializeDiscoveryJsonl(facts, "discovery-facts");
  const sourceChunksJsonl = serializeDiscoveryJsonl(sourceChunks, "discovery-source-chunks");
  if (workspace.factsJsonl !== factsJsonl || workspace.sourceChunksJsonl !== sourceChunksJsonl) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_CANDIDATE_MISMATCH");
  }
  return {
    discoveryDbText: serializePersistableJson(workspace.discoveryDb, { subject: "discovery-db" }),
    factsJsonl,
    coverageText: serializePersistableJson(workspace.coverage, { subject: "discovery-coverage" }),
    sourceCardsText: serializePersistableJson(workspace.sourceCards, { subject: "discovery-source-cards" }),
    sourceChunksJsonl,
  };
}
```

**Publication pattern** (`src/discovery-source-workspace.js:232-244`): call one preflight function before any writer. For Phase 3 strengthen this analog: preflight proves candidate safety, but the five independent atomic renames are not atomic as a set. `discover-live` must publish through a new absent staging/root transaction or otherwise prove that a later write failure leaves zero committed success set.

**Do not copy:** `buildDiscoveryDb` turns manifest `extraction_fields` into `extraction_field` facts. Live records must be body-derived `source_chunk`/retrieval records and must not upgrade declared trust into collected confidence.

### `src/discovery-live-transport.js` (transport, streaming)

**Primary analog:** `src/discovery-source-workspace.js:974-983` and retained-handle intake tests.

Copy the narrow injected-interface validation:

```javascript
function normalizeSourceIntakeIo(value) {
  const sourceIntakeIo = value ?? DEFAULT_SOURCE_INTAKE_IO;
  if (
    typeof sourceIntakeIo?.lstat !== "function"
    || typeof sourceIntakeIo?.open !== "function"
    || typeof sourceIntakeIo?.realpath !== "function"
  ) {
    throw new TypeError("Discovery source intake I/O adapter is invalid.");
  }
  return sourceIntakeIo;
}
```

The live transport interface should be similarly closed and minimal: request URL, abort signal, redirect mode; response status, bounded headers, URL, and byte stream. Production CLI must never accept a module path or caller transport override.

Copy the adversarial retained-source test style from `test/discovery-source-workspace.test.js:597-678`: mutate the pathname/source after the retained handle opens and grow it during reading. Translate this to chunked HTTP, missing/lying `content-length`, timeout, abort, and redirect changes.

**Do not copy:** `response.text()`, default redirect following, header-only size checks, automatic retry, or a transport that owns allowlist policy. Policy belongs to `discovery-live.js`; transport only performs the bounded request.

### `src/discovery-provenance.js` (utility/model, transform)

**Primary analogs:** `src/artifact-admission.js` and `src/source-refs.js`.

**Digest exact retained bytes before parsing** (`src/artifact-admission.js:59-62`, `92-112`):

```javascript
export function digestRawBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_BYTES_REQUIRED");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const bytes = await readBoundedArtifact(options?.filePath, maxBytes, options?.openInput ?? open);
const actualDigest = digestRawBytes(bytes);
if (!sameDigest(actualDigest, expectedDigest)) {
  throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_MISMATCH");
}
```

For retrieval, compute `contentDigest` from the exact bounded response `Buffer`; only afterward decode, redact, normalize, and summarize. Persist the digest and bounded derivatives, never raw response bytes.

**URL/ref validation basis** (`src/source-refs.js:53-63`): use `new URL`, reject credentials, and return bounded codes. Phase 3 must be stricter than this analog: live collection is HTTPS-only, while `validateSourceRefs` currently accepts both HTTP and HTTPS.

### `src/discovery-approval.js` and `src/plan-approval.js` (exact approval artifacts)

**Primary analogs:** `src/artifact-admission.js`, `src/design-plan.js`.

Copy the provenance tuple shape and authentic-admission requirement from `admittedDesignPlanSource` (`src/design-plan.js:204-218`):

```javascript
return {
  discoveryDb: admittedArtifactProvenance(admissions.discoveryDb, {
    subject: "discovery-db",
    value: discoveryDb,
  }),
  userNeed: admittedArtifactProvenance(admissions.userNeed, {
    subject: "user-need",
    value: userNeed,
  }),
};
```

Copy exact-shape validation (`src/design-plan.js:221-249`): require only `identity`, `subject`, and `digest` in each binding, require a canonical subject/identity, and require `sha256:<64hex>`.

- `agentmo.discovery-approval.v1` binds exactly admitted manifest bytes and derived discovery DB bytes.
- `agentmo.plan-approval.v1` binds exactly admitted blueprint bytes and build-contract bytes.
- Downstream commands re-admit all bound artifacts; approval fields are not trusted without byte recomputation.
- Approval is an explicit operator decision scoped to one transition, not authenticated organizational authority.

**Do not copy:** boolean approval inside the object being approved, caller-supplied parsed-object hashes, session ancestry, or any generated `ok`/`reviewed` field as authority.

### `src/decision-ledger.js` (append-only model/service, event-driven)

**Primary analog:** `src/builder-immutable-journal.js`.

Copy predecessor-bound canonical bytes and digest-derived publication identity (`src/builder-immutable-journal.js:120-150`, `769-780`):

```javascript
const valueDigest = digestRawBytes(normalized.canonicalBytes);
publication = desired.sequence === 0
  ? { bytes: normalized.canonicalBytes, digest: valueDigest, name: normalized.basename }
  : buildSuccessorPublication(normalized, desired.sequence, desired.predecessorDigest, valueDigest);

const entry = {
  schemaVersion: IMMUTABLE_JOURNAL_ENTRY_SCHEMA_VERSION,
  sequence,
  predecessorDigest,
  valueDigest,
  valueBase64: normalized.canonicalBytes.toString("base64"),
};
```

Copy head/lineage validation (`src/builder-immutable-journal.js:685-708`, `747-766`): sequence must be contiguous, every predecessor digest must match the previous admitted entry, and append must bind the current authentic head.

Use typed payloads (`fact`, `inference`, `unknown`, `rejected-option`, `human-decision`) with source/decision refs. Reuse the append-only primitive if its generic API fits; do not reimplement crash consistency.

**Do not copy:** `valueBase64` as permission to embed raw transcripts. Ledger payload schemas must reject transcript/tool-body/stdout/stderr fields and remain persistability-bounded.

### `src/build-contract.js` (model/service, transform)

**Primary analogs:** `src/design-plan.js`, `src/runtime-plan.js`, `src/build-plan.js`.

Copy the Stage 2 constructor/validator/writer split:

- Construct only from authenticated admitted values (`src/design-plan.js:62-83`).
- Store exact source provenance and bidirectional trace edges, not host paths (`src/design-plan.js:84-118`).
- Validate exact required sections and referential closure before write (`src/design-plan.js:123-159`).
- Mark the candidate in a module-private `WeakSet` and refuse forged clones (`src/design-plan.js:119`, `192-200`).
- Preserve explicit certification boundaries (`src/design-plan.js:111-116`; `src/runtime-plan.js:89-95`).

Copy target feasibility vocabulary from `buildPlan` (`src/build-plan.js:30-47`) and `buildRuntimePlan` (`src/runtime-plan.js:59-100`): selected target/profile, operations, verification hints, unsupported surfaces, runtime identity, sandbox, permissions/environment descriptors, and evidence boundaries.

The Phase 3 contract must go beyond these analogs and require prompt/bootstrap files, skills, effective tools/policy, plugins/install lanes, memory-slot owner, RAG, storage, schedules, harness, loop/runtime binding, install/load/execute transitions, recovery, permissions, acceptance cases, evidence obligations, and Phase 3/4/5 owners. Every resource must project to a file, config/install/schedule operation, explicit unsupported record, or runtime evidence obligation.

**Do not copy:** digest-only `unsupportedSurfaceDigests` when the planner needs reviewable reasons/alternatives; declaration-only tool lists; or a generic “memory” field that omits slot ownership, corpus/index/storage/retention/restart behavior.

### Provider adapters: `src/collectors/web.js`, `github.js`, `arxiv.js`

**Primary analog:** the per-source adapter loop in `buildDiscoveryWorkspace` plus its common-card/common-chunk normalization.

All adapters return one common bounded provider result to the orchestrator; they do not write files and do not decide approval/confidence.

- `web.js`: exact approved HTTPS URL, manual bounded redirects, allowed content types, raw-byte digest then sanitized summary.
- `github.js`: explicit API version, serial bounded pagination, bounded `Link`/rate/ETag metadata, no token/header/body persistence.
- `arxiv.js`: metadata-first Atom normalization; do not persist full e-print bodies without a separately established license basis.

Copy stable ID derivation from `deriveDiscoveryRecordId` in `src/discovery-db.js`; copy evidence-field separation from workspace cards/chunks. Keep `declaredTrustLevel`, `evidenceClass`, provider provenance, retrieval status, and confidence rationale separate.

### Modified public/registry surfaces

#### `src/cli.js`

Copy the thin route in `src/cli.js:581-599`: parse, exact-admit, call domain builder, call writer, emit bounded output, set exit status. Copy argument parsing from `src/cli.js:2160-2187`; required subjects must come from `subjectsForCommand`.

For Plan, extend the exact multi-input admission sequence at `src/cli.js:614-633`; do not allow `design-plan` to consume an unapproved DB. New approval commands should preview first and write only after explicit approval input.

#### `src/artifact-subjects.js`

Copy the exhaustive command-to-subject map at lines 27-50 and exact provided/expected set comparison at lines 83-108. Add `discover-live`, discovery approval commands, approved `design-plan`, build-contract, and plan-approval commands with no optional bypass subject.

#### `src/artifact-registry.js`

Copy each durable descriptor record at lines 162-288: canonical subject, identity field/value, legacy behavior, validator, and companion subjects where context-bound. Register discovery approval, decision ledger, build contract, and plan approval; context-bound approval artifacts should declare exact required companions.

#### `src/artifact-contract.js` / `src/discovery.js`

Copy the explicit required-property schema style at `src/artifact-contract.js:7-94`. Version the live collector block; do not silently infer live execution from a URL in the current v1 fields. Preserve old local/manifest behavior.

#### Closure inventories

Copy exhaustive equality rather than “contains” assertions. `test/artifact-surface-coverage.test.js:431-460` enumerates every CLI output owner. Add every new command/sink/input to:

- `CLI_OUTPUT_OWNERS` in `src/cli.js`;
- package file list/scripts in `package.json`;
- durable artifact and command subject tests;
- `test/helpers/io-surface-inventory.js`;
- command help and docs inventory.

## Test Pattern Assignments

### `test/discovery-live.test.js`

Copy `test/discovery-source-workspace.test.js:597-678` for deterministic injected I/O and mid-read mutation. Inject a fake transport yielding controlled chunks/status/headers. Assert serial request order, count/byte/time/content-type enforcement, canonical requested/final URLs, body-derived SHA-256, sanitized summary, provider/evidence/confidence separation, deterministic reruns, and no raw payload field.

Copy the semantic boundary at `test/design-plan.test.js:94-118`: declared extraction fields cannot create `supported` coverage. Only admitted retrieved `source_chunk` evidence can support planning, and mechanical overlap must remain labeled non-semantic.

### `test/discovery-live-security.test.js`

Copy the fail-closed matrix style at `test/discovery-source-workspace.test.js:563-690` and secret assertions at lines 796-813. Include non-HTTPS, URL credentials, unapproved/manual redirect destination, private/DNS-rebinding target policy, missing/lying length, chunked oversize, timeout, abort, bad status, unsupported type, 403/429, secret-shaped body, malicious instructions, and output-candidate mismatch.

Strong invariant: a hostile case creates no committed successful artifact set and diagnostics contain no URL credentials, body, token, host path, or unbounded header.

### `test/discovery-approval.test.js`

Copy `test/artifact-admission.test.js:532-610`: success from exact bindings, then mismatched/missing/duplicate/unknown/malformed bindings fail with bounded codes and no output. Add stale summary/confidence/coverage/manifest cases because any raw-byte change must invalidate approval.

### `test/decision-ledger.test.js`

Copy `test/builder-immutable-journal-v1.test.js:130-155`: kill/restart at durable publication boundaries and converge to one exact head. Add wrong predecessor, fork, duplicate event/idempotency, tampered entry, dangling decision/source ref, raw transcript/tool body/stdout/stderr, secret-like payload, and bounded recovery tests.

### `test/build-contract.test.js`

Copy `test/design-plan.test.js:312-327` for deterministic bytes and exact source provenance, lines 329-411 for loader/identity/digest closure, and lines 414-449 for preflight-before-root plus forged-clone rejection.

Add forward and reverse trace closure for source ↔ requirement/capability/eval; mandatory feasibility/permission/trust/unsupported/alternative fields; lifecycle ownership; exact blueprint/ledger/discovery approval provenance; and plan-approval staleness.

### `test/openclaw-build-contract.test.js`

Copy the inspectable target inventory style from `test/scaffold.test.js:54-109`, but assert the contract resource graph rather than generated files. Require exact inspected OpenClaw source revision `29d018f0`, version `2026.6.11`, and compatible Node predicate. Assert one memory-slot owner, stable resource IDs, no secret values/absolute production paths, explicit install lanes, and Phase 3/4/5 ownership.

### `test/openclaw-resource-projection.test.js`

Copy exhaustive inventory equality from `test/artifact-surface-coverage.test.js:431-460`, not loose presence checks. For every prompt/skill/tool/plugin/memory/RAG/storage/cron/harness/loop/recovery resource, require exactly one projection disposition: generated file, config/install/schedule operation, unsupported record, or runtime evidence obligation. Reject missing, duplicated, and conflicting ownership.

### `test/phase3-contracts.test.js`

Copy the subprocess composition in `test/stage-contracts.test.js:178-268`: use exact file digests at every transition, assert bounded stdout, inspect canonical identities, and assert the exact file inventory. Update the expected blueprint semantics: the current assertion `design_contract.provenance.reviewed === true` at lines 249-253 is an unsafe legacy expectation and must become draft/non-authoritative until exact plan approval.

The Phase 3 flow must end at build contract + plan approval and must assert no Phase 4 package generation, target probe/mutation, install receipt, schedule application, or live runtime evidence.

## Shared Patterns

### Exact Raw-Byte Admission

**Source:** `src/artifact-admission.js:59-62`, `84-125`

**Apply to:** every manifest, discovery DB, approval, decision-ledger head/entry, blueprint, build contract, and plan approval transition.

One bounded read produces one retained `Buffer`; digest that buffer before UTF-8 decode/JSON parse, validate canonical identity/subject, deep-freeze, and mint authentic provenance. Never hash a reparsed/reserialized object.

### Preflight Before Output

**Source:** `src/discovery-source-workspace.js:986-1001`, `src/design-plan.js:192-200`

**Apply to:** all new durable outputs.

Serialize every candidate and JSONL line, compare any caller-supplied serialization with canonical serialization, run persistability/identity/ref validation, and only then create/publish output. Multi-file live discovery needs a stronger set-level commit than the existing sequential per-file writer.

### Secret and Raw-Material Boundary

**Source:** `src/persistability.js:113-133`; workspace security tests at `test/discovery-source-workspace.test.js:796-813`.

**Apply to:** retrieval records, failures, approvals, ledgers, build contracts, reports, CLI JSON/human output.

Durable artifacts may contain digests, `SecretRef`, presence, sanitized bounded summaries, and codes. They must not contain credentials, provider bodies, raw transcripts/tool bodies, auth/session state, or stdout/stderr previews.

### Exact Subject/Command Closure

**Source:** `src/artifact-subjects.js:27-108`; `src/artifact-registry.js:162-298`.

**Apply to:** every new command and durable identity.

CLI bindings, registry descriptor, artifact contract, loader, package list, help/docs, output ownership, and I/O inventory must change together. Unknown, missing, duplicate, and optional-bypass subjects fail closed.

### Trace and Certification Boundaries

**Source:** `src/design-plan.js:78-118`, `430-457`; `src/runtime-plan.js:89-95`.

**Apply to:** discovery coverage, build contract, approvals, OpenClaw projection.

Mechanical observations never certify semantic quality. A valid/approved build contract authorizes entry to Produce only; it does not prove installation, load, execution, domain quality, production readiness, or wider OpenClaw compatibility.

## Unsafe Analogs — Do Not Copy

| Existing Pattern | Why Unsafe for Phase 3 | Required Replacement |
|---|---|---|
| `src/discovery-db.js` creates `extraction_field` facts from manifest declarations | Declaration is not retrieved evidence | Body-derived retrieval records and `source_chunk` facts |
| `src/source-refs.js` permits `http:` | Live collection requires HTTPS-only | Reject non-HTTPS before transport |
| `writeDiscoveryWorkspace` performs sequential per-file atomic renames | A later failure can leave a partial set | Whole-set preflight plus set-level absent-root/staging publication |
| `src/blueprint-draft.js` / `test/stage-contracts.test.js:251` treat generated `reviewed:true` as reviewed | Generated output self-certifies human review | Draft/non-authoritative state plus exact external `plan-approval` |
| `src/scaffold-files.js` emits tool/memory/config guidance | Guidance is not effective runtime capability | Build contract must map effective owner/policy/install/load/execute/evidence |
| `src/runtime-plan.js` stores only digests for unsupported surfaces | Reviewer cannot inspect reason or alternative | Structured unsupported records with source refs, rationale, owner, alternative |
| Generic append-only payload bytes | Could preserve prohibited transcript/body material | Typed ledger schema + persistability/ref validation before append |
| Default redirect following / `response.text()` | Approval escape and unbounded allocation | Manual redirect validation and streamed `maxBytes + 1` enforcement |
| Manifest `trust_level` reused as confidence | Operator declaration is not retrieval verification | Separate declared trust, evidence class, retrieval status, confidence rationale |
| OpenClaw scaffold file presence | Does not prove plugin activation, effective tools, memory owner, schedule, or runtime | Explicit resource graph and later phase-specific evidence obligations |

## No Analog Found

There is no existing network collector or provider adapter in AgentMo. The closest patterns cover policy separation, injected intake, retained-byte digest, preflight, and bounded evidence, but the HTTPS streaming/redirect/DNS/rate-limit behavior must follow the Phase 3 research design and focused hostile tests rather than an existing implementation.

## Metadata

**Analog search scope:** `src/`, `test/`, Phase 3 research/validation, repository-local project instructions

**Primary analogs deeply inspected:** `artifact-admission.js`, `discovery-source-workspace.js`, `discovery-db.js`, `design-plan.js`, `runtime-plan.js`, `build-plan.js`, `builder-immutable-journal.js`, `artifact-registry.js`, `artifact-subjects.js`, `artifact-contract.js`, `source-refs.js`, and corresponding tests

**Pattern extraction date:** 2026-07-27

**Repository state note:** the worktree already contained extensive user changes and untracked Phase 2/3 files. This mapping changes only `03-PATTERNS.md`; it does not interpret unrelated worktree changes as Phase 3 implementation.
