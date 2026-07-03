# AgentMother Lifecycle

AgentMother's lifecycle has one top-level production path:

```text
Discover -> Plan -> Produce
```

The older incubation vocabulary still fits inside that path:

```text
Discover -> Conceive -> Gestate -> Birth -> Train -> Certify -> Release -> Observe -> Evolve -> Reproduce
```

## Discover

Find what should be built before designing the agent.

Inputs:

- domain data;
- source documents;
- operational examples;
- user needs;
- target runtime constraints;
- unacceptable failures.

Output: bounded source inventory, database/retrieval plan, and concrete user-need statement.

## Plan

Convert discovered data plus user needs into a buildable plan.

Outputs:

- `domain_genome` section;
- `pipeline` section;
- agent architecture;
- tool contracts;
- evidence policy;
- eval suite and rubric;
- runtime target decision;
- release gates.

## Produce

Use Codex or another coding-agent runtime to implement the specified agent.

Outputs:

- prompts, skills, tools, configs, and runbooks;
- generated runtime scaffold;
- tests and eval evidence;
- failure repairs;
- version ledger and evidence index.

## Conceive

Clarify the agent's purpose, users, domain value, and unacceptable failures.

Output: intent brief.

## Gestate

Build the domain genome: concepts, workflows, task classes, knowledge sources, risks, and success criteria.

Output: `domain_genome` section in the blueprint.

## Birth

Create the minimum runnable harness: main agent, optional specialists, tool contracts, evidence store, and first eval pack.

Output: scaffolded agent harness.

## Train

Run targeted evals, find route failures, hallucinations, context leaks, tool misuse, and slow paths.

Output: bug fixes and regression cases.

## Certify

Require all quality gates to pass. Certification is evidence-based, not vibe-based.

Output: readiness report and passing eval evidence.

## Release

Record commit, tag, test evidence, eval result, known risks, and decision rationale.

Output: version ledger and evidence index.

## Observe

Collect production or field failures as evidence, not anecdotes.

Output: backlog and run records.

## Evolve

Repair the agent with tests and reruns.

Output: new version ledger entry.

## Reproduce

Use the mature blueprint as a template for a new domain agent.

Output: new AgentMother blueprint.
