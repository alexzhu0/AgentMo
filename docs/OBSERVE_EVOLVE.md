# Observe / Evolve Records

AgentMo observation records capture failures and improvement proposals without mutating a blueprint, tool contract, eval suite, or generated runtime scaffold.

The foundation format is deliberately small:

```json
{
  "schemaVersion": "agentmo.observation.v1",
  "agentId": "win9",
  "source": "eval",
  "failureMode": "simple methodology lookup routed through full orchestration",
  "evidenceRefs": ["../pi/docs/win9-evals/CASES.md#light_methodology_lookup"],
  "proposedRegression": {
    "id": "win9-light-lookup-routing",
    "description": "Simple methodology lookup must stay on the light path."
  },
  "recommendedBlueprintChange": {
    "section": "tools.win9_methodology_lookup.allowed_when",
    "proposal": "Make light lookup routing constraints explicit."
  },
  "status": "proposed"
}
```

## Required promotion rule

An observation is evidence, not authority. Do not promote a recommended blueprint, tool, prompt, runtime, or eval change unless all of the following are true:

1. The observation has at least one bounded evidence reference.
2. A new regression or eval case is proposed before implementation.
3. The proposed change is reviewed against the current blueprint quality gates.
4. Verification evidence is recorded after the change.

`agentmo observe <observation.json> --json` validates and summarizes the record. It never applies `recommendedBlueprintChange` automatically.

## Rollback

Observation records are optional sidecar evidence. Removing an observation file, validator, or CLI command does not affect existing `validate`, `report`, `plan`, or `scaffold` outputs.
