---
name: agentmo
description: Build or resume reproducible domain agents with AgentMo's Discover, Plan, and Produce lifecycle. Use when a user asks to research inputs, agree on an agent blueprint, produce an Agent Package, resume an AgentMo checkpoint, or inspect Builder readiness.
---

# AgentMo

Use the project-local AgentMo release. Do not fetch or substitute another version.

1. Run `node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js builder probe --json` before starting or resuming work.
2. Run `node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js builder doctor --project . --json` when an installation exists or its state is uncertain.
3. Start with `node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js builder start`, or resume only from an admitted checkpoint and its exact digest.
4. Preserve the lifecycle `Discover -> Plan -> Produce`. Treat generated artifacts and checkpoints as authority; never reconstruct state from a transcript.
5. Ask for explicit human approval at decision boundaries. Hooks may announce or propose work, but must not approve decisions or advance stages.
6. Keep secrets, environment values, raw provider payloads, and raw transcripts out of durable artifacts.
7. Use `builder deactivate` to make an installed Builder inert and `builder reactivate` to append an activation successor. Both require the exact active receipt digest and an explicit preview/apply plan. Do not delete installed bytes, retained stages, tombstones, host selector evidence, or prior releases.

Stop if required host capabilities are missing, an installed path conflicts with its receipt, or a required artifact lacks its exact digest. Report the failed prerequisite and the next explicit action.
