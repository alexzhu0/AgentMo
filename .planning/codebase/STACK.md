# Technology Stack

**Analysis Date:** 2026-07-10

## Languages

**Primary:**
- JavaScript (ECMAScript modules) - all CLI, contract, scaffold, runtime, and evidence logic under `bin/` and `src/`.
- JSON and JSONL - durable blueprints, discovery databases, plans, run state, eval evidence, and example fixtures.

**Secondary:**
- POSIX shell - the optional isolated OpenClaw live-smoke helper in `scripts/openclaw-live-smoke.sh`.
- Markdown - architecture, runbooks, release evidence, generated handoff packages, and generated agent workspaces.

## Runtime

**Environment:**
- Node.js `>=20`, declared in `package.json`.
- The mapping environment runs Node.js `v24.18.0`; this is not a repository pin.
- The core product is a command-line tool; there is no browser or server process.

**Package Manager:**
- npm; the mapping environment runs npm `11.16.0`.
- No `package-lock.json`, `npm-shrinkwrap.json`, `.nvmrc`, or `.node-version` is present.
- `package.json` declares no third-party runtime or development dependencies.

## Frameworks

**Core:**
- No application framework. AgentMo uses Node.js built-ins such as `node:fs/promises`, `node:path`, `node:crypto`, and `node:child_process`.
- The executable mapping is `agentmo` -> `bin/agentmo.js` in `package.json`.

**Testing:**
- Node.js built-in `node:test` runner and `node:assert/strict` assertions.
- Temporary filesystem integration uses `node:os`, `node:path`, and `node:fs/promises`.

**Build/Dev:**
- No transpilation, bundler, linter, or formatter is configured.
- `npm run check` performs `node --check` across production modules, then runs `node --test`.

## Key Dependencies

**Critical:**
- Node.js standard library - JSON/file processing, hashing, process execution, and tests.
- OpenClaw CLI - an external executable used only for explicit OpenClaw runtime planning/execution; it is not an npm dependency.
- `pnpm` - used by runtime plans only when an operator explicitly supplies an OpenClaw source root.

**Infrastructure:**
- Local filesystem - all durable AgentMo contracts and evidence are file artifacts.
- Git/GitHub - collaboration, PR, and release-evidence workflow documented in `CONTRIBUTING.md`; not required by the runtime library itself.

## Configuration

**Environment:**
- Core validation, planning, and scaffold commands require no credentials.
- Live OpenClaw execution can read an operator-supplied env file through the allowlist in `src/runtime-env.js`.
- Secret values are intentionally not persisted; only env-key presence metadata is durable.

**Build:**
- `package.json` is the only build/test configuration file.
- Runtime selection and identity are supplied through CLI flags and blueprint `runtime_profiles`.
- Artifact schemas are enforced in source modules rather than by external schema libraries.

## Platform Requirements

**Development:**
- Any platform with Node.js 20+ for core commands and tests.
- Some process-group timeout tests are skipped on Windows because detached POSIX process groups are unavailable there.
- Bash is required only for `scripts/openclaw-live-smoke.sh` and its shell-syntax test.

**Production/Distribution:**
- Intended for npm-style CLI installation or repository-local execution via `node ./bin/agentmo.js`.
- OpenClaw runtime execution additionally requires a compatible `openclaw` binary, or `pnpm` plus an explicitly supplied OpenClaw source root.
- Scaffold generation alone is not runtime, domain, or production certification.

---

*Stack analysis: 2026-07-10*
*Update after runtime, packaging, or dependency changes*
