# Design Plan Standalone Loader Cycle Design

## Context

`loadDesignPlan` is a public durable-artifact loader exported by
`src/design-plan.js`. A fresh process that imports that module before any other
AgentMo module currently fails during ESM initialization:

```text
design-plan -> artifact-admission -> artifact-registry -> design-plan
```

`artifact-registry.js` constructs its durable registry at module evaluation
time and reads `DESIGN_PLAN_SCHEMA_VERSION` from the still-initializing
`design-plan.js` binding. Node rejects that top-level read from the temporal
dead zone. Existing Stage 2 and CLI tests import another module first, so their
import order masks the standalone loader defect.

The already-generated lecture-study design-plan artifact is valid under an
admission-first verification order. This change repairs the loader contract;
it does not regenerate, reinterpret, approve, or advance that POC artifact.

## Decision

Keep the existing synchronous registry validator binding, but stop reading the
cyclic schema constant while the module graph is initializing:

- `artifact-registry.js` imports only `validateDesignPlan` from
  `design-plan.js`;
- the design-plan registry record uses the stable public identity literal
  `agentmo.design-plan.v1`, following the existing literal identities for the
  adjacent Decision Entry and Decision Ledger records;
- the validator binding remains referenced only when a caller validates an
  artifact, after module initialization has completed.

This is deliberately smaller than reorganizing artifact admission or the
registry. A fresh-process behavior test binds the registry literal back to the
actual loader: a plan written with the exported design-plan schema identity
must load successfully through the exact subject and digest, while wrong
subject and wrong digest remain fail-closed.

## Test contract

The regression test must use a new Node subprocess whose first repository
import is `./src/design-plan.js`. It must exercise the real exported
`loadDesignPlan` and a real valid design-plan file, without pre-importing
`artifact-admission.js` or mocking the module graph.

The subprocess reports only bounded, value-blind fields. Three cases are
required:

1. exact subject plus exact SHA-256 digest loads the plan and reports the
   expected schema and runtime;
2. a different well-formed digest rejects with
   `AGENTMO_ARTIFACT_DIGEST_MISMATCH`;
3. a different subject rejects with `AGENTMO_UNSUPPORTED_ARTIFACT`.

The RED failure must be the current TDZ initialization error. A syntax error,
fixture error, or test-harness timeout is not an acceptable RED.

## Node 20 ownership and evidence

`test/design-plan.test.js` becomes part of the fixed Node 20 core-contract
manifest so the standalone import contract is executed by the repository-owned
trusted runtime lane. `src/design-plan.js` and `src/artifact-registry.js` are
already in the syntax manifest, so no new source module or syntax-manifest
member is required.

The old receipts remain immutable historical evidence. The trusted producer
must write to a new absent temporary target, succeed under the exact repository
trust anchor, and only then may those exact bytes be published as
`release/evidence/2026.08.28-node20-core-receipt.json`. Post-publication
consumers and documentation must bind the measured command-set digest, counts,
receipt SHA-256, and observation time. The receipt proves bounded mechanism
execution only; it does not approve Plan, certify domain quality, authorize
Produce, or certify wider OpenClaw compatibility.

## Rejected alternatives

- **Pre-import artifact admission in callers:** rejected because it preserves
  the import-order dependency and merely hides the public loader defect.
- **Move the schema constant into a new leaf module:** rejected for this
  narrow repair because the synchronous validator edge would remain and a new
  shipped module would add inventory and receipt surface without eliminating
  the cycle. The behavior test prevents silent identity drift in the chosen
  literal.
- **Refactor artifact admission or make registry validation asynchronous:**
  rejected as unnecessary API and architecture expansion.
- **Regenerate the POC artifact:** rejected because independent validation
  already established that its bytes and semantics are valid.

## Security and authority boundaries

- No loader API, subject, digest, validation, or provenance rule is widened.
- Errors remain fixed and value-blind; subprocess evidence must not expose
  host paths, payloads, transcripts, credentials, or raw provider output.
- `.env` is never read.
- No dependency is added.
- No commit, push, PR, tag, release, publication, or POC phase approval is
  authorized by this work.
- The POC remains stopped before Plan approval until this repair, trusted
  evidence, full repository verification, and independent review are green.

## Acceptance criteria

- The fresh direct-first-import regression is RED before implementation and
  GREEN after the minimal registry change.
- Wrong digest and wrong subject still reject with their fixed error codes.
- The documented Stage 2 set passes.
- The trusted Node 20 producer publishes a fresh exact receipt only after
  success, and all post-publication consumers pass.
- `npm run check` and `git diff --check` exit 0.
- A final independent review reports no open Critical or Important findings.
- The preserved lecture-study plan bytes remain unchanged, and the POC is
  resumed only to the next human approval gate.
