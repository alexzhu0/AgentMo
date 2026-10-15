# AgentMo Concept and Canonical Architecture

Product-design clarification: 2026-09-28. The architecture below describes the
target, not completed product capability. The researched first-delivery design,
source comparisons and scoped demo are in
[`2026-09-28-agentmo-concept.md`](superpowers/specs/2026-09-28-agentmo-concept.md).
That design is a review draft, not implementation or runtime approval.

AgentMo is an evidence-driven Agent production system. Its job is to discover
**what is worth turning into an Agent**, work with humans to decide **what should
be built and how success will be tested**, then direct a coding agent to
**implement and validate the specified Agent Package**.

AgentMo is not a one-off prompt generator, a single coding agent, or an
OpenClaw-only wrapper. Its canonical loop is:

```text
Data and user signals
        ↓
Discover: evidence -> pain points/trends -> Agent Idea candidates
        ↓ human confirms an Idea
Plan: Agent design + evaluation contract + test dataset
        ↓ human approves the plan and acceptance boundary
Produce: coding agent implementation + runtime projection + test execution
        ↓ human accepts bounded evidence
Versioned Agent Package and runtime evidence
        ↓
Operational feedback returns to Discover / Plan
```

The stages are connected by explicit artifact contracts and exact approval
boundaries. Approval of one stage never implicitly approves a later stage.

This is a generic platform architecture. Domain Agents, vertical POCs, customer
names, and scenario-specific implementations are deliberately excluded from the
canonical architecture; they are instances produced by it, not components of it.

## Product promise and smallest delivery

**Describe the job; receive a versioned Agent with a tested, usable entry point.**
One sentence starts the process; it does not authorize arbitrary tools, spending,
installation or external actions. The user should not have to assemble workspace
files or copy configuration between stages. AgentMo owns that orchestration and
must report a precise missing prerequisite rather than return a broken entry.

There are two inputs to the same canonical pipeline: opportunity discovery from
authorized evidence, and a concrete job supplied by the user. For the latter,
Discover records the supplied need, material and gaps; it must not manufacture
market research or require unrelated web collection. Exact stage contracts and
decisions still apply. A concise product preview may explain multiple upcoming
effects, but cannot fabricate approvals for artifacts not yet produced.

The first delivery uses one builder and one installed, version-checked runtime.
Prefer native configuration and existing reviewed capabilities; ask a coding
agent to implement only an actual missing capability. A package need not contain
new executable code, a custom plugin, RAG, a database or multiple agents.
Existing validators that require more are explicit implementation gaps, not
permission to invent dummy tools or bypass validation.

### Keep definition, execution and evidence separate

| Concept | Responsibility | Boundary |
| --- | --- | --- |
| Agent definition / package version | Task, behavior, capabilities, data policy, target requirements and acceptance contract | Reuse Blueprint, Build Contract and package manifest; do not add a competing manifest |
| Runtime binding | Exact target version, native agent identity, workspace/state locations, effective permissions and credential references | A binding proposal is not an installed or running Agent |
| Session / run | A specific interaction and its native history, status and outputs | Runtime owns conversation state; a new session does not create a new package version |
| Acceptance / delivery evidence | Which version and entry were actually tested, checks, budget and remaining gaps | Store bounded evidence and references, not a duplicate raw conversation archive |

These are logical ownership boundaries, not a requirement for four new services
or databases. AgentMo's build controller is also distinct from the produced
Agent's conversation loop. OpenClaw owns that loop for the first target.

### What a delivered Agent must specify

- Identity, job, accepted inputs, useful outputs and explicit non-goals.
- Model selection and credential references, never credential values in packages.
- Necessary capabilities and their real runtime-enforced permissions; skills
  teach procedures but do not grant tool authority.
- Authorized knowledge sources when needed; optional memory with a defined
  owner, retention boundary and separation from conversation history.
- Workspace assets and isolated native state, respecting the exact target
  version. A directory alone is not a sandbox.
- A usable entry, native agent/session routing, observable failures and recovery
  expectations. A URL that merely opens does not prove correct routing.
- Acceptance cases and a delivery result bound to the exact produced version.

OpenClaw workspace files implement part of this contract, not all of it. Use the
installed runtime's native bootstrap, model, permission and entry surfaces;
do not assume current online templates work on an older installed release.
Optional memory, heartbeat, skills and plugin files are not a completion checklist.

### Delivery means a working path, not a generated directory

The selected release must pass: generation from the user's request, native load,
the delivered entry's first useful turn, a follow-up, required state recovery,
and negative tests for missing data and forbidden effects. Scope, input limits
and model-call budget must be declared before execution. A successful isolated
CLI run does not substitute for the user-facing entry test.

Show build, native execution, bounded behavior acceptance and user-entry delivery
as separate facts. Existing `declared-ready`, `live-success`, birth and delivery
semantics stay unchanged. Resume from valid evidence; do not repeat a paid call
to repair bookkeeping, retry an uncertain external effect, or reset a budget.

### Reuse rather than rebuild

AgentMo owns requirement interpretation, artifact production, exact authority,
bounded evaluation and handoff. The selected runtime owns its agent loop, model
transport, native sessions, tools and channel delivery. Connectors own external
system access. New functionality belongs in the lowest existing owner that can
implement it safely, not in a second generic runtime inside AgentMo.

CMA and WMA inform these boundaries, but are not current integrations. Cloud
orchestration, shared memory infrastructure, vector databases, multi-agent teams,
marketplaces and additional runtime adapters are deferred until a demonstrated
requirement exceeds the single-agent native path.

## 1. Data Connector Layer

Discover must be able to accept evidence from heterogeneous, authorized sources:

- public web search and approved HTTPS sources;
- internal databases, data warehouses, knowledge bases, and business systems;
- REST, GraphQL, or business-specific APIs;
- MCP servers that expose approved data or tools;
- local files and workspace artifacts;
- interviews, operator input, and user feedback;
- reviewed third-party datasets or services.

Source adapters normalize those inputs into a common evidence model while
preserving provenance, authorization scope, publication and collection time,
trust level, content identity, and redaction boundaries. An adapter does not
make an untrusted source authoritative merely by importing it.

## 2. Discover: evidence to Agent Ideas

Discover is the opportunity-discovery stage, not only a data-ingestion stage.
AI should search or query approved sources, materialize evidence, identify
recurring pain points and trends, and propose tasks that may be suitable for an
Agent Package.

```text
Search / query approved sources
  -> retrieve and normalize evidence
  -> cluster trends, pain points, and unmet workflows
  -> identify agentizable tasks
  -> produce evidence-bounded Agent Idea candidates
  -> ask the user to confirm, reject, or refine an Idea
```

The stage produces:

- a Research / Discovery DB and source-evidence records;
- trend, pain-point, and opportunity signals;
- Agent Idea candidates with target user, proposed value, evidence, gaps, and
  judgment boundaries;
- the human decision that confirms, rejects, or refines each candidate.

An Idea candidate is a proposal. It is not a proven user need, an approved
design, or authorization to build.

## 3. Plan: Agent design and its proof obligations

Plan begins only after a human confirms an Agent Idea or supplies an externally
reviewed need. It combines that decision with the Discovery evidence and turns
them into both an implementation design and a pre-declared evaluation contract.

The stage defines:

- target users, workflows, tasks, and value hypotheses;
- Agent identity, behavior, prompt, skills, tools, memory, RAG, database,
  harness, loop, and schedule requirements;
- input/output contracts, policy boundaries, forbidden behavior, and human
  checkpoints;
- supported, partial, missing, and conflicting evidence;
- success criteria and hard failures;
- normal, boundary, conflict, missing-evidence, refusal, safety, recovery, and
  runtime test cases;
- the test dataset, expected behavior, rubric, and acceptance threshold;
- a target-neutral Agent blueprint and target-runtime requirements.

Primary artifacts include the Design Plan, Blueprint, Build Contract,
Evaluation Contract, Test Dataset, and Acceptance Criteria. Plan therefore
defines not only **what to build**, but also **how the result must prove that it
meets the agreed requirement**.

Planning artifacts are reviewed proposals. They do not certify that the Agent
has been implemented or that a capability exists at runtime.

## 4. Coding Agent Layer

Produce is executed through coding agents such as:

- Codex;
- Cursor;
- Claude Code;
- Kimi Code;
- future coding agents that can implement the AgentMo contracts.

AgentMo provides a stable builder protocol and adapters for these coding-agent
surfaces. A coding agent reads the approved Blueprint, Build Contract,
Evaluation Contract, and Test Dataset; writes the implementation; runs the
declared tests; repairs bounded failures; and records build and verification
evidence.

External development-workflow plugins and planning frameworks are not AgentMo
architecture components. They may be used privately by a contributor, but
AgentMo's CLI, contracts, builder protocol, Agent Package, evaluation flow, and
runtime operation must not require them to be installed or available.

## 5. Produce: implementation, projection, and validation

Produce turns the approved Plan artifacts into real software:

```text
Approved Blueprint + Build Contract + Evaluation Contract + Test Dataset
  -> coding agent implementation
  -> prompts / skills / tools / memory / RAG / database / harness / loop
  -> target-neutral Agent Package manifest
  -> target-runtime projection
  -> isolated runtime execution
  -> planned test-dataset execution and bounded repair
  -> build, runtime, evaluation, and delivery evidence
  -> human acceptance decision
```

A successful build is insufficient by itself. Produce is complete only within
the explicitly approved scope when the package can be inspected, the selected
runtime can load it, the pre-declared test dataset has been executed, failures
are represented honestly, evidence is retained, and the human acceptance gate
is satisfied.

## 6. Runtime Adapter Layer

AgentMo owns a target-neutral Agent specification. Runtime adapters project that
specification into the native structure of a selected runtime:

```text
AgentMo target-neutral Agent Specification
              ↓
       Runtime Adapter Layer
       ↙       ↓       ↓        ↘
 OpenClaw     Pi     Hermes   business-provided Agent specification
```

OpenClaw is the first implementation target, not the permanent definition of an
AgentMo package. Future adapters may target Pi, Hermes, or an architecture
contract supplied by a business team. Each adapter must declare:

- who owns the model and execution loop;
- native versus bridged prompts, skills, tools, hooks, memory, and plugins;
- session and state authority;
- packaging, installation, activation, and rollback semantics;
- test-harness and runtime-evidence integration;
- capabilities that cannot be transferred faithfully.

The target-neutral contract prevents OpenClaw-specific directories, plugin
formats, or lifecycle semantics from becoming universal AgentMo assumptions.

## 7. Cross-cutting governance

The complete pipeline is governed by:

- exact SHA-256 binding between reviewed inputs, decisions, builds, and tests;
- explicit human gates for Idea confirmation, Plan approval, target admission,
  installation, activation, runtime, schedule, delivery, and production;
- fail-closed admission when provenance, authority, schema, or prerequisites are
  invalid;
- append-only decision, run, evaluation, birth, delivery, and release evidence;
- secret minimization and bounded, redacted evidence;
- separation between mechanism evidence, runtime evidence, domain quality, user
  value, and production certification.

No stage may self-certify a later stage. A runtime success does not prove domain
quality; passing a bounded test dataset does not prove universal capability;
neither permits deployment, schedule activation, publication, or production use
without the corresponding human authority.

## Current implementation boundary

This document defines the canonical architecture and direction. Current product
evidence is narrower:

- OpenClaw is the first implemented runtime adapter;
- scaffold and package projection are not a completed natural-language-to-Agent
  product: `src/targets/openclaw-package.js` still contains a bounded
  support-triage projection and native-plugin prerequisites;
- Codex is the primary current builder integration;
- the POC demonstrates controlled collection, local Research DB persistence,
  deduplication, restart recovery, evidence-bounded answers, and refusal;
- broad internal-database, business-API, MCP, Cursor, Claude Code, Kimi Code,
  Pi, Hermes, and business-specific adapters are architectural extension points,
  not completed integrations;
- automated Agent Idea discovery and the complete portable Evaluation Contract
  / Test Dataset flow are canonical requirements that must be productized and
  verified further;
- schedule activation, delivery, domain certification, and production approval
  remain separate human-authorized gates.

The isolated Course Wiki `definition` result recorded in `release/2026.09.28.md`
adds one reviewed native behavior result, not generic Agent creation or a completed
user-entry delivery. The smallest-delivery design above remains to be implemented
and verified through the canonical pipeline.

The primary output is therefore not a model response. It is a reviewed,
versioned, test-bound production path:

```text
Evidence + confirmed Agent Idea
  -> approved design and test contract
  -> coding-agent implementation
  -> runtime-specific Agent Package
  -> bounded evaluation evidence
  -> human release decision
```
