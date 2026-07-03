# AgentMo Build Plan and Build State

AgentMo separates planning from mutation.

## Dry-run plan

```bash
./bin/agentmo.js plan examples/win9.agentmo.json --json
./bin/agentmo.js plan examples/win9.agentmo.json --target openclaw --json
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
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold
```

Scaffold uses the same domain operation model as the dry-run plan. After the
domain files are written successfully, AgentMo writes a managed sidecar:

```text
agentmo-build-state.json
```

The sidecar is not part of the dry-run domain operation list and is excluded
from dry-run/apply file-list parity checks.

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

## Rollback

The build state file is generated and managed. If Phase 3 must be rolled back,
remove the build-state writer/tests/docs and delete generated
`agentmo-build-state.json` files from output directories.
