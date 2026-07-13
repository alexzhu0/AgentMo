# AgentMo Build Plan and Build State

AgentMo separates planning from mutation.

## Dry-run plan

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js plan examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js plan examples/win9.agentmo.json --target openclaw --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
```

The plan command validates the blueprint, resolves the target/profile, and emits
deterministic domain operations. It does not write files.

Stable fields include:

- `selectedTargetId`
- `selectedProfileId`
- `selectedModuleIds` (`["default"]` in v0.1)
- `warnings`
- `domainOperationCount`
- `operations[]` with managed generated paths

## Scaffold apply

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
```

Scaffold uses the same domain operation model as the dry-run plan. After the
domain files are written successfully, AgentMo writes a managed sidecar:

```text
agentmo-build-state.json
```

The sidecar is not part of the dry-run domain operation list and is excluded
from dry-run/apply file-list parity checks.

Before the first output directory or file is created, scaffold materializes and validates the complete operation set, product bytes, paths, collisions, and final build-state bytes. An unsafe or mismatched candidate therefore fails with zero managed output writes; this is preflight evidence, not a multi-file transaction guarantee.

## Build-state schema

Current schema version: `agentmo.build.v1`.

Top-level fields:

- `generatedAt`
- `agentId`
- `target`
- `request`
- `resolution`
- `source`
- `operations`

`resolution.domainOperationCount` counts only generated domain outputs. The
sidecar itself is asserted separately.

## Control snapshot

`agentmo status` turns a blueprint, and optionally a scaffold build-state
sidecar, into `agentmo.control.v1`:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js status examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "build-state=$(digest_file "/tmp/win9-openclaw-scaffold/agentmo-build-state.json")"
```

The snapshot is read-only. Missing or unreadable build state is represented as
unavailable so older scaffolds and blueprint-only checks keep working.

## Rollback

The build state file is generated and managed. If Phase 3 must be rolled back,
remove the build-state writer/tests/docs and delete generated
`agentmo-build-state.json` files from output directories.
