# Agent Idea Candidate Contract Design

## Status

Approved for implementation on 2026-08-14 by the AgentMo control session.
This record defines the first bounded code slice for the canonical Discover
stage to publish an evidence-bound Agent Idea proposal for human review.

## Objective

Add one target-neutral, proposal-only `agentmo.agent-idea-candidate.v1`
artifact. The artifact records a candidate task opportunity and exact
Discovery DB fact references without embedding a human decision or granting
authority to enter Plan, build, run, install, activate, or release anything.

The first slice consists of:

- a production validator and bounded report builder;
- a public `artifact-contract` schema and validator-valid minimal template;
- durable registry and exact-byte admission with an exact Discovery DB
  companion;
- a read-only `agent-idea-candidate-report` CLI surface;
- package/distribution inventory coverage;
- focused, Stage 2 regression, documentation, and release evidence.

## Architecture boundary

The Candidate is a Discover artifact between Discovery evidence and a future
human Decision artifact:

```text
exact admitted Discovery DB
  -> proposal-only Agent Idea Candidate
  -> read-only validation/report
  -> future separately designed human Decision artifact
  -> future separately authorized Plan admission
```

No command in this slice generates a Candidate, records a decision, or consumes
the Candidate in Plan. A future Decision artifact must exact-bind Candidate
bytes. That future contract is deliberately excluded here.

## Canonical artifact

The required shape is:

```json
{
  "schemaVersion": "agentmo.agent-idea-candidate.v1",
  "ideaId": "replace-with-idea-id",
  "title": "Describe one bounded Agent Idea candidate.",
  "targetUsers": ["replace with one target user"],
  "candidateTasks": ["replace with one observable task"],
  "valueHypothesis": "Describe proposed value without claiming it is proven.",
  "source": {
    "discoveryDb": {
      "identity": "agentmo.discovery-db.v1",
      "subject": "discovery-db",
      "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }
  },
  "evidenceIds": ["replace-with-evidence-id"],
  "evidenceGaps": [],
  "judgmentBoundaries": [
    "State what the cited evidence cannot establish."
  ],
  "certificationBoundary": {
    "proposalOnly": true,
    "userNeedProven": false,
    "valueProven": false,
    "agentCapabilityProven": false,
    "domainQualityProven": false,
    "planReady": false,
    "productionReady": false,
    "enterPlanAuthorized": false,
    "buildAuthorized": false,
    "runtimeAuthorized": false
  }
}
```

The Candidate contains no `humanDecision`, approval status, decision identity,
organization-authentication claim, runtime target, or runtime-specific field.

## Validation contract

### Closed and bounded structure

Every object has exact keys. Strings are non-empty after trimming, exclude NUL
and unpaired Unicode surrogates, and have explicit maximum lengths counted by
Unicode code point in both JSON Schema and production validation. Arrays are
required, bounded, and contain bounded strings. `targetUsers`, `candidateTasks`, `evidenceIds`, and
`judgmentBoundaries` are non-empty. `evidenceGaps` may be empty. `evidenceIds`
must be sorted in byte order and unique.

The fixed boundary object must match the literal values above. A caller cannot
turn a proposal into authority by changing a Boolean or adding a field.

### Exact evidence binding

Durable admission of `agent-idea-candidate` requires one authentic admitted
`discovery-db` companion. Context-bound validation requires:

- `source.discoveryDb.identity === "agentmo.discovery-db.v1"`;
- `source.discoveryDb.subject === "discovery-db"`;
- `source.discoveryDb.digest` equals the exact admitted DB digest;
- every `evidenceId` resolves to exactly one `discoveryDb.facts[].id`;
- duplicate referenced IDs in the DB are ambiguous and fail closed;
- absent referenced IDs fail closed.

The standalone validator validates the artifact shape so the public minimal
template remains validator-valid. The context-bound production registry adds
the exact companion and evidence-resolution requirements.

### Evidence strength

The schema does not require a domain-specific fact kind. `extraction_field`
facts may be cited as planning leads, but the report emits a bounded warning for
each cited kind composition that includes them. No fact kind, trust level,
count, or Candidate field proves user need, value, capability, domain quality,
Plan readiness, or production readiness.

The report includes only bounded Candidate identity, counts, evidence-kind and
trust composition, warnings, and the fixed certification boundary. It does not
echo evidence text, source locations, user descriptions, or host paths. Shape-
invalid Candidates receive null summary identity, zero counts, empty evidence
composition, and at most 32 fixed field diagnostics. An array above its schema
maximum receives one array-bound diagnostic and is not traversed item by item.

### Central safety

Exact-byte admission centrally rejects duplicate member names in every object
at every depth before `JSON.parse`; decoded-equivalent escaped names are the
same member. It also rejects unpaired Unicode surrogates before UTF-8 byte
ordering, while preserving the established duplicate identity/provenance
reason. UTF-8/JSON validity, bounded input size, secret-like content rejection,
host absolute-path rejection, and raw transcript/tool body/stdout/stderr
exclusion remain central. Candidate-specific validation returns bounded field
requirements only; it does not include rejected values.

## Public interfaces

Module `src/agent-idea-candidate.js` exports:

```text
AGENT_IDEA_CANDIDATE_SCHEMA_VERSION
AGENT_IDEA_CANDIDATE_SUBJECT
AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY
AGENT_IDEA_CANDIDATE_MAX_ERRORS
AGENT_IDEA_CANDIDATE_ID_PATTERN_SOURCE
AGENT_IDEA_CANDIDATE_TEXT_PATTERN_SOURCE
AGENT_IDEA_CANDIDATE_LIMITS
validateAgentIdeaCandidate(candidate, context?)
summarizeAgentIdeaCandidate(candidate, context?)
buildAgentIdeaCandidateReport(candidate, context?)
formatAgentIdeaCandidateReport(report)
```

CLI surfaces:

```text
agentmo artifact-contract agent-idea-candidate --json

agentmo agent-idea-candidate-report <candidate.json> \
  --discovery-db <db.json> \
  --digest agent-idea-candidate=sha256:<64hex> \
  --digest discovery-db=sha256:<64hex> \
  [--json]
```

The report command admits the DB first, then admits the Candidate with that
authentic result as its sole companion. It writes no file and has no apply,
approve, decision, target, runtime, or output-path option.
`--discovery-db` is single-valued: a second occurrence fails before either path
is resolved or read, whether both values are equal or different.

## Compatibility and authority

The new schema identity and CLI are additive. Existing discovery, user-need,
approval, design-plan, blueprint, and runtime schemas are unchanged. Stage 2
commands do not add Candidate inputs or digest subjects. Regression cases use
authentic unaffected companions and reach the real user-need, discovery-
approval, and decision-ledger loaders before Candidate substitution is rejected.

The Candidate proves only that exact bytes have the expected shape and cite
unique facts in one exact admitted Discovery DB. It does not prove source
truth, semantic sufficiency, demand, user value, ability to implement an Agent,
runtime behavior, domain quality, production readiness, authenticated human or
organization approval, or authority to enter Plan.

## Explicit exclusions

- Candidate generation, ranking, clustering, deduplication, or persistence;
- a human Decision artifact or decision transition;
- Plan/user-need/design-plan/blueprint integration;
- OpenClaw or any runtime-specific fields;
- connectors, network access, model/provider calls, or external workflows;
- installation, activation, scheduling, delivery, or production approval;
- domain, POC, customer, or organization-specific schema fields.

## Acceptance

Acceptance requires focused validator/admission/CLI tests, explicit Stage 2
regression tests proving no Candidate authority is consumed, package and Node
20 inventory coverage, public documentation, a dated release evidence record,
`npm run check`, and `git diff --check`. Cancelled or incomplete commands are
not passing evidence. Pre-existing failures must be reported separately from
introduced regressions.
