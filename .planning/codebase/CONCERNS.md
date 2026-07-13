# Codebase Concerns

**Analysis Date:** 2026-07-10

## Tech Debt

**Monolithic CLI router:**
- Issue: `src/cli.js` is 1,069 lines and owns command dispatch, argument parsing, help text, and many human formatters.
- Impact: every new command touches one high-conflict file; parser/help/handler behavior can drift.
- Current mitigation: extensive `test/cli.test.js` and `test/cli-mvp.test.js` coverage.
- Fix approach: extract command-specific parsers/handlers behind a registry while preserving the public CLI and exact error behavior.

**Large evidence/runtime modules:**
- Issue: `src/run-state.js` is 930 lines and combines run persistence, replay, evaluation, message fidelity, output summarization, and fallback detection.
- Impact: certification or replay changes can accidentally alter unrelated evidence fields.
- Current mitigation: dedicated run-state, replay-eval, runtime-execution, birth-report, and delivery-report suites.
- Fix approach: separate run serialization, replay planning, evaluation, and output-evidence summarization behind stable schema tests.

**Manual formatting and syntax gate:**
- Issue: no linter or formatter is configured; `package.json` manually enumerates every production module for `node --check`.
- Impact: a new module can be omitted from syntax checking, and style depends on review discipline.
- Fix approach: derive syntax targets programmatically or add a dependency-free repository script; consider a formatter only if the team accepts the added toolchain.

## Known Inconsistencies

**Missing environment example:**
- Symptoms: `README.md` instructs `cp .env.example .env`, but `.env.example` is absent from the current working tree.
- Trigger: follow the documented optional live OpenClaw/DeepSeek setup.
- Impact: Echo cannot discover the intended non-secret key names from the documented file.
- Workaround: inspect the allowlist in `src/runtime-env.js` without reading `.env`.
- Fix approach: restore a value-free `.env.example` or update the README/runbook instructions in the same PR.

**Machine-specific recovery paths:**
- Symptoms: recovery/collaboration docs contain `/home/alex/DTAlex/learningGitHub/AgentMo`, while this workspace is `/Users/alexzhu/Lenovo/AgentMo`.
- Impact: copy-pasted recovery commands are not portable across Alex and Echo machines.
- Current mitigation: repository boundaries are still clear by project name and `AGENTS.md`.
- Fix approach: document paths as examples and derive the repository root with `pwd`/Git instead of treating one absolute path as universal.

## Security Considerations

**Operator-supplied env files:**
- Risk: live execution necessarily reads credential values into memory.
- Current mitigation: repository policy forbids reading `.env` during normal agent work; `src/runtime-env.js` allowlists key names and durable descriptors omit values.
- Recommendations: preserve value-blind tests, never add env dumps, and keep fatal/output redaction at every CLI boundary.

**External runtime process:**
- Risk: OpenClaw or provider output may contain secrets, raw content, or mutation evidence.
- Current mitigation: constrained environment, isolated state directory by default, bounded capture, digest/structured summaries, and fail-closed evidence audits.
- Recommendations: treat any new output field as unsafe until negative tests prove raw and secret content cannot become durable.

**Approved local-source intake:**
- Risk: a manifest could point at secrets, sibling repositories, parent traversal, symlinks, or unsupported binary/certificate files.
- Current mitigation: repo-bound root checks, denied filenames/extensions, realpath/symlink checks, bounded extensions/chunks, and unsafe DB state blocking.
- Recommendations: keep `test/discovery-source-workspace.test.js` mandatory for every Stage 1 change.

## Performance and Scaling Limits

**In-memory artifacts:**
- Current behavior: JSON artifacts and many source/evidence collections are loaded and processed in memory.
- Limit: no repository benchmark establishes safe maximum discovery DB, fact, case, or run-index size.
- Symptoms at limit: increased latency and memory usage during design-plan matching, report aggregation, or source ingestion.
- Scaling path: add representative benchmark fixtures before introducing streaming/indexed implementations.

**Lexical evidence matching:**
- Current behavior: `src/design-plan.js` uses deterministic token overlap to map requirements to facts.
- Known risk: semantically relevant evidence with different wording may be marked partial or missing.
- Current mitigation: gaps remain explicit and governed rather than converted into claims.
- Scaling path: add reviewed semantic retrieval behind the existing `agentmo.design-plan.v1` boundary and preserve deterministic trace evidence.

**Source workspace bounds:**
- Current behavior: supported text/JSON sources are chunked with per-source limits in `src/discovery-source-workspace.js`.
- Limit: this is a bounded local intake path, not a crawler, live search system, or large-corpus ingestion engine.
- Scaling path: introduce a separate discovery adapter/contract rather than weakening current safety bounds.

## Fragile Areas

**Certification boundaries:**
- Why fragile: declared readiness, live-success, bounded domain certification, delivery readiness, and production approval are similar-looking but intentionally distinct.
- Common failures: a formatter/report accidentally promotes a weaker evidence level into a stronger claim.
- Safe modification: update negative tests across `test/birth-report.test.js`, `test/domain-eval.test.js`, `test/delivery-report.test.js`, and `test/stage-contracts.test.js` together.

**Stage decoupling:**
- Why fragile: the recommended vertical CLI flow can tempt new code to depend on prior command ancestry or Stage 1 sidecars.
- Common failures: Stage 3 handoff starts requiring discovery inputs; Stage 2 starts reading workspace sidecars instead of the discovery DB.
- Safe modification: preserve artifact-only inputs and rerun the stage contract suite.

**Generated scaffold parity:**
- Why fragile: `src/scaffold-files.js`, target adapters, dry-run operations, and baseline file-list tests must agree exactly.
- Common failures: generated files appear in scaffold output but not the plan, or target metadata diverges.
- Safe modification: change renderer, target, build-plan, and parity tests in one PR.

**Runtime timeout cleanup:**
- Why fragile: detached process groups and SIGTERM/SIGKILL behavior differ by operating system.
- Common failures: a timed-out child leaves descendants alive or returns before cleanup evidence is known.
- Safe modification: preserve bounded timeouts and process-group tests; disclose Windows behavior separately.

**GSD/AgentMo instruction coexistence:**
- Why fragile: `AGENTS.md` is a hand-authored repository contract, while GSD project initialization may offer to generate a runtime instruction file at the same path.
- Safe modification: never overwrite the existing `AGENTS.md`; GSD must detect and preserve it unless Alex explicitly authorizes a reviewed merge.

## Dependencies at Risk

**External OpenClaw CLI/source tree:**
- Risk: command flags, JSON output, state layout, or transport behavior may change outside this repository.
- Impact: live run/replay evidence can fail even while deterministic AgentMo tests pass.
- Mitigation: runtime plans record identity and unsupported surfaces; optional isolated smoke evidence must be refreshed deliberately.

**Node.js runtime floor:**
- Risk: `package.json` allows all Node versions from 20 upward without a lock/pin.
- Impact: child-process and test behavior can differ across Node/OS combinations.
- Mitigation: use only stable built-ins and disclose the tested runtime in PR/release evidence.

## Missing Operational Features

**Automated CI enforcement:**
- Gap: no `.github/workflows/` pipeline runs `npm run check` for PRs.
- Impact: the Alex/Echo/Codex process relies on Echo-provided local evidence and review discipline.
- Implementation approach: add a minimal Node 20+ GitHub Actions check when Alex prioritizes repository automation.

**Live discovery/search:**
- Gap: current Stage 1 consumes operator-provided manifests and approved local fixtures only.
- Boundary: this is explicitly documented, not a hidden implementation claim.
- Implementation approach: add a separately governed discovery adapter with sanitized provenance; do not make existing commands silently access the network.

## Test Coverage Gaps

**Real provider/OpenClaw compatibility:**
- What's not covered: default `npm run check` does not contact DeepSeek or execute a real OpenClaw runtime.
- Risk: external integration drift is detected only by the optional smoke workflow.
- Priority: High before any runtime-promotion claim; not required for deterministic mechanism work.

**Windows process-tree behavior:**
- What's not covered: descendant process-group termination tests are skipped on Windows.
- Risk: timeout cleanup guarantees are weaker on that platform.
- Priority: Medium if Windows becomes a supported live-runtime platform.

**Coverage metrics:**
- What's not covered: there is no measured line/branch coverage threshold.
- Risk: broad test count can hide unvisited branches.
- Priority: Medium; contract and negative-case coverage currently provide more value than a raw percentage.

**Domain quality:**
- What's not covered: the support-triage fixture proves only bounded supplied cases.
- Risk: passing deterministic cases may be mistaken for production-wide quality.
- Priority: Always disclose; expand cases with real reviewed business evidence before stronger claims.

## Collaboration and Release Risks

- Echo should implement on a feature branch, run `npm run check` and `git diff --check`, stage explicit paths, and open a PR.
- Codex should review stage boundaries, schema/CLI/docs synchronization, secret handling, and release evidence.
- Alex alone decides merge, product acceptance, and release.
- The current mapping describes the working tree; it does not certify commit readiness, publication, runtime promotion, or domain-wide quality.

---

*Concerns audit: 2026-07-10*
*Update as risks are resolved or new evidence appears*
