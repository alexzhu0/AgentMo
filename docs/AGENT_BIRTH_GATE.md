# AgentMo Birth Gate

Birth and Delivery Reports are fail-closed, Produce-internal gates. They are non-self-certifying and revalidate bounded input evidence instead of inheriting upstream success claims.

- `declared-ready` proves deterministic wiring only and does not certify runtime execution, domain quality, production readiness, or deployment approval.
- `live-success` proves one isolated runtime execution only and does not certify domain quality, production readiness, or deployment approval.

AgentMo birth is an evidence gate, not a branding claim.

Birth is part of AgentMo stage 3: finish the Agent design, implementation, and delivery evidence loop. It follows stage 1 data discovery and stage 2 planning from user needs plus the discovery database.

## Required command

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
BLUEPRINT=path/to/blueprint.json
BUILD_STATE=path/to/agentmo-build-state.json
RUN_STATE=path/to/agentmo-run-state.json
RUN_EVAL=path/to/run-eval.json
agentmo birth-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$BUILD_STATE")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$RUN_EVAL")" \
  --build-state "$BUILD_STATE" \
  --run-state "$RUN_STATE" \
  --run-eval "$RUN_EVAL" \
  --expect-status declared \
  --json
```

Use `--expect-status success` only when the run-state came from explicit live execution and `run-eval` passed that same successful run. Use `--expect-status declared` for non-live mechanism evidence.

## Inputs

The gate requires all four artifacts:

1. Valid AgentMo blueprint.
2. `agentmo.build.v1` build-state from `agentmo scaffold`.
3. `agentmo.run.v1` run-state from `agentmo run`.
4. `agentmo.run-eval.v1` report from `agentmo run-eval`.

Missing, malformed, wrong-agent, stale, production-state, failed eval, secret-like, raw-transcript, raw stdout/stderr preview, or certification-claiming evidence fails closed. Unstructured runtime output may be represented only as digest/length metadata; raw output previews are not birth-eligible evidence.

## Evidence levels

| Level | Meaning | Allowed claim |
| --- | --- | --- |
| `declared` | Non-live run-state plus passing run-eval. | Mechanism path is wired; runtime is not born for promotion. |
| `live-success` | Explicit live run succeeded in isolated state plus passing run-eval. | Runtime birth evidence exists, but domain certification still needs eval/rubric evidence. |
| `failure` | Failure evidence is explicit. | Use observe/evolve; do not promote. |

## Non-certification boundary

`birth-report` always records:

- `runtimeCertifiedByBirthReport: false`
- `domainCertifiedByBirthReport: false`
- `runtimeCertifiedByRun: false`
- `domainCertifiedByRun: false`

Birth evidence is necessary for promotion, but it is not domain quality certification and not production deployment approval.
Every source artifact is independently admitted and cross-checked. An upstream `ok`, a passing birth report, or a stronger-looking field never transfers certification to another evidence level.

## Domain and delivery reports

`birth-report` proves only mechanism/runtime birth evidence. It does not consume or replace domain-quality evidence.

- `domain-eval` records independent bounded case-suite evidence from supplied cases or reviewed eval artifacts. A passing report can set `domainCertifiedByDomainEval` for that suite only; it does not certify runtime execution, production approval, or domain-wide quality.
- `delivery-report` revalidates and aggregates blueprint, build-state, run-state, run-eval, birth-report, and optional domain-eval artifacts. It can carry bounded domain-eval status from the source artifact, but it does not create runtime certification, domain-wide quality certification, OpenClaw production readiness, or production deployment approval by itself.
- The support-triage deterministic fixture is sanitized and bounded evidence. It proves only the sample mechanism and case coverage, not production customer-support certification.
