# AgentMo Birth Gate

AgentMo birth is an evidence gate, not a branding claim.

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

Missing, malformed, wrong-agent, stale, production-state, failed eval, secret-like, raw-transcript, or certification-claiming evidence fails closed.

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
