# Phase 04: 确定性 Package 与所有权安全安装 - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 38 个预计新增/修改代码文件（20 个生产/发行文件，18 个测试文件；维护文档与 release records 另计）
**Analog clusters:** 5 个强类比簇；4 类能力只有部分类比
**Scope:** 只映射 AgentMo 仓库现有模式；不把 sibling repo 或 live OpenClaw state 当作实现类比

## 结论先行

Phase 4 不需要发明新的总体风格。应沿用现有五条主干：

1. `artifact-admission.js` + `artifact-registry.js` + `artifact-subjects.js` 的闭集 subject、exact raw-byte digest、真实 admission result；
2. `persistability.js` 的 value-blind 审计、canonical JSON 与写前重审；
3. `plan-approval.js` 的 deterministic preview、exact digest approval、stale input fail-closed；
4. `targets/operations.js` + `targets/openclaw.js` 的 target-neutral operation 排序与 adapter 边界；
5. `builder-package.js` + `builder-install.js` 的显式发行 inventory、retained handle、project/user scope 分离、receipt-last 与 preserve-first recovery。

必须保持独立的部分：

- Builder/Codex 的 package、marketplace、receipt schema 不能直接变成 OpenClaw Agent Package schema；
- Phase 3 的 `agentmo.plan-approval.v1` 只授权进入 Produce，不能充当 install approval；
- OpenClaw runtime exec approval 不能充当 AgentMo install authority；
- package inspect/probe/install receipt 不能升级为 Phase 5 runtime/domain/Birth/Delivery evidence；
- 当前 Builder recovery 的“不物理删除”可作为安全下界，但 Phase 4 的四条件 pristine rollback 必须有独立 journal、validator 与测试，不能靠 Builder path marker 推断。

## File Classification

### 生产与发行文件

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/build-contract.js` | model/config | Phase 3 construction-intent extension | existing closed specification validators and exact plan approval binding | exact extension |
| `src/package-contract.js` | model/config | transform + exact validation | `src/artifact-registry.js`, `src/build-contract.js` | exact role |
| `src/package-carriers.js` | service | transform | `src/build-contract.js`, `test/openclaw-resource-projection.test.js` | role/data-flow |
| `src/package-produce.js` | service | batch + file-I/O | `src/builder-package.js`, `src/persistability.js` | role-match |
| `src/package-archive.js` | utility | batch + file-I/O | `src/builder-package.js` inventory/digest closure | partial |
| `src/package-inspect.js` | service/report | file-I/O + request-response | `inspectBuilderPackageForDiagnostics`, `emitPersistableOutput` | role-match |
| `src/targets/openclaw-package.js` | target adapter | transform | `src/targets/openclaw.js`, `src/targets/operations.js` | exact role |
| `src/openclaw-target-admission.js` | authority/model | exact candidate validation + create-only output | `src/plan-approval.js`, `src/artifact-admission.js` | exact role |
| `src/openclaw-probe.js` | service | request-response + child-process observation | `src/runtime-compatibility.js`, `readBoundedNoFollowFile` | partial |
| `src/openclaw-install-plan.js` | service/model | CRUD preview + transform | `prepareInstall`, `buildBuilderInstallApprovalBasis` | role/data-flow |
| `src/openclaw-install-approval.js` | service/model | request-response | `src/plan-approval.js` | exact role |
| `src/openclaw-install-transaction.js` | service | file-I/O + event-driven transaction | `applyBuilderInstall`, `publishStagedFile` | role/data-flow |
| `src/openclaw-install-receipt.js` | model/service | transform + file-I/O | Builder projected/activated receipt validators | role-match |
| `src/openclaw-credential-handoff.js` | service | request-response + optional child process | `SecretRef`/`SecretPresence` in `persistability.js` | partial |
| `src/artifact-contract.js` | config/model | transform | existing artifact contract tables | exact extension |
| `src/artifact-subjects.js` | config/registry | request-response | `DURABLE_COMMAND_SUBJECTS` | exact extension |
| `src/artifact-registry.js` | config/registry | exact validation | `DURABLE_ARTIFACT_REGISTRY` | exact extension |
| `src/cli.js` | controller | request-response | `runtime-check` branch + stable formatters | exact role |
| `src/builder-package.js` | config/service | batch + packed distribution | `buildBuilderReleaseAssetInventory` | exact extension |
| `package.json` | config | packed distribution | explicit `files` allowlist + `check` script | exact extension |

### 测试文件

| New/Modified File | Role | Data Flow | Closest Test Analog | Match Quality |
|---|---|---|---|---|
| `test/openclaw-build-contract.test.js` | test/contract | canonical recipe/content + digest mutation | existing OpenClaw specification closure matrix | exact extension |
| `test/package-contract.test.js` | test | transform/validation | `test/artifact-admission.test.js`, `test/build-contract.test.js` | exact |
| `test/package-carriers.test.js` | test/security | transform | `test/openclaw-resource-projection.test.js` | exact |
| `test/package-produce.test.js` | test/integration | batch + file-I/O | `test/builder-package-security.test.js` | role-match |
| `test/package-determinism.test.js` | test/integration | batch + file-I/O | packed inventory/release digest tests | partial |
| `test/package-inspect.test.js` | test/security | file-I/O + request-response | `test/runtime-compatibility.test.js` bounded report tests | role-match |
| `test/openclaw-package.test.js` | test | transform | `test/openclaw-resource-projection.test.js` | exact |
| `test/openclaw-target-admission.test.js` | test/security | exact candidate bytes + checkpoint authority | `test/discovery-approval.test.js`, `test/artifact-admission.test.js` | exact role |
| `test/openclaw-probe.test.js` | test/security | child-process + file-I/O | `test/runtime-compatibility-seams.test.js` | partial |
| `test/openclaw-install-plan.test.js` | test/contract | transform | `test/build-contract.test.js` preview/stale binding matrix | exact role |
| `test/openclaw-install-approval.test.js` | test/security | request-response | `test/build-contract.test.js` lines 135-190 | exact role |
| `test/openclaw-install-transaction.test.js` | test/security/integration | file-I/O transaction | `test/builder-install-security.test.js` | exact role |
| `test/phase4-contracts.test.js` | test/regression | batch | `test/phase3-contracts.test.js`, `test/stage-contracts.test.js` | exact role |
| `test/artifact-admission.test.js` | test/security | exact raw-byte subject admission | existing artifact-admission matrix | exact extension |
| `test/artifact-contract.test.js` | test/contract | public schema/minimal-template closure | existing artifact-contract matrix | exact extension |
| `test/artifact-surface-coverage.test.js` | test/regression | registry/CLI/packed surface closure | existing closed-surface inventory | exact extension |
| `test/builder-packed-install.test.js` | test/packaging | packed distribution | existing packed setup suite | exact extension |
| `test/stage-contracts.test.js` | test/regression | stage boundary | existing declared/live/domain independence tests | exact extension |

## Pattern Assignments

### 1. `src/package-contract.js` 与 artifact 注册面

**Apply to:** `src/package-contract.js`, `src/artifact-contract.js`, `src/artifact-subjects.js`, `src/artifact-registry.js`

**Primary analog:** `src/artifact-registry.js`

#### 闭集 descriptor pattern

`src/artifact-registry.js:180-253`：

```js
export const DURABLE_ARTIFACT_REGISTRY = Object.freeze([
  // ...
  Object.freeze({
    subject: "build-contract",
    identity_field: "schemaVersion",
    identity: "agentmo.build-contract.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalBuildContract,
  }),
  Object.freeze({
    subject: "plan-approval",
    identity_field: "schemaVersion",
    identity: "agentmo.plan-approval.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalPlanApproval,
  }),
]);
```

Phase 4 新 durable artifacts 应按同一模式注册，并有独立 validator：

- `package-manifest`
- `openclaw-probe`
- `openclaw-install-plan`
- `openclaw-install-approval`
- `openclaw-sensitive-action-decision`
- `openclaw-conflict-approval`
- `openclaw-install-receipt`

具体 subject 数量可以由 planner 收敛，但 ordinary approval、每项 sensitive action、whole conflict set 不得合并成一个可扩大 scope 的 subject。

#### command → exact subject set pattern

`src/artifact-subjects.js:42-70`：

```js
export const DURABLE_COMMAND_SUBJECTS = Object.freeze({
  "build-contract": BUILD_CONTRACT_SUBJECTS,
  "plan-approve": PLAN_APPROVAL_SUBJECTS,
  // ...
});
```

`package produce/inspect`、`openclaw probe/preview/approve/apply` 应分别声明所需 durable inputs。特别是 Produce 入口必须重新 admission blueprint、build contract、discovery approval、decision ledger 与 plan approval；不能只接收解析后的 JS object。

#### raw-byte admission pattern

`src/artifact-admission.js:109-170`：

```js
const bytes = await readBoundedArtifact(options?.filePath, maxBytes, options?.openInput ?? open);
const actualDigest = digestRawBytes(bytes);
if (!sameDigest(actualDigest, expectedDigest)) {
  throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_MISMATCH");
}
// UTF-8, duplicate identity, JSON, value-blind audit
const descriptor = resolveDurableArtifactDescriptor(value, subject, { validationContext });
deepFreezeJson(value);
```

`src/artifact-admission.js:348-395` 同时给出 retained read handle 的稳定性检查：读取前后比较 `dev`、`ino`、`size`、`mtimeNs`、`ctimeNs`，并在 finally 关闭 handle。Package manifest、probe、plan、approvals 与 receipt 的 admission 均应复用这个原则。

**Reuse exactly:**

- `digestRawBytes` digest syntax；
- bounded UTF-8 JSON admission；
- duplicate identity rejection；
- registry-based subject/identity matching；
- authentic admitted result，而不是 caller 自报 `{ ok: true }`；
- companion source exact set。

**Keep separate:**

- package directory member admission 需要 path/mode/type/size/digest inventory validator，不能把单 JSON artifact admission 当目录 closure；
- manifest 不应索引自己的 digest；manifest raw digest 由 inspect/install plan 外层绑定；
- install approvals 是新 subjects，不扩展 `agentmo.plan-approval.v1` 的 `decisionScope: "enter-produce"`。

### 2. `src/package-produce.js`, `src/package-archive.js`, `src/package-inspect.js`

**Primary analogs:** `src/persistability.js`, `src/builder-package.js`

#### canonical/value-blind output pattern

`src/persistability.js:113-133`：

```js
export function serializePersistableJson(value, options = {}) {
  const { clone, limits } = validatePersistable(value, options);
  const serialized = `${JSON.stringify(clone, null, 2)}\n`;
  assertFinalText(serialized, limits.maxBytes, { rejectRawLanguage: false });
  return serialized;
}

export async function writePersistableJsonAtomic(filePath, value, options = {}) {
  const serialized = serializePersistableJson(value, options);
  return writeValidatedTextAtomic(filePath, serialized, options);
}
```

`src/persistability.js:223-242`：

```js
const clone = visit(value, null, 0, state, { allowPolicyLanguage: false });
if (measureJsonBytes(clone, limits.maxBytes) > limits.maxBytes) {
  fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
}
const audit = auditEvidence(clone);
if (!audit.ok) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
```

`src/persistability.js:629-641`：

```js
const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
await io.mkdir(path.dirname(filePath), { recursive: true });
await io.writeFile(temporaryFile, text, "utf8");
await io.rename(temporaryFile, filePath);
```

Package 生成可复用 canonical JSON、value-blind audit 与 write-before-publish 审计；但多文件 package 需要自己的 absent output root、完整 staging directory 和目录级 commit，不应逐文件暴露半成品。

#### explicit executable inventory pattern

`src/builder-package.js:989-1079`：

```js
const runtimeSourceFiles = [
  "bin/agentmo.js",
  "package.json",
  "src/artifact-admission.js",
  // explicit closed list
];
const descriptors = [
  ...runtimeSourceFiles.map((sourcePath) => ({
    kind: "runtime",
    sourcePath,
    relativePath: `runtime/agentmo/${sourcePath}`,
    destinationPath: `plugins/agentmo/runtime/agentmo/${sourcePath}`,
  })),
].sort((left, right) => left.destinationPath.localeCompare(right.destinationPath));
```

`src/builder-package.js:1082-1116` 验证 exact keys、portable paths、唯一 source/relative/destination path，并与 canonical inventory 按索引逐项相等。Phase 4 package 应照此建立真实 byte inventory，覆盖 prompt、skill、tool binding、hook implementation、memory policy、eval、permission、evidence boundary 和 OpenClaw projection；只在 manifest 声明名字不算 materialized。

#### offline inspect pattern

`src/builder-package.js:163-220`：

```js
const resultBasis = {
  schemaVersion: "agentmo.builder-package-diagnostic.v1",
  diagnosticOnly: true,
  trustAnchorVerified: false,
  supportCertified: false,
};
// ...
return Object.freeze({
  ...resultBasis,
  source,
  status: "observed",
  candidate: summarizeDiagnosticCandidate(release),
});
```

`src/builder-package.js:224-237` 只返回 bounded identity、digest 与 byte length。`package inspect` 应形成一个 canonical summary object，再分别格式化 human/JSON；两个 surface 必须语义等价，不得在 human formatter 重新读取 filesystem。

#### no-follow member read pattern

`src/builder-package.js:336-365`：

```js
before = await lstat(filePath, { bigint: true });
if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) {
  fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
}
handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
const retainedBefore = await handle.stat({ bigint: true });
// read, then retained/path revalidation
```

每个 package member 必须拒绝 symlink/hardlink/device、absolute/`..`/backslash/NUL、case-fold/Unicode collision，并以 retained handle 计算 bytes/digest。

**Reuse exactly:**

- explicit sorted inventory；
- portable relative path；
- per-member digest/byte length；
- no-follow bounded read；
- value-blind persistability audit；
- frozen inspection result。

**Keep separate:**

- deterministic archive 没有完整现成 encoder；只可复用 inventory/digest closure；
- archive 必须固定 order/mode/mtime/uid/gid，不能调用平台默认 `tar` 后假设 deterministic；
- package directory 是确定性 build authority；从该目录重建的 deterministic archive 是 preview、approval、apply 的唯一 transport，不能退回 package root 或 manifest-only 输入；
- 每次 preview、approval、apply authority 都必须绑定 archive 外部 SHA-256、内部 manifest digest、canonical inventory digest 与完整 `{relativePath,type,mode,byteLength,sha256}` member closure；
- package inspect 的 `status: observed` 不能表示 runtime loaded 或 domain verified。

### 3. `src/package-carriers.js` 与 `src/targets/openclaw-package.js`

**Primary analogs:** `src/targets/operations.js`, `src/targets/openclaw.js`, `test/openclaw-resource-projection.test.js`

#### deterministic operation list

`src/targets/operations.js:3-20`：

```js
return Array.from(files.entries())
  .sort(([left], [right]) => comparePaths(left, right))
  .map(([relativePath, content]) => {
    const operation = {
      kind: "write-file",
      relativePath,
      ownership: "managed",
      source: typeof source === "function" ? source(relativePath) : source,
      scaffoldOnly: true,
    };
    Object.defineProperty(operation, "content", {
      value: content,
      enumerable: false,
    });
    return operation;
  });
```

Phase 4 应保留“stable metadata 可序列化、raw bytes 不枚举”的 separation，但把 `scaffoldOnly: true` 替换为明确 package/projection operation contract，不能误继承 scaffold certification。

#### target adapter boundary

`src/targets/openclaw.js:5-18`：

```js
export const openClawTarget = {
  id: "openclaw",
  runtimeId: "openclaw",
  unsupportedSurfaces: ["Runtime certification is not implied by scaffold generation."],
  supports: () => true,
  planOperations(blueprint, context) {
    return fileMapToWriteOperations(/* ... */);
  },
};
```

`src/targets/openclaw-package.js` 应只做 canonical package → OpenClaw native projection。Canonical manifest 不得引用 OpenClaw-only path 作为其语义 authority；未来 target 通过新 adapter 增加。

#### resource owner/lifecycle closure

`test/openclaw-resource-projection.test.js:21-40`：

```js
assert.equal(new Set(contract.resources.map(({ id }) => id)).size, OPENCLAW_RESOURCE_KINDS.length);
for (const resource of contract.resources) {
  assert.deepEqual(resource.lifecycle, {
    declared: "phase-3",
    materialized: "phase-4",
    verified: "phase-5",
  });
  assert.equal(typeof resource.projection.disposition, "string");
}
```

Carrier compiler 必须逐 capability 产生：

- carrier；
- owner；
- approved canonical recipe path/content/mode/per-file digest/recipe digest/version for a generated native-plugin carrier；
- permission；
- approval requirement；
- failure semantics；
- unsupported behavior；
- 选择最低信任载体的理由。

**Reuse exactly:**

- deterministic path order；
- one resource id / one owner / one projection disposition；
- declared/materialized/verified 的 Phase 3/4/5 边界；
- target adapter 与 canonical contract 分离。

**Keep separate:**

- workspace/content/skill、MCP、native plugin、hook 各自独立 carrier；
- 不能把 abstract hook 名字列表当 implementation；
- 若四个 hook 没有 approved bundled owner，必须 fail closed 并回到 Phase 3 重批 package-local plugin canonical recipe；Plan 04-02 不接受 pre-existing plugin path，Plan 04-03 才生成 bytes；
- MCP 仅在确有 isolated external executable 时生成，不能预留模糊自动安装权。

### 4. `src/openclaw-probe.js` 与 runtime-check/probe surface

**Primary analogs:** `src/runtime-compatibility.js`, `src/builder-package.js`, `src/cli.js`

#### pure observation vs production authority

`src/runtime-compatibility.js:18-35`：

```js
export function observeCurrentRuntime() {
  return buildCurrentRuntimeObservation(process.versions.node);
}

export function assertCurrentOpenClawTargetRuntime() {
  if (arguments.length !== 0) {
    const error = new Error("Runtime authorization accepts no caller-supplied inputs.");
    error.code = "AGENTMO_OPENCLAW_RUNTIME_INPUT_REJECTED";
    throw error;
  }
  const observation = buildCurrentRuntimeObservation(process.versions.node);
  if (!observation.supported) {
    // fail closed
  }
  return observation;
}
```

`src/cli.js:511-519`：

```js
if (command === "runtime-check") {
  const options = parseRuntimeCheckArgs(rest);
  const observation = assertCurrentOpenClawTargetRuntime();
  await emitNonArtifactOutput(observation, {
    json: options.json,
    subject: "runtime-check",
    format: formatRuntimeCheck,
  });
  return;
}
```

OpenClaw probe 应保留“pure normalizer/validator”与“production observation authority”分离。不同点是 probe 将成为可绑定 install plan 的 durable artifact，因此不能继续注册为 `non-artifact`。

#### bounded report shape

`src/runtime-compatibility.js:45-53`：

```js
return Object.freeze({
  component: "openclaw-target",
  target: "openclaw",
  observedVersion,
  range: OPENCLAW_TARGET_NODE_RANGE,
  supported: isOpenClawTargetNodeSupported(observedVersion),
  evidenceClass: "current-process",
});
```

Phase 4 fingerprint 至少扩展为：binary/source identity、version/revision、Node、CLI/JSON contract、workspace/skill/plugin/MCP surface、sandbox/tool policy、permission route、target roots/config digest、conflict state。Fingerprint digest 只绑定 normalized facts，不包含 temp path、HOME、raw stdout/stderr、auth/session/profile values。

**Reuse exactly:**

- fixed frozen observation shape；
- caller override rejection；
- bounded stable error codes；
- human/JSON 共享一个 candidate；
- target bytes 使用 retained/no-follow direct FS observation。

**Keep separate / new implementation required:**

- synthetic HOME + explicit temp state/config/workspace；
- fixed executable/argv、`shell: false`、explicit env allowlist；
- probe 后 filesystem diff，只允许 synthetic tree 变化；
- CLI stdout/stderr 先 bounded/redacted，再只保留 normalized facts；
- real HOME/state 永不作为 CLI probe sandbox；
- exact `2026.6.11` / `29d018f0…` target 缺失时 real apply 必须阻塞。

### 5. `src/openclaw-install-plan.js` 与 `src/openclaw-install-approval.js`

**Primary analogs:** `src/plan-approval.js`, `src/builder-install.js`

#### deterministic preview digest

`src/plan-approval.js:58-74`：

```js
const body = {
  schemaVersion: PLAN_APPROVAL_PREVIEW_SCHEMA_VERSION,
  decisionScope: "enter-produce",
  bindings,
  approvalCoverage: buildApprovalCoverage(buildContract),
  certificationBoundary: { ...CERTIFICATION_BOUNDARY },
};
const bytes = Buffer.from(serializePersistableJson(body, {
  subject: "plan-approval-preview",
}), "utf8");
return deepFreeze({
  ...body,
  previewDigest: digestRawBytes(bytes),
});
```

Install preview 应同样先 canonicalize，再 digest。它只能读取 D-42 archive transport，并在任何副作用前通过 no-follow retained handle 验证 archive 与所有成员的完整 closure。Basis 必须绑定：

- archive 外部 SHA-256、内部 package manifest digest、canonical inventory digest 与完整 member closure；
- probe fingerprint digest；
- target scope/root identity/config digest；
- exact operation list；
- minimal config patch；
- whole conflict set digest；
- per-operation current/desired digest、mode、owner、rollback eligibility；
- per-sensitive-action exact executable/argv/cwd/scope/target/timeout/environment-name set。

#### explicit approval and stale-preview rejection

`src/plan-approval.js:77-107`：

```js
if (options.approve !== true) {
  throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_REQUIRED");
}
const preview = buildPlanApprovalPreview(blueprint, buildContract, options);
if (preview.previewDigest !== options.previewDigest) {
  throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_PREVIEW_MISMATCH");
}
// validate, persistability-check, brand authentic candidate, deep-freeze
```

`src/plan-approval.js:131-161` 使用 branded WeakSet、`open(target, "wx", 0o600)`、`sync()`，避免 forged candidate 或覆盖已有 approval。三个 install authority families 都应使用同一原则。

#### project/user scope is part of authority

`src/builder-install.js:1760-1843`：

```js
const hostScope = admitHostScope(options.hostScope);
const hostActivation = hostScope === "user"
  ? await prepareCodexActivation(projection, options)
  : null;
// ...
const approvalBasis = buildBuilderInstallApprovalBasis({
  projectionDigest,
  scopeDigest: prepared.scopeDigest,
  projectRootIdentity,
  priorReceipt,
  allFiles,
  hostActivation,
});
```

默认 isolated project plan 与 user/shared plan 必须是不同 digest/authority。一个 UI 可以同时显示，但 durable decisions 仍分别绑定 ordinary plan、每个 sensitive action、整个 exact conflict set。

#### three-way classification

`src/builder-install.js:2898-2946`：

```js
const observed = await inspectProjectPath(projectRoot, desired.relativePath);
if (observed.status === "absent") {
  // create with exact absent/parent precondition
}
if (observed.status !== "file") fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
if (observed.digest !== desired.destinationDigest) {
  fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
}
const receiptOwned = priorReceipt !== null;
// ...
if (desired.ownership !== "shared-marketplace-file" && !receiptOwned && !recoveryOwned) {
  fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
}
```

Phase 4 应扩展为明确的三方比较：

| Base/owner evidence | Current | Desired | Classification |
|---|---|---|---|
| absent | absent | bytes | create |
| AgentMo-owned prior digest | equals base | new bytes | safe managed update |
| AgentMo-owned prior digest | differs base | any | modified conflict, preserve |
| unknown/external | equals desired | same bytes | shared/exact only，不能自动宣称 owned |
| unknown/external | differs desired | new bytes | exact conflict approval required |

**Reuse exactly:**

- canonical preview digest；
- approval requires explicit boolean and exact preview digest；
- exact source/target/scope binding；
- stale plan fails before mutation；
- branded candidate and create-only approval publish；
- current path type/digest/identity in plan basis。

**Keep separate:**

- ordinary approval、sensitive decision、conflict-set approval 是三个 schema；
- conflict approval 必须逐项绑定 path/current digest/desired digest/action，集合任一项漂移则整体失效；
- credential setup proposal 不是 approval，也不能包含 secret value；
- approval 不代表 install success/runtime success/domain quality。

### 6. `src/openclaw-install-transaction.js`, `src/openclaw-install-receipt.js`, `src/openclaw-credential-handoff.js`

**Primary analog:** `src/builder-install.js`

#### receipt-last transaction ordering

`src/builder-install.js:1532-1657`：

```js
const mutationLedger = createMutationLedger(prepared);
await assertApprovedInitialState(prepared, mutationLedger);
let installAttempt = await beginInstallAttempt(prepared);
// stage all create operations
// publish non-receipt members
// post-observe all managed files
const finalizedReceiptStage = staged.find(
  (candidate) => candidate.desired.relativePath === BUILDER_INSTALL_RECEIPT_PATH,
);
if (finalizedReceiptStage) {
  publishedReceipt = await publishStagedFile(/* ... */);
}
await assertInstalledDigest(/* receipt */);
```

严格沿用依赖顺序：

```text
package -> inspect/probe -> preview -> approval -> re-probe
        -> private attempt journal -> mutations -> post-observe -> receipt-last
```

#### retained parent/file authority

`src/builder-install.js:3443-3485`：

```js
await assertAuthorizedParentChain(projectRoot, staged.desired.relativePath, ledger);
await assertStagedFileExact(staged);
parentAuthority = await retainEffectDirectory(path.dirname(destination));
// absent-only publication
const publishedIdentity = await lstat(destination, { bigint: true });
if (!sameIdentity(publishedIdentity, await staged.handle.stat({ bigint: true }))) {
  fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
}
```

`src/builder-install.js:3488-3516` 以 `O_DIRECTORY | O_NOFOLLOW` retain parent，并比较 dev/inode/uid/gid/mode；`3524-3545` 再次验证 staged inode、link count 与 digest。这是 apply/re-probe 之后实际写入的最低安全模式。

#### path containment

`src/builder-install.js:3709-3727`：

```js
if (!portableRelativePath(relativePath)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
const destination = path.resolve(projectRoot, ...relativePath.split("/"));
if (!isInside(projectRoot, destination)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
```

#### preserve-first recovery

`src/builder-install.js:513-533` 的 recovery result 明确：

```js
retainedStageCount: 0,
retainedPublishedCount: 0,
physicalDeletion: false,
mutatesProject: true,
mutatesHost: false,
repreviewRequired: appendOnlySuffix,
domainQualityCertified: false,
```

Phase 4 可在更强证据满足时进行自动 rollback，但 predicate 必须同时满足：

1. `createdByThisAttempt === true`；
2. owner marker digest 与 journal 相等；
3. retained/current file identity 与创建 identity 相等；
4. current content digest 仍等于 desired digest。

任一失败都 preserve，并发布 bounded incomplete receipt；禁止 recursive delete、按 path 猜 ownership、或用破坏性清理伪造 atomic success。

#### user-scope projection remains separate

`src/builder-install.js:2474-2514` 把 projection digest、prepare 与 publish 分成独立函数，publish 还要求 durable reservation：

```js
export async function publishBuilderCodexMarketplaceProjection(prepared) {
  if (prepared.reservation === undefined) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_RESERVATION_REQUIRED");
  }
  prepared.appliedProjection = await publishCodexMarketplaceProjection(/* ... */);
}
```

OpenClaw user/shared operation 同样必须有独立 exact plan/approval，不得由 project plan 隐式进入。

#### credential value-blind carrier

`src/persistability.js:69-91`：

```js
export function isSecretRef(value) {
  const fields = exactDataFields(value, ["kind", "source", "name"]);
  return fields !== null
    && fields.kind === "SecretRef"
    && fields.source === "runtime-env"
    && isSecretName(fields.name);
}

export function isSecretPresence(value) {
  // exact allowed/present/missing name sets
  // valuesPersisted must be false
}
```

Phase 4 credential handoff 应针对 OpenClaw official auth/secrets route 定义新的 value-blind ref/presence schema；不可硬复用 `source: "runtime-env"` 来描述 OpenClaw profile，也不可接收 secret value、raw argv value、raw command output。

**Reuse exactly:**

- private attempt journal first；
- absent-only/staged publication；
- retained handles + parent identity；
- exact post-observation；
- receipt published last；
- incomplete recovery remains non-certifying；
- host/user scope mutation requires additional authority。

**Keep separate:**

- Agent Package install receipt schema 与 Builder receipt v2/v4 分开；
- OpenClaw official `config patch --dry-run --json`/credential/plugin/MCP routes 保持 target adapter action，不把它们变成 AgentMo authority；
- config patch 必须绑定 base digest 且只改最小字段，不能 whole-file overwrite；
- official process/network/credential action 每项仍需 exact sensitive decision；
- receipt 只记 SecretRef、presence、route、bounded result，不记值或 raw stdout/stderr。

### 7. `src/cli.js` 的 human/JSON surfaces

**Analog:** `runtime-check` controller + existing formatter pattern

`src/cli.js:511-519` 展示 controller 只负责 parse → authoritative service → shared output adapter。`src/cli.js:4052-4062` 展示 human formatter 只消费 canonical result：

```js
function formatBuildPlan(plan) {
  const lines = [
    `AgentMo build plan: ${plan.agentId}`,
    `Target: ${plan.selectedTargetId}`,
  ];
  for (const operation of plan.operations) {
    lines.push(`- ${operation.kind} ${operation.relativePath}`);
  }
  return `${lines.join("\n")}\n`;
}
```

建议 CLI controller 只组合以下 service，不内联 schema/mutation：

- package produce；
- package inspect；
- OpenClaw probe；
- install preview；
- install approve（ordinary/sensitive/conflict）；
- install apply；
- receipt inspect/recovery inspect。

Human 与 JSON 必须从同一个 frozen summary 格式化。JSON 使用 canonical persistable output；human 输出不得包含 secret/path/raw process output，错误只暴露稳定 code 与 bounded guidance。Probe 只产生只读 target fingerprint；它不得替代 archive closure，也不得让 preview、approval 或 transaction 回读 canonical package directory。

## Test Pattern Assignments

Phase 4 focused tests 必须独立漂移 archive 外部 digest、manifest digest、inventory digest、member set、path/type/mode/length/content digest 与 retained identity。Install transaction 只能消费已批准的 archive closure，在副作用前重新探测 target、重新验证 retained archive/member identity，并以 receipt-last 收口；directory build authority 不能作为 apply 输入。

### Contract 与 exact authority

`test/build-contract.test.js:135-190` 是 install approval tests 的直接模板：

```js
const preview = buildPlanApprovalPreview(/* admitted inputs */);
assert.deepEqual(buildPlanApprovalPreview(/* same inputs */), preview);
assert.throws(
  () => buildPlanApproval(/* no approve */),
  (error) => error?.code === "AGENTMO_PLAN_APPROVAL_REQUIRED",
);
// mutate every source digest and expect validation false
await writePlanApproval(out, approval);
await assert.rejects(() => writePlanApproval(out, approval));
await assert.rejects(() => writePlanApproval(forgedPath, structuredClone(approval)));
```

`test/package-contract.test.js` 与 `test/openclaw-install-approval.test.js` 应系统覆盖：

- exact keys / unknown field；
- wrong schema/subject swap；
- byte mutation before decode；
- forged admitted result；
- missing/deny/cancel/timeout/expired/reused；
- package/fingerprint/target/scope/operation/argv/env-name/conflict-set 任一漂移；
- ordinary approval 不能授权 sensitive/user/conflict；
- conflict approval 不能重放到新 current bytes 或新集合。

### Carrier 与 projection closure

`test/openclaw-resource-projection.test.js:43-57` 的 mutation table 应扩展到：

- omitted/duplicate resource；
- declaration 有 capability 但 Phase 3-approved canonical recipe 缺失，或 Plan 04-03 recipe-derived implementation file 缺失；
- unindexed extra member；
- hook 无 owner/event/version/digest/failure；
- content 不必要升级为 plugin；
- MCP 无 executable；
- plugin 无批准或使用 legacy hook installer；
- materialized lifecycle 被错误标成 verified。

### Probe

`test/runtime-compatibility.test.js:63-118` 的 malformed table 与 anti-bypass assertions 应扩展到完整 fingerprint。
`test/runtime-compatibility-seams.test.js:106-135` 的 mutation inventory/order assertions 应增加 Phase 4 唯一 mutation seam，并验证每条 mutation journey 都经过 exact re-probe。

Probe test 还必须使用 synthetic HOME sentinel：

- real HOME/state/config/workspace bytes before/after 相同；
- synthetic tree 可被完整丢弃；
- fake CLI 输出 malformed/oversized/secret-like/raw path 时 fail closed；
- version 相同但 CLI JSON schema、policy、permission route、target path、conflict bytes 不同，fingerprint 必须不同；
- source revision 不等于 approved `29d018f0…` 时 incompatible。

### Transaction 与 rollback

直接借鉴现有测试命名/意图：

- `test/builder-install-security.test.js:1781`：late destination inode 必须 preserve；
- `:1806`：unregistered same-inode sibling 不得修改 link；
- `:1842`：未获正确 receipt/authority 时不得 host mutation；
- `:1878`：无 durable reservation 不得 publish；
- `:1898`：被 kill 的 reservation 只恢复/保留，不做猜测性删除；
- `:1997`：exact replay 必须幂等且仍追加有界 attempt evidence。

Phase 4 独有 matrix：

- fresh project install；
- exact repeat；
- AgentMo-owned pristine update；
- AgentMo-owned modified conflict；
- unknown/external exact bytes；
- unknown/external differing bytes；
- inode swap、symlink swap、parent swap；
- interruption before first write / mid-write / after external action / before receipt / after receipt；
- rollback 四条件每项分别失败；
- incomplete receipt 列出 preserved assets；
- receipt 不得先于所有 post-observation；
- credential/session/db/transcript/provider payload/stdout/stderr hostile canary 不得进入任何 durable artifact。

### Packed distribution

`test/builder-packed-install.test.js:1425` 起的 suite 是唯一正确入口。必须扩展现有 inventory 断言，并从 `npm pack` 解出的包导入、执行 Phase 4 modules；不能从 checkout fallback。

现有关键测试：

- `:1426` deterministic fixed runtime inventory / complete import closure；
- `:1595` missing/unlisted/symlinked/duplicate/remapped member fail closed；
- `:2209` 无 checkout 安装 exact plugin/skill/hook/agent/marker/receipt bytes；
- `:3229` owned path conflict 时不发布 receipt；
- `:3240` missing capability before any write；
- `:3250` stale preview before any write；
- `:3265` preview digest binds exact project scope；
- `:3298` symlink escape before outside write；
- `:3313` packed CLI preview-bound setup 与 read-only doctor。

同时修改：

- `package.json:12-95` 的 explicit `files` allowlist；
- `package.json:96-99` 的 `check` script syntax checks；
- `src/builder-package.js:989-1079` 的 runtime inventory；
- `test/artifact-surface-coverage.test.js` 的 source/owner inventory；
- `test/builder-packed-install.test.js` 的 packed import closure。

新增任何 Phase 4 runtime module时，以上四处必须同一任务内更新，否则 source tree green 但 tarball broken。

### Stage boundary

`test/stage-contracts.test.js:383` 的“declared evidence remains non-certifying”应扩展：

- package built/inspect green ≠ installed；
- probe compatible ≠ installed；
- install receipt complete ≠ live-success；
- shadow skill/plugin parse ≠ plugin code executed；
- install receipt ≠ domain eval/Birth/Delivery/production；
- schedule proposal ≠ schedule registered/triggered；
- memory files installed ≠ embedding/RAG/readback/restart recovery。

## Shared Patterns

### Authentication / authorization

本阶段没有传统 HTTP auth。对应的 authority pattern 是：

- raw-byte admitted inputs；
- subject-specific exact digest；
- ordinary/sensitive/conflict 三层不可互换批准；
- scope/target/action/current bytes 全部绑定；
- mutation 前 re-probe；
- missing/deny/cancel/timeout/mismatch/expired/reused 一律 fail closed。

**Source:** `src/plan-approval.js:58-107`, `src/builder-install.js:1508-1535`, `src/builder-install.js:1760-1843`

### Error handling

现有模块使用领域 Error + stable code，不回显底层敏感异常：

```js
export class PlanApprovalError extends Error {
  constructor(code, errors = []) {
    super("Plan approval was rejected.");
    this.name = "PlanApprovalError";
    this.code = code;
    this.errors = [...errors];
  }
}
```

**Source:** `src/plan-approval.js:49-55`

Phase 4 每个边界建议有自己的 error class/code namespace；child-process 和 filesystem 底层错误要归一化，human/JSON 不包含 raw stdout/stderr、absolute HOME/temp path 或 secret-like values。

### Validation

使用手写 closed schema、`plainObject`、`hasExactKeys`、sorted unique arrays、bounded lengths、canonical field order。
**Source:** `src/plan-approval.js:110-128`, `src/artifact-registry.js:788-841`, `src/builder-package.js:1717-1760`

### Canonical digests

只 digest canonical bytes，不 digest任意 JS object 的隐式顺序；统一：

```js
digestRawBytes(Buffer.from(
  serializePersistableJson(value, { subject }),
  "utf8",
));
```

**Source:** `src/plan-approval.js:68-74`, `src/builder-package.js:299-311`, `src/builder-install.js:3730-3736`

### File safety

- path allowlist / containment；
- `lstat` 拒绝 link/device；
- `O_NOFOLLOW`；
- retained handle before/after；
- parent inode/owner/mode authority；
- exact digest post-observation；
- no recursive delete。

**Source:** `src/builder-package.js:336-365`, `src/builder-install.js:3443-3545`, `src/builder-install.js:3709-3727`

### Evidence boundary

所有 Phase 4 report/receipt 明确：

- mechanism only；
- package/install status；
- runtime false；
- domain false；
- production false；
- remaining risks。

**Source:** `src/plan-approval.js:39-47`, `src/builder-package.js:2139-2175`, `src/builder-install.js:1749-1756`

## Reuse vs Keep Separate

| Concern | Reuse | Keep Separate |
|---|---|---|
| Exact artifact admission | digest syntax、raw bytes、registry、companion authenticity | package directory closure 与 member inventory |
| Package model | explicit sorted inventory、per-file digest | `agentmo.package.json` target-neutral；Builder release schema 不复用 |
| Projection | target adapter + deterministic operations | OpenClaw native workspace/skill/config/plugin/MCP paths |
| Approval | canonical preview、exact digest、create-only durable decision | enter-Produce、ordinary install、sensitive action、conflict set 四种 authority |
| Scope | project root digest/identity | isolated project 与 ordinary user/shared plans |
| Mutation | stage、retained handles、parent authority、post-observe、receipt-last | OpenClaw config/auth/plugin/MCP official routes |
| Recovery | append-only attempt evidence、preserve-first | 四条件 pristine rollback 独立实现 |
| Secrets | SecretRef/Presence/value-blind audit principle | OpenClaw credential/profile ref schema，不冒充 runtime-env |
| Inspect | shared frozen candidate、human/JSON formatting | inspect ≠ probe ≠ runtime execute |
| Distribution | package.json files、Builder inventory、packed import closure | Agent package archive 不等于 npm tarball |

## No Exact Analog Found

| File / Capability | Role | Data Flow | Reason / Planner Guidance |
|---|---|---|---|
| `src/package-archive.js` | utility | batch + file-I/O | 没有 canonical archive encoder；以 package directory 为 build authority，先定义 golden vectors，再实现 D-42 唯一 preview/approval/apply transport及其完整 closure |
| `src/openclaw-probe.js` synthetic-HOME CLI lane | service | child-process observation | 现有 runtime-check 只观察当前 Node；必须新增 fake HOME/state/config、explicit env、post-run diff |
| `src/openclaw-install-approval.js` 三层 authority | service/model | request-response | 现有 approval 是单 subject；复用模式但建立 ordinary/per-action/whole-conflict schemas |
| 四条件自动 rollback | service | file-I/O transaction | Builder 当前安全下界偏向 retain/no deletion；Phase 4 需要 created+owner+inode+digest 全真才删除 |
| OpenClaw typed hook implementation | component/plugin | event-driven | 当前 build contract 没有已证明的 bundled owner；Plans 04-01/04-02 必须绑定 Phase 3-reapproved canonical recipe/content 与 target authority，Plan 04-03 solely from recipe 生成 bytes，Phase 4 不得猜测或要求 pre-existing implementation |

## Planner Blocking Gates

1. **Exact OpenClaw target gate:** approved contract 是 `2026.6.11` / `29d018f0…`，本机 `2026.7.1-2` 不可直接 apply。需 exact executable fixture/target，或回 Phase 3 重建并重批。
2. **Hook recipe/carrier gate:** 四个 abstract hooks 必须逐项有 approved event mapping、owner、canonical recipe content/member digest/recipe digest、version、permission、timeout/failure semantics。Plan 04-02 creates authority over future bytes; Plan 04-03 depends on 04-02 and is their first producer, so no reverse dependency or implementation-path input exists.
3. **逐 wave RED-first gate:** Plan 04-01 先创建 package/carrier tests 与可增量扩展的 `phase4-contracts` quick gate；Plans 04-02..11 在实现各自 production behavior 前创建并观察 focused RED tests。不得要求一个与最终 11-plan 数据流冲突的“预先创建全部测试”Wave 0。
4. **D-42 transport gate:** package directory 只作 build authority；probe 不读取 package payload；preview、三类 approval 与 transaction 只消费 exact archive path/digest，并重复绑定、no-follow retained revalidate external archive + internal manifest/inventory/member closure，任一 extra/missing/type/mode/content/identity drift 都在零 mutation 前失败关闭。
5. **Single mutation seam gate:** source inventory/security test 应证明 Phase 4 target mutation 只通过 `openclaw-install-transaction.js`。
6. **Packed closure gate:** 每个新增 runtime module必须同时进入 `package.json`、Builder release inventory、surface coverage 与 packed import test。

## Metadata

**Analog search scope:** `src/`, `src/targets/`, `test/`；未读取 `.env`，未读取 sibling projects
**Strong analog clusters:** artifact admission/registry；persistability；plan approval；target operations；Builder package/install
**Files with exact/role analog:** 33 / 38
**Files with partial/no exact analog:** 5 / 38
**Pattern extraction date:** 2026-07-28
**Working tree note:** 仓库在映射前已有大量用户修改；本文件不推断其 ownership，也未修改任何 source/test/STATE/ROADMAP 文件
