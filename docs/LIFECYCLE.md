# AgentMo Lifecycle

AgentMo has exactly one top-level lifecycle:

```text
Discover -> Plan -> Produce
```

These stages are connected by validated artifacts, not mandatory command ancestry. Build, install, doctor, birth, eval, delivery, release, observation, and status labels are all Produce-internal maturity or governance surfaces; none is a fourth lifecycle stage.

## Discover

Discover finds and bounds what should be built before an agent is designed.

Inputs include domain data, source documents, operational examples, user needs, target-runtime constraints, and unacceptable failures.

Outputs are a sanitized source inventory, traceable discovery database, coverage evidence, and a concrete user-need brief. A valid Discovery Contract proves only that those inputs were materialized and bounded; it does not certify an agent design or runtime.

## Plan

Plan turns a valid Discovery Contract plus reviewed user needs into a buildable Agent Design / Blueprint Contract.

Outputs include the domain genome, exact three-key `pipeline`, architecture, tool contracts, evidence policy, eval suite and rubric, runtime target decision, governance gates, and known risks. Current blueprints use `agentmo_version: "0.1"`.

A valid plan admits work to Produce. It does not certify runtime execution, domain quality, release readiness, or production approval.

## Produce

Produce turns a valid blueprint/design contract into a reproducible Agent Package and bounded evidence. It may begin with an AgentMo-generated plan or another reviewed contract with explicit provenance.

Produce outputs include prompts, skills, tools, configs, handoff packages, runtime scaffolds, tests, eval artifacts, managed run evidence, delivery records, and release evidence.

### Produce maturity and status

`status` and report/control `produce_maturity` values describe progress inside Produce. Draft/conceive, gestate, birth, train, certify, release, and retire labels do not extend the top-level lifecycle.

- **Build and scaffold** materialize deterministic package assets and managed build state.
- **Install and doctor** check target ownership, compatibility, and wiring before runtime promotion.
- **Birth** is a fail-closed evidence gate over validated build, run, and eval inputs.
- **Eval** records bounded case or runtime evidence; it does not create domain-wide certification.
- **Delivery** revalidates and aggregates evidence without inheriting stronger claims from upstream status flags.
- **Release** records the reviewed decision, version ledger, evidence references, known risks, and remaining approval boundaries.

### Observation and change

Observe/evolve records are Produce-internal, proposal-only inputs to reviewed changes. They must not mutate a blueprint, scaffold, runtime, or eval automatically. A repaired version re-enters the relevant Produce gates and records fresh evidence.

### Evidence boundary

Produce evidence is non-self-certifying. `declared-ready` proves wiring and deterministic mechanism evidence only; `live-success` proves isolated runtime execution only. Neither status, a Birth Report, a bounded domain eval, a Delivery Report, nor a release ledger alone certifies domain-wide quality, production readiness, or deployment approval.
