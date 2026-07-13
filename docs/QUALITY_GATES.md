# AgentMo Quality Gates

AgentMo v0.1 validates eight default quality gates.

| Gate | Meaning |
| --- | --- |
| `domain_genome_defined` | The agent has a domain, purpose, and task classes. |
| `pipeline_defined` | The discover-plan-produce path is explicit. |
| `architecture_defined` | The main agent and routing modes are explicit. |
| `tool_contracts_defined` | Tools have purpose, allowed/forbidden conditions, and evidence policy. |
| `evidence_store_defined` | Evidence stores and required artifacts are named. |
| `eval_suite_defined` | Cases, rubric, required case classes, and hard failures are defined. |
| `governance_defined` | Policies and quality gates are recorded. |
| `release_trace_defined` | Release trace or ledger path and known risks are recorded. |

## Hard rule

A blueprint that fails any default gate is not birth-ready.

The pipeline gate is first-class: AgentMo should not jump straight to agent manufacturing. It must record discovery data, planning artifacts, and production verification.

## Why gates matter

AgentMo treats agents as software systems. A domain agent without gates may still chat, but it cannot be certified, reproduced, or trusted as an engineering artifact.
