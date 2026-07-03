# AgentMother Concept

AgentMother is a meta-agent engineering mechanism. Its job is not only to manufacture agents. Its job is to decide **what should be built**, plan **how it should be built**, then use coding agents to **produce the specified agent**.

## Definition

AgentMother is a Codex-driven three-stage incubation system:

```text
Discover -> Plan -> Produce
```

It collects domain data and user needs, converts them into an executable `AgentGenome` and build plan, compiles that plan into one or more runtime harnesses, then validates the resulting agent through evals, evidence, governance gates, and release ledgers.

## The three stages

### 1. Discover: find what to build

Discovery comes before agent design. AgentMother should first gather:

- source documents;
- operational examples;
- existing data tables or APIs;
- user goals and target workflows;
- failure modes and forbidden behavior;
- target runtime/channel constraints.

The output is not yet an agent. The output is a bounded data inventory, database/retrieval plan, and concrete user-need statement.

### 2. Plan: decide how to build

Planning combines the discovered database with user requirements. AgentMother turns that into:

- domain genome;
- task classes;
- routing strategy;
- main/specialist agent architecture;
- tool contracts;
- evidence policy;
- eval cases and rubric;
- runtime target choice.

The output is an executable blueprint that can be reviewed before implementation.

### 3. Produce: program the agent

Production uses Codex, Pi, OpenClaw scaffolds, or other coding-agent runtimes to implement the blueprint:

- generate prompts, skills, tools, configs, and runbooks;
- run tests and evals;
- repair failures;
- record evidence and release history;
- certify or reject the runtime target.

## Not a prompt generator

AgentMother does not stop at prompt text. A real domain agent needs:

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
  finds data, source truth, examples, user needs, and target workflow value

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
  records the reusable mother contract for one domain agent
```

## Primary output

The primary output is not a model response. It is a verified production path:

```text
data + user need -> plan -> coded agent -> eval evidence -> releasable runtime
```

## Runtime profile rule

AgentMother must not collapse all runtimes into one abstraction. Each runtime profile should say:

- who owns the model loop;
- who owns canonical thread/session history;
- which tools and hooks are native versus bridged;
- where evidence is stored and how it is bounded;
- which concepts can transfer to another runtime and which APIs cannot.

For the current Win9 example, Pi is the certified execution authority, while latest OpenClaw source is an active alternate architecture reference.
