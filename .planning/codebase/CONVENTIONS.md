# Coding and Collaboration Conventions

**Analysis Date:** 2026-07-10

## Naming Patterns

**Files:**
- Use lowercase kebab-case for modules and docs: `runtime-plan.js`, `source-refs.js`.
- Mirror source names in the flat test directory: `src/design-plan.js` -> `test/design-plan.test.js`.
- Use uppercase filenames only for repository contracts and indexes such as `README.md`, `CONTRIBUTING.md`, and `AGENTS.md`.

**Functions:**
- Use camelCase named functions and named exports.
- Use action-oriented public names: `buildDesignPlan`, `validateBlueprint`, `writeRunState`, `formatDeliveryReport`.
- Keep small private normalization/guard helpers at module bottom: `nonEmptyString`, `isObject`, `normalizeOptionalString`.

**Variables and Constants:**
- Use camelCase for local values and options.
- Use uppercase snake case for exported schema/file constants and fixed internal sets.
- Use `Set` for closed enumerations and `Object.freeze()` for exported immutable arrays where callers must not mutate values.

## Code Style

**Formatting:**
- Two-space indentation, double-quoted strings, semicolons, and trailing commas in multiline structures.
- Prefer one logical statement per line and early returns for guard clauses.
- There is no configured formatter; match nearby source exactly and use `git diff --check` when Git is available.

**Linting:**
- No ESLint configuration or lint script is present.
- Syntax validation is explicit in the long `npm run check` script in `package.json`.
- New production modules must be added to that syntax-check list as well as to the test suite.

## Import Organization

**Order:**
1. Node.js built-ins using `node:` specifiers.
2. Repository-relative modules using explicit `.js` extensions.

**Grouping:**
- Imports are normally contiguous at the top of the file without blank subgroup separators.
- Use named imports/exports; default exports and barrel files are not used.
- No path aliases are configured.

## Contract Design

**Versioning:**
- Every durable JSON artifact declares a stable schema/version field.
- Export schema constants from the module that owns validation.
- Preserve backward-compatible admission paths deliberately; do not infer compatibility from command history.

**Builders and Validators:**
- Builders accept parsed objects and options and return deterministic plain objects.
- Validators return `{ ok, errors, warnings, ... }` and accumulate all useful findings.
- Builders throw before writing when upstream contracts, IDs, targets, or safety state are invalid.

**Reports and Formatters:**
- Keep machine JSON objects separate from human text formatting.
- A report may summarize evidence but must not strengthen its certification claims.
- Bound or redact persisted paths and text before returning/printing them.

## Error Handling

**Patterns:**
- Throw descriptive `Error` instances at parsing, validation, I/O, and runtime boundaries.
- Catch uncaught errors only at `bin/agentmo.js`; redact text and set `process.exitCode = 1`.
- Report commands set a failing exit code when their returned `ok` field is false.
- Fail closed on unsafe discovery state, mismatched provenance, missing evidence, raw output, or secret-like values.

**File Writes:**
- Prefer atomic temp-file-plus-rename writes for managed JSON/text artifacts.
- Refuse non-empty scaffold targets unless `--force` is explicit.
- Dry-run commands (`plan`, `run-plan`) must not write domain artifacts.

## Logging and Output

**Framework:**
- Use `process.stdout.write` for normal CLI output and `process.stderr.write` for validation failures.
- `console.error` is reserved for the redacted top-level fatal boundary.
- No general logger or telemetry framework is present.

**Security:**
- Never print or persist credential values, raw provider payloads, transcripts, raw tool bodies, or unredacted stdout/stderr previews.
- Environment evidence records key names/presence only.
- Do not read `.env`; `.env.example` may be read if it exists.

## Comments and Documentation

**Comments:**
- Prefer self-describing functions; comments should explain evidence semantics, safety rationale, or non-obvious compatibility behavior.
- Avoid comments that merely restate code.

**Docs synchronization:**
- A change to CLI, contracts, schemas, discovery/plan/produce behavior, evidence semantics, runbooks, or architecture must trigger a docs/release review.
- Release records contain paths, commands, hashes/status, and bounded risk summaries, never raw logs or secrets.

## Function and Module Design

**Functions:**
- Separate pure computation from filesystem/process effects where practical.
- Accept an options object for optional behavior and dependency injection.
- Runtime tests inject a `commandRunner` rather than requiring a real provider.

**Modules:**
- One mechanism or artifact family per module.
- Public exports appear near the top; private helpers follow.
- Avoid hidden cross-stage calls: Stage 2 consumes a discovery contract, and Stage 3 consumes a design contract.

## Testing Conventions

- Use `node:test` `describe`/`it` and `node:assert/strict`.
- Test success and fail-closed cases together.
- Use `mkdtemp()` under the OS temp directory for filesystem behavior.
- Spawn `process.execPath` for CLI integration instead of shell interpolation.
- Assert exact artifact lists and certification flags when those are part of a contract.

## Collaboration Contract

**Alex:**
- Owns product direction, business acceptance, merge, and release decisions.

**Echo:**
- Owns feature-branch implementation, tests, explicit-path staging, PR evidence, and engineering feedback.
- Does not push directly to `main`.

**Codex:**
- Owns task decomposition, review, contract-boundary checks, docs/release maintenance, and authorized publishing support.
- Does not replace Echo's implementation ownership or Alex's decision authority.

**Shared workflow:**
- Alex defines the goal -> Codex decomposes/guards -> Echo implements/tests/opens PR -> Codex reviews -> Alex decides merge -> Codex assists release when authorized.
- Use explicit `git add <paths>`; never use `git add .` or `git add -A`.
- Do not commit unless the user explicitly asks in the active session.

---

*Convention analysis: 2026-07-10*
*Update when code style, artifact contracts, or team roles change*
