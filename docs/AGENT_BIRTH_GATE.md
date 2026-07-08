# AgentMo Birth Gate

AgentMo birth is an evidence gate, not a branding claim.

Birth is part of AgentMo stage 3: finish the Agent design, implementation, and delivery evidence loop. It follows stage 1 data discovery and stage 2 planning from user needs plus the discovery database.

## Required command

```bash
agentmo birth-report <blueprint.json> \
  --build-state <agentmo-build-state.json> \
  --run-state <agentmo-run-state.json> \
  --run-eval <run-eval.json> \
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

## Domain and delivery reports

`birth-report` proves only mechanism/runtime birth evidence. It does not consume or replace domain-quality evidence.

- `domain-eval` records independent bounded case-suite evidence from supplied cases or reviewed eval artifacts. A passing report can set `domainCertifiedByDomainEval` for that suite only; it does not certify runtime execution, production approval, or domain-wide quality.
- `delivery-report` revalidates and aggregates blueprint, build-state, run-state, run-eval, birth-report, and optional domain-eval artifacts. It can carry bounded domain-eval status from the source artifact, but it does not create runtime certification, domain-wide quality certification, OpenClaw production readiness, or production deployment approval by itself.
- The support-triage deterministic fixture is sanitized and bounded evidence. It proves only the sample mechanism and case coverage, not production customer-support certification.
