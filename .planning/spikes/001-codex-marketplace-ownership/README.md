---
spike: 001
name: codex-marketplace-ownership
type: standard
validates: "Given two isolated project consumers share one Codex user host, when marketplace/plugin ownership changes or the original source disappears, then the surviving project's visibility and supported ownership model are observed through the real CLI"
verdict: VALIDATED
related: []
tags: [codex, marketplace, ownership, lifecycle]
---

# Spike 001: Codex Marketplace Ownership

## What This Validates

Given two project directories using the same isolated Codex user host, when one project registers, installs, removes, or loses the source for `agentmo-spike@agentmo-spike`, then the real Codex CLI reveals whether marketplace/plugin state is project-scoped or user-host-scoped.

## Research

The installed `codex-cli 0.145.0-alpha.18` exposes `plugin marketplace add/list/remove` and `plugin add/list/remove`. Neither command has a project-scope option. A local marketplace is identified by the `name` in `.agents/plugins/marketplace.json`, while plugin installation selects `PLUGIN@MARKETPLACE`.

| Approach | Pros | Cons | Status |
|---|---|---|---|
| Project root as shared marketplace source | Reuses projected bytes | Source identity and lifecycle depend on one consumer project | Tested here |
| Stable user-owned marketplace projection | One source can outlive any consumer | Requires explicit owner lifecycle and exact rebind/upgrade rules | Candidate |
| Project-specific marketplace/selector | No cross-project shared owner | Multiple selectors and installations diverge from the single-product UX | Fallback |

**Chosen experiment:** exercise two project working directories against one isolated real Codex home and two distinct local roots declaring the same marketplace name.

## How to Run

```bash
node .planning/spikes/001-codex-marketplace-ownership/spike.mjs
```

## What to Expect

The script prints only sanitized JSON: command exit states, bounded errors, visibility booleans, and ownership conclusions. Temporary paths and raw Codex state are not persisted.

## Investigation Trail

- The first run registered a non-Git local directory, but `plugin add` cloned the marketplace root and failed. The fixture was corrected to a real local Git repository; this is a host requirement for `source.url: "./"`, not an AgentMo packaging detail.
- Registration and installation performed from project A were immediately visible from project B under the same isolated `CODEX_HOME`. Working directory does not create project-scoped Codex plugin state.
- Registering a second source with the same marketplace name failed with the bounded reason that the name was already attached to a different source.
- Renaming the configured local source made both marketplace and plugin listing fail even though installed plugin cache bytes existed. Codex consults the configured source during observation; cache presence is insufficient.
- Removing the plugin or marketplace from either project changed the same user-host state observed by the other project.
- Repeating the experiment with a marketplace source under a stable user-owned root succeeded after project A disappeared; project B continued to observe the installed plugin.

## Results

**Verdict: VALIDATED.** Codex marketplace registration and plugin installation are user-host-scoped, not project-scoped. A fixed marketplace name cannot point at two project roots, and a missing configured local source breaks observation despite cached plugin bytes.

The supported AgentMo model is therefore:

1. project receipts remain consumers only;
2. one exact user-owned marketplace projection, stored independently of every consumer project, owns the fixed `agentmo-local` source;
3. the selector/plugin stays installed while any exact consumer remains;
4. removing a project never invokes Codex plugin/marketplace removal unless the exact consumer ledger reaches zero;
5. source replacement or ownership transfer is an explicit user-host transaction, never an implicit consequence of project upgrade/uninstall.

Project-specific selectors remain a viable fallback, but they would violate the chosen single-product/single-selector experience and are not recommended for v1.
