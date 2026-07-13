# AgentMo Concept

AgentMo is a meta-agent engineering mechanism. Its job is not only to manufacture agents. Its job is to decide **what should be built**, plan **how it should be built**, then use coding agents to **produce the specified agent**.

## Definition

AgentMo is a Codex-driven three-stage system:

```text
Discover -> Plan -> Produce
```

The stages are connected by artifact contracts, not mandatory command ancestry:

```text
Stage 1 Discover -> Discovery Contract
Stage 2 Plan     -> Agent Design / Blueprint Contract
Stage 3 Produce  -> Delivery Evidence Contract
```

It accepts or materializes bounded domain data and user needs, converts valid contracts into an executable `AgentGenome` and build plan, compiles that plan into one or more runtime harnesses, then records evals, evidence, governance gates, and release ledgers.

## The three stages

### 1. Discover: form the Discovery Contract

Discovery comes before AgentMo-generated design. Current AgentMo discovery commands materialize operator-provided manifests and approved source inputs; they do not claim live web search or crawling. AgentMo should first gather or accept:

- source documents;
- operational examples;
- existing data tables or APIs;
- user goals and target workflows;
- failure modes and forbidden behavior;
- target runtime/channel constraints.

The output is not yet an agent. The output is a bounded Discovery Contract: `agentmo.discovery-pack.v1`, `agentmo.discovery-db.v1`, `facts.jsonl`, and `coverage.json`.

### 2. Plan: form the Agent Design / Blueprint Contract

Planning combines a valid discovery database with user requirements. The discovery database may come from AgentMo Stage 1 or from another reviewed process; Stage 2 depends on the artifact contract, not the prior command path. AgentMo turns that into:

- domain genome;
- task classes;
- routing strategy;
- main/specialist agent architecture;
- tool contracts;
- evidence policy;
- eval cases and rubric;
- runtime target choice.

The output is an executable blueprint/design contract with `agentmo_version: "0.1"`, inputs from `agentmo.user-need.v1`, eval requirements, and evidence policy. It can be reviewed before implementation.

### 3. Produce: form the Delivery Evidence Contract

Production uses Codex, Pi, OpenClaw scaffolds, or other coding-agent runtimes to implement a valid blueprint/design contract. Stage 3 may start from AgentMo Stage 2 output or from an externally reviewed/business-provided valid design contract with bounded provenance. It does not require Stage 1 or Stage 2 commands to have run in the same workspace. Production can:

- generate prompts, skills, tools, configs, and runbooks;
- run tests and evals;
- repair failures;
- record evidence and release history;
- produce build, run, run-eval, birth, domain-eval, and delivery artifacts for review.

Scaffold, run-state, birth-report, domain-eval, and delivery-report artifacts do not certify runtime behavior, domain-wide quality, production readiness, or deployment approval by themselves. Domain-eval evidence is bounded to the supplied case suite, and delivery-report only aggregates source artifacts.

## Not a prompt generator

AgentMo does not stop at prompt text. A real domain agent needs:

- discovery data and database outputs;
- user-need planning artifacts;
- role architecture;
- tool contracts;
- routing rules;
- bounded evidence packets;
- audit artifacts;
- eval cases and rubrics;
- release history;
- known-risk disclosure.

## Core stack

```text
Discovery Layer
  materializes approved source truth, examples, user needs, and target workflow value

Planning Layer
  converts discovery into blueprint, architecture, tool contracts, evals, and gates

Codex Builder
  designs, codes, tests, verifies, documents

Runtime Profiles
  describe active, alternate, historical, and migration-source execution architectures

Pi Runtime
  hosts current local agents, extensions, tools, sessions, shared state

OpenClaw Architecture
  contributes Gateway/channel delivery, isolated agent workspaces, session trajectories, plugin hooks, runtime selection, and multi-agent routing concepts

AgentHarness Governance
  shapes policy, preflight, handoff, audit, manifest ideas

AgentMo Blueprint
  records the reusable AgentMo contract for one domain agent
```

## Primary output

The primary output is not a model response. It is a contract-driven production path:

```text
Discovery Contract + Blueprint Contract -> Delivery Evidence Contract -> reviewed release decision
```

The support-triage MVP demonstrates the full vertical composition. Other valid paths can start Stage 3 from a valid externally reviewed blueprint/design contract.

## Runtime profile rule

AgentMo must not collapse all runtimes into one abstraction. Each runtime profile should say:

- who owns the model loop;
- who owns canonical thread/session history;
- which tools and hooks are native versus bridged;
- where evidence is stored and how it is bounded;
- which concepts can transfer to another runtime and which APIs cannot.

For the current Win9 example, Pi is the certified execution authority, while latest OpenClaw source is an active alternate architecture reference.
