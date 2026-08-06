# White-Collar Research Database POC Design

## Purpose

Validate AgentMo Stage 1 with a real, isolated OpenClaw information agent.
The agent continuously gathers bounded public evidence, normalizes it into a
queryable local Research DB/Wiki, and produces a daily decision brief. It does
not yet select, publish, or certify a Lenovo PC agent package.

The database is input to the later AgentMo flow:

```text
evidence database -> human + AgentMo planning -> approved OpenClaw package
```

## Audience and scope

The initial decision user is a Lenovo PC product-definition product manager.
The first persona is white-collar knowledge work, specifically:

- knowledge work and documents;
- meetings and collaboration; and
- data analysis and decision making.

The POC tracks three evidence domains:

1. AI capabilities: models, agent patterns, tools, papers, official product
   announcements, and relevant open-source releases.
2. Device and software trends: PCs, tablets, phones, on-device AI, operating
   systems, applications, and interaction patterns.
3. Need signals: user tasks, friction, alternatives, and unmet needs for the
   three white-collar scenarios.

Students, gamers, and creators are out of the first POC scope. They remain
future persona profiles, not inference targets for this dataset.

## Source policy and skills

Every source is explicitly registered with an allowed HTTPS origin, source
role, trust tier, retrieval bounds, and a normalized record mapper.

Initial source families are:

- first-party: named company/lab publications, selected GitHub project
  releases, and arXiv metadata;
- curated signal: the pinned `aihot` skill workflow, which only calls the
  anonymous read-only `https://aihot.virxact.com/api/v1/*` API; and
- community signal: separately labelled, lower-trust candidates such as
  `last30days-skill`; these are discovery candidates, not initial installers.

The POC materializes AgentMo-owned workspace skills rather than blindly
loading a third-party repository. The reviewed AI HOT workflow is translated
into a narrow source adapter with its API allowlist and no credentials.

A `skill-scout` capability may produce a candidate review record containing
origin, exact version/revision, license, declared dependencies, requested
permissions, network destinations, and rationale. It cannot install, update,
enable, or invoke a candidate skill. A human approval is required for each
such change.

## Data model and outputs

Each retained record contains only bounded, sanitized data:

- canonical source URL and source identifier;
- original publication time and collection time;
- source role and trust tier;
- category and white-collar scenario tags;
- fact class: `fact`, `company_statement`, `community_signal`, or
  `agent_hypothesis`;
- bounded summary, source/entity links, and deterministic duplicate relation.

Raw pages, provider payloads, browser transcripts, credentials, and tool logs
are not retained. URL canonicalization plus content identity prevent duplicate
records across repeated runs. A hypothesis never upgrades its evidence source
or becomes a fact merely because it appears in a daily brief.

The run emits two local outputs:

1. A persistent, queryable Research DB/Wiki with citations and source/entity
   indexes.
2. A daily brief derived only from records admitted during the run. It shows
   new evidence, links to white-collar scenarios, evidence-backed opportunity
   hypotheses, and explicit evidence gaps.

The brief is neither external delivery nor a product recommendation. It is a
local artifact for the product manager to inspect and discuss with AgentMo.

## Scheduled operation

After a successful manual live run and idempotence/restart checks, the
isolated OpenClaw profile receives one daily `08:00 Asia/Shanghai` collection
schedule. The schedule is limited to the registered sources and local DB/Wiki
publication.

It may not send messages, publish content, alter user-level OpenClaw settings,
read `.env` into artifacts, install/update skills, or create/activate a new
agent package. Failure produces a bounded local status record and leaves
previous valid data available.

## Boundaries

- The POC is not generic web crawling or unconstrained search.
- Third-party content is untrusted data, not instructions.
- AI HOT is a curated signal, not independent proof of a claim; claims retain
  their source and trust labels.
- Community trend signals remain distinct from first-party evidence.
- The scheduler is not an authorization to publish, deliver, or make product
  decisions.
- A successful collection run proves only bounded mechanism execution, not
  source completeness, domain quality, or production readiness.

## Acceptance criteria

1. A manual run retrieves at least one allowlisted source and writes only
   bounded, sanitized evidence to an absent local DB/Wiki root.
2. A second run over unchanged material writes no duplicate evidence records.
3. Restarting the isolated agent can query retained records with source URL,
   publication time, collection time, and trust tier.
4. The daily brief distinguishes facts, company statements, community signals,
   and Agent hypotheses; it refuses to invent evidence when a category is
   empty.
5. The AI HOT adapter cannot access any origin beyond its documented API, use
   credentials, execute returned instructions, or install software.
6. The `skill-scout` cannot mutate skills or runtime configuration.
7. The daily `08:00 Asia/Shanghai` schedule is added only after the manual
   success, duplicate, restart, and schedule-preview checks pass.
