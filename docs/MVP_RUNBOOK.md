# AgentMo MVP Runbook

This runbook executes the first vertical AgentMother loop:

```text
stage 1: search/collect data into a database
stage 2: plan a new Agent from user needs plus that database
stage 3: complete Agent design, implementation, and delivery evidence
```

The current MVP evidence work is stage 3 delivery closure:

```text
discover-pack -> need-report -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

## Support-triage declared slice

```bash
WORK=/tmp/agentmo-support-triage-mvp
rm -rf "$WORK"
mkdir -p "$WORK"

node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json
node ./bin/agentmo.js need-report examples/support-triage.need.json --json
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" \
  --need examples/support-triage.need.json \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold"
node ./bin/agentmo.js run "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$WORK/support-triage.agentmo.json" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$WORK/support-triage.agentmo.json" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --birth-report "$WORK/birth-report.json" \
  --domain-eval "$WORK/domain-eval.json" \
  --json > "$WORK/delivery-report.json"
```

Expected result:

- `birth-report.ok === true`
- `birthStatus === "declared-ready"`
- birth/run certification boundary fields remain false
- `domain-eval.ok === true` for the sanitized deterministic fixture
- `delivery-report.ok === true`
- `delivery-report.deliveryReady === false` for declared-only runtime evidence

The support-triage deterministic fixture is sanitized, bounded evidence. It proves the mechanism and sample case coverage only; it is not production customer-support certification.

## Live-success promotion gate

Declared evidence is enough for MVP wiring, not runtime promotion. For promotion, run an isolated live smoke and rerun `birth-report` with `--expect-status success`.

```bash
scripts/openclaw-live-smoke.sh --blueprint examples/support-triage.agentmo.json --agent support-triage --message "Say exactly: ok" --openclaw-source-root /home/alex/DTAlex/learningGitHub/openclaw
```

Do not claim OpenClaw production/domain certification from the live smoke, birth report, deterministic support-triage fixture, or delivery report alone. Production/domain certification needs separate reviewed domain eval/rubric evidence and approval.

## Verification

```bash
node --test test/discovery-db.test.js test/user-need.test.js test/blueprint-draft.test.js test/handoff.test.js test/birth-report.test.js test/cli-mvp.test.js
npm run check
git diff --check
```
