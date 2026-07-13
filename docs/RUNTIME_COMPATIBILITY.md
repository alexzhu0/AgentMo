# AgentMo 运行时兼容性证据

本页是 Phase 01.2 的规范兼容性矩阵。它把声明、官方支持说明、边界合约测试、实际 core 执行和实际 target 执行分开记录，避免把某一类证据自动提升为另一类结论。

## 状态与证据类别

- `tested`：本页列出的有界命令已在对应的实际运行时执行并通过。
- `failed`：本页列出的有界命令已实际执行但未通过。
- `untested`：没有为该项执行能够证明对应结论的有界命令；声明或文档观察不能替代执行。
- `upstream-declared`：来自 package manifest 的声明，不是运行证明。
- `official-supported`：来自官方支持文档的范围，不是本地运行证明。
- `contract-tested`：边界谓词、调用者闭合和拒绝语义已由测试验证。
- `core-executed`：AgentMo core 命令集已由所列实际 Node.js 进程执行。
- `target-executed`：OpenClaw target 已发生真实运行；本阶段未执行此类命令。

## 规范矩阵

<!-- agentmo:runtime-compatibility-matrix:v1 -->
```json
{
  "schemaVersion": "agentmo.runtime-compatibility-matrix.v1",
  "observedAt": "2026-07-13",
  "evidenceClasses": [
    "upstream-declared",
    "official-supported",
    "contract-tested",
    "core-executed",
    "target-executed"
  ],
  "statuses": [
    "tested",
    "failed",
    "untested"
  ],
  "rows": [
    {
      "id": "agentmo-core-declaration",
      "component": "agentmo-core",
      "evidenceClass": "upstream-declared",
      "claim": "AgentMo package manifest declares the core Node.js floor.",
      "runtimeVersion": null,
      "range": ">=20",
      "command": null,
      "status": "untested",
      "evidenceRef": "package.json#engines.node",
      "remainingRisk": "A declaration does not prove execution on every Node.js 20 release."
    },
    {
      "id": "openclaw-package-declaration",
      "component": "openclaw-target",
      "evidenceClass": "upstream-declared",
      "claim": "OpenClaw v2026.6.11 package manifest declares its installation floor.",
      "runtimeVersion": null,
      "range": ">=22.19.0",
      "command": null,
      "status": "untested",
      "evidenceRef": "https://github.com/openclaw/openclaw/blob/v2026.6.11/package.json",
      "remainingRisk": "The package declaration is broader than the official supported Node.js 23 range and is not mutation authorization."
    },
    {
      "id": "openclaw-official-support",
      "component": "openclaw-target",
      "evidenceClass": "official-supported",
      "claim": "Official OpenClaw installation guidance supports Node.js 22.19+, 23.11+, or 24+.",
      "runtimeVersion": null,
      "range": ">=22.19.0 <23 || >=23.11.0",
      "command": null,
      "status": "untested",
      "evidenceRef": "https://docs.openclaw.ai/install/node (accessed 2026-07-13)",
      "remainingRisk": "Official guidance records supported versions but does not prove this repository executed OpenClaw."
    },
    {
      "id": "openclaw-boundary-contract",
      "component": "openclaw-target",
      "evidenceClass": "contract-tested",
      "claim": "The disjoint version predicate, JavaScript mutation seams, production CLI pre-intake canaries, dynamic live-smoke shell seam, Bash syntax, bounded caller classification, and exact I/O inventory are tested.",
      "runtimeVersion": "24.18.0 arm64",
      "range": ">=22.19.0 <23 || >=23.11.0",
      "command": "node --test test/runtime-compatibility.test.js test/runtime-compatibility-seams.test.js test/runtime-evidence-consumers.test.js test/cli.test.js test/live-smoke-script.test.js test/command-docs.test.js test/node20-core-runner.test.js test/node20-core-lane.test.js test/artifact-surface-coverage.test.js && bash -n scripts/node20-core-lane.sh scripts/openclaw-live-smoke.sh",
      "status": "tested",
      "evidenceRef": "test/runtime-compatibility.test.js; test/runtime-compatibility-seams.test.js; test/runtime-evidence-consumers.test.js; test/cli.test.js; test/live-smoke-script.test.js; test/command-docs.test.js; test/node20-core-runner.test.js; test/node20-core-lane.test.js; test/artifact-surface-coverage.test.js; scripts/node20-core-lane.sh#bash-n; scripts/openclaw-live-smoke.sh#bash-n",
      "remainingRisk": "Contract evidence proves enforcement and zero-effect rejection, not a provider-backed OpenClaw run."
    },
    {
      "id": "current-host-core-execution",
      "component": "agentmo-core",
      "evidenceClass": "core-executed",
      "claim": "The complete AgentMo repository check executes on the supported current host.",
      "runtimeVersion": "24.18.0 arm64",
      "range": ">=20",
      "command": "npm run check",
      "status": "tested",
      "evidenceRef": "release/2026.07.13.md#phase-012-runtime-compatibility-evidence",
      "remainingRisk": "One current-host version does not prove every declared core version."
    },
    {
      "id": "node20-core-execution",
      "component": "agentmo-core-and-openclaw-rejection",
      "evidenceClass": "core-executed",
      "claim": "An actual Node.js 20 process executes the owned core set and incompatible-target zero-effect matrix.",
      "runtimeVersion": "20.20.2 arm64",
      "range": ">=20",
      "command": "npm run check:core:node20 -- --node-bin \"$NODE20_BIN\" --archive \"$NODE20_ARCHIVE\" --checksums \"$NODE20_CHECKSUMS\" --expected-version 20.20.2 --expected-arch arm64 --receipt \"$NODE20_RECEIPT\"",
      "status": "tested",
      "evidenceRef": "receipt=release/evidence/2026.07.13-node20-core-receipt.json; receipt-sha256=c06631d9ccb43ebb2b5cbf85a4f20cccc65421148d051cdb238fc96a1f1559bf; command-set-sha256=7f397187278cdde65ed29704ff6dd91c0d952dea464d1fe6d144235da9b0edf5; archive-sha256=466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6; checksums-manifest-sha256=c6f74825d6ddf350ef06600c67fec6ea2f7996cf438a78c3cb2a89b29d4320ed; archive-member-sha256=38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6; executable-sha256=38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6; batches=syntax:40/0/0/40|core-contracts:45/0/0/45|stage-contracts:3/1/0/4",
      "remainingRisk": "Node.js 20 is end-of-life; this is compatibility and rejection evidence, not a production-runtime recommendation."
    },
    {
      "id": "openclaw-target-live-execution",
      "component": "openclaw-target",
      "evidenceClass": "target-executed",
      "claim": "A provider-backed OpenClaw target command executes successfully.",
      "runtimeVersion": null,
      "range": ">=22.19.0 <23 || >=23.11.0",
      "command": null,
      "status": "untested",
      "evidenceRef": "None — deliberately not executed in Phase 01.2.",
      "remainingRisk": "No provider-backed live-success, bounded domain eval, or production approval exists from this phase."
    }
  ],
  "certificationBoundary": {
    "runtimeEvidenceCertifiesDomainQuality": false,
    "runtimeEvidenceApprovesProduction": false,
    "runtimeEvidenceCertifiesWiderOpenClaw": false
  }
}
```

## 实际执行边界

`scripts/node20-core-lane.sh` 不下载运行时、不搜索 `PATH`、不回退到 current-host `node`，也不修改或模拟 `process.versions.node`。它只接受显式 canonical executable、archive、checksum manifest、精确版本/架构和一个尚不存在的临时 receipt 目标；由所选 executable 启动的 helper 会核对 `realpath(process.execPath)`、repo-owned trust anchor、官方 archive checksum、archive member 与 executable bytes，再运行固定 producer command manifest。该 manifest 的摘要为 `7f397187278cdde65ed29704ff6dd91c0d952dea464d1fe6d144235da9b0edf5`，本次实际结果为 syntax 40 pass、core contracts 45 pass、Stage contracts 3 pass + 1 skip，零 fail。`test/runtime-evidence-consumers.test.js` 是发布后的消费者，不进入 producer manifest，也不接受历史 trust-marker 环境变量代替 receipt。

Node.js 20 临时运行时只从 Node.js 官方发布地址取得；执行前以官方 `SHASUMS256.txt` 条目和仓库内 [`scripts/node20-distribution-trust.json`](../scripts/node20-distribution-trust.json) 双重约束归档、manifest、member 与 executable。成功生成的临时 receipt 经逐字节核对后发布为 [`release/evidence/2026.07.13-node20-core-receipt.json`](../release/evidence/2026.07.13-node20-core-receipt.json)，只保存版本、架构、provenance/command 摘要、批次计数与三个 false certification booleans；receipt SHA-256 为 `c06631d9ccb43ebb2b5cbf85a4f20cccc65421148d051cdb238fc96a1f1559bf`。它不保存临时宿主路径、原始命令输出、payload、transcript 或 credential-bearing state。

## 非认证边界

This runtime evidence does not certify domain quality. It does not approve production. It does not certify wider OpenClaw compatibility beyond the exact ranges, commands, and rejection paths recorded here. `declared-ready`、isolated `live-success`、bounded domain eval 与 production approval 仍是彼此独立且不可传递的证据等级。
