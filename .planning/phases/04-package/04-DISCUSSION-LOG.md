# Phase 4: 确定性 Package 与所有权安全安装 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 4-确定性 Package 与所有权安全安装
**Areas discussed:** Package depth, carrier composition, canonical format, install scope, approval granularity, conflict approval, credentials, rollback, inspection, OpenClaw compatibility

---

## Package depth

| Option | Description | Selected |
|--------|-------------|----------|
| R | Generate real executable resources, not declaration-only scaffolds | ✓ |
| B | Generate only the generic package framework in Phase 4 | |

**User's choice:** R
**Notes:** The package must close the black-box POC blocker and include executable resources and bindings.

---

## Carrier composition

| Option | Description | Selected |
|--------|-------------|----------|
| R | One Agent may combine workspace/content, skill, MCP, native plugin, and hooks; choose the lowest-trust carrier per capability | ✓ |
| B | Restrict each Agent Package to a single carrier | |

**User's choice:** R after clarification
**Notes:** “Multiple carriers” means multiple resource mechanisms inside one Agent, not multiple Agents.

---

## Canonical format

| Option | Description | Selected |
|--------|-------------|----------|
| R | Target-neutral canonical package with target projections | |
| B | OpenClaw-native canonical package | |
| Final | Generic `agentmo.package.json` plus a complete OpenClaw-native projection | ✓ |

**User's choice:** Final hybrid
**Notes:** Preserve first-release usability without coupling future targets to OpenClaw internals.

---

## Install scope

| Option | Description | Selected |
|--------|-------------|----------|
| R | Default to isolated project-level OpenClaw state; user-level mutation requires a separate plan | ✓ |
| B | Default to the normal user OpenClaw environment | |

**User's choice:** R
**Notes:** The normal user environment remains outside the default mutation authority.

---

## Approval granularity

| Option | Description | Selected |
|--------|-------------|----------|
| R | Plan approval for ordinary managed writes, with separate sensitive-action approvals | |
| B | One plan approval authorizes every action | |
| Final | One approval screen and one submit, but each sensitive action remains an independently bound decision | ✓ |

**User's choice:** B interaction preference with the safer per-action evidence model
**Notes:** This preserves efficient UX while satisfying EVID-05.

---

## Conflict approval

| Option | Description | Selected |
|--------|-------------|----------|
| R | Approve an exact bounded conflict set in one review | ✓ |
| B | Approve every conflict in a separate interaction | |
| C | Block every conflict with no override path | |

**User's choice:** R
**Notes:** Each item remains bound to exact path/current/desired digests; no reusable overwrite authority.

---

## Credential setup

| Option | Description | Selected |
|--------|-------------|----------|
| R | Package only declares credential references; all setup happens outside AgentMo | |
| B | AgentMo assists credential/profile configuration | |
| Final | AgentMo coordinates the official OpenClaw credential/auth route without reading or persisting secret values | ✓ |

**User's choice:** Safe B
**Notes:** Receipt may contain references and presence/result metadata only.

---

## Failure rollback

| Option | Description | Selected |
|--------|-------------|----------|
| R | Roll back only pristine AgentMo-owned changes; preserve unknown or modified assets and emit an incomplete receipt | ✓ |
| B | Attempt to restore the entire target directory | |

**User's choice:** R
**Notes:** Ownership safety is more important than pretending every filesystem failure is fully reversible.

---

## Inspection surface

| Option | Description | Selected |
|--------|-------------|----------|
| R | Human summary plus stable JSON | ✓ |
| B | JSON only | |
| C | File inventory only | |

**User's choice:** R
**Notes:** Humans need concise risk/operation review; coding tools need a stable machine contract.

---

## OpenClaw compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| R | Bind version plus runtime/CLI/capability fingerprint and reapprove after drift | ✓ |
| B | Check only the version number | |
| C | Check only that the `openclaw` command exists | |

**User's choice:** R
**Notes:** The probe is read-only and does not read `.env` or certify runtime success.

---

## Installation transport closure

| Option | Description | Selected |
|--------|-------------|----------|
| Adjust | Use the deterministic archive as the only preview/apply input and bind the complete member closure | ✓ |
| Proceed | Allow manifest-only binding and accept member-drift risk | |

**User's choice:** Adjust
**Notes:** The canonical directory remains the build authority; the archive is the unique install transport. Preview, approval, and apply bind archive digest, manifest digest, and the complete member inventory.

## the agent's Discretion

- Deterministic archive encoding details and internal module boundaries.
- Exact OpenClaw official commands chosen after current-source and local read-only probe research.

## Deferred Ideas

- Live runtime/restart/domain evidence remains Phase 5.
- Chinese AI writing Agent domain acceptance remains Phase 6.
