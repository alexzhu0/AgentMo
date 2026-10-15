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
  "observedAt": "2026-10-14",
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
      "command": "\"$NODE20_BIN\" scripts/node20-core-receipt.js --repository-root \"$REPOSITORY_ROOT\" --node-bin \"$NODE20_BIN\" --archive \"$NODE20_ARCHIVE\" --checksums \"$NODE20_CHECKSUMS\" --expected-version 20.20.2 --expected-arch arm64 --receipt \"$NODE20_RECEIPT\"",
      "status": "tested",
      "evidenceRef": "receipt=release/evidence/2026.10.14-node20-native-minimax-source-receipt.json; receipt-sha256=d91fd522afd42df480d304770aa8b77174b6a0ec33c7627438a23f1b5d92b729; command-set-sha256=c0b23d407db45a6aada4c8b80275a2c865ade90ed91187d8c0e48eec9b3ee1df; archive-sha256=466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6; checksums-manifest-sha256=c6f74825d6ddf350ef06600c67fec6ea2f7996cf438a78c3cb2a89b29d4320ed; archive-member-sha256=38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6; executable-sha256=38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6; batches=syntax:55/0/0/55|core-contracts:90/7/0/97|stage-contracts:3/2/0/5",
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

2026.09.28 当前 Node 20 证据为
[`2026.09.28-node20-core-receipt.json`](../release/evidence/2026.09.28-node20-core-receipt.json)：
producer exit 0，syntax 46 pass、core 87 pass + 1 skip、Stage 3 pass + 2 skip，零 fail。
当前 manifest 摘要 `bb3cd389aef8e29d624702dc254d4316c3cf98ca60cf1e2427b57477c12588e5`；
receipt SHA-256 `057361ff76aef002606acba2cf35415e3dc460a4df94fbdabad1933486dcae4f`，
观察时间 `2026-09-28T08:31:06.978Z`。新增语法覆盖是既有 `artifact-contract.js` 与
`build-contract.js`；新增核心用例是 native-chat design-plan 回归。未改变 distribution trust。
原始成功 receipt 与发布文件逐字节相同。当前 `npm run check` exit 1，原因是
`AGENTMO_CHECK_ALREADY_RUNNING`；下述历史 full-suite 行不证明本批完整检查通过。

发布后精确消费者 17/17 通过。2026.09.28 扩展边界集为 110 pass / 1 skip /
4 fail：既有 Course Wiki acceptance 脚本的 `writeSync` 未被 I/O classifier 分类，
阻断四项全仓清单断言。矩阵中的其他历史 tested 行不代表本批全仓回归通过；
详见 [本批记录](../release/2026.09.28.md)。未绕过清单或移除全量检查锁。

以下段落保留 2026.09.20 历史 producer 说明；其中的“当前”指该次历史执行，不是本批。

`scripts/node20-core-lane.sh` 不下载运行时、不搜索 `PATH`、不回退到 current-host `node`，也不修改或模拟 `process.versions.node`。它只接受显式 canonical executable、archive、checksum manifest、精确版本/架构和一个尚不存在的临时 receipt 目标；由所选 executable 启动的 helper 会核对 `realpath(process.execPath)`、repo-owned trust anchor、官方 archive checksum、archive member 与 executable bytes，再运行固定 producer command manifest。2026.09.20 历史 manifest 的摘要为 `40a558f3596018c4830f2a619151def856aa1cdef0759c4c6e7c3e6b19d37eb7`，2026.09.20 实际结果为 syntax 44 pass、core contracts 86 pass + 1 skip、Stage contracts 3 pass + 2 skip，零 fail。新增 `src/behavior-evidence.js` 属于 owned syntax set；core batch 继续直接拥有完整 `test/design-plan.test.js`。`test/runtime-evidence-consumers.test.js` 是发布后的消费者，不进入 producer manifest，也不接受历史 trust-marker 环境变量代替 receipt。

2026.10.12 原生多轮预算代理已加入 owned syntax，command manifest：b53518985ac194c9c69cc2f320bb23bb6bcf14d8f9cfdfc6c4f13f3e3cf81a72。Task 4 历史收据为 [2026.10.12-node20-native-budget-receipt.json](../release/evidence/2026.10.12-node20-native-budget-receipt.json)，syntax 53 pass、core 87 pass + 1 skip、Stage 3 pass + 2 skip，零 fail。此前收据保留为历史证据。另在本机支持的运行时中，OpenClaw 2026.9.4 的无模型首次初始化、单 Agent 列表和配置校验已用合成包及临时状态验证；这不是生产安装、聊天或领域质量证明。

Node.js 20 临时运行时只从 Node.js 官方发布地址取得；执行前以官方 `SHASUMS256.txt` 条目和仓库内 [`scripts/node20-distribution-trust.json`](../scripts/node20-distribution-trust.json) 双重约束归档、manifest、member 与 executable。成功生成的临时 receipt 经逐字节核对后保存为 [`release/evidence/2026.09.20-node20-core-receipt.json`](../release/evidence/2026.09.20-node20-core-receipt.json)，只保存版本、架构、provenance/command 摘要、批次计数与三个 false certification booleans；receipt SHA-256 为 `869b46dd21a43bb0a6144e06bd6da0f8fc901e0936e80dbc6c620ca290b2b00b`，观察时间为 `2026-09-20T11:43:42.759Z`。历史 [`2026.08.28-node20-core-receipt.json`](../release/evidence/2026.08.28-node20-core-receipt.json)（SHA-256 `9dc5d97120dd8333211814def9127fde3758157ef1e87dba2c6f778bc25f2153`）、[`2026.08.19-node20-core-receipt.json`](../release/evidence/2026.08.19-node20-core-receipt.json)、[`2026.08.14-node20-core-receipt.json`](../release/evidence/2026.08.14-node20-core-receipt.json) 和 [`2026.07.13-node20-core-receipt.json`](../release/evidence/2026.07.13-node20-core-receipt.json) 保留为各自旧 command manifest 的历史证据。这些 receipt 都不保存临时宿主路径、原始命令输出、payload、transcript 或 credential-bearing state。

矩阵中的较宽 boundary command，以及 current-host row 的 `24.18.0 arm64` 与 `448/448` facts，仍来自 2026.07.13 historical evidence，2026.09.20 未重跑该较宽 command，也不改写该 historical row。2026.08.28 的 current-host `npm run check` 历史结果为 exit 0：main 1069 tests / 1013 pass / 56 skip / 0 fail，durable-fs 2/2，packed-hook-chain 1/1，packed-behavior 7 pass / 1 skip / 0 fail，immutable-successor 1/1，report lane 总耗时 `3613150.722ms`。该历史 full gate 不证明当前 Course Wiki 恢复改动通过；2026.09.20 的完整检查仍待集成完成后执行。上述结果均不升级领域质量、生产、Plan/Produce 或更广 OpenClaw 认证。

## 非认证边界

This runtime evidence does not certify domain quality. It does not approve production. It does not certify wider OpenClaw compatibility beyond the exact ranges, commands, and rejection paths recorded here. `declared-ready`、isolated `live-success`、bounded domain eval 与 production approval 仍是彼此独立且不可传递的证据等级。

Task 5 历史收据：[2026.10.12-node20-native-activation-receipt.json](../release/evidence/2026.10.12-node20-native-activation-receipt.json)；SHA-256 75d69b07043269d854fb0e529634205aed594edc741c6c706c50a18dfd90386e，command manifest d898adca44e9dca1e1a9b0b0de59b8f1606fd3d894f26008c223f035a4a0210a。syntax 54 pass、core 87 pass + 1 skip、Stage 3 pass + 2 skip，零 fail。实际 OpenClaw 的合成隔离启动/停止、多轮、重启和失败单次尝试已另行验证；真实 UI、真实模型和领域验收仍未完成。

Task 6 历史收据：[2026.10.12-node20-native-delivery-receipt.json](../release/evidence/2026.10.12-node20-native-delivery-receipt.json)；SHA-256 bd92598a68fa023983091ab5d0726fa94719e9935400abbfc8de51912f4b5054，command manifest 61574ef42ecf545b067c7ff061324a2997123700a5fa2261a8b663603701f4bd。syntax 54 pass、core 88 pass + 3 skip、Stage 3 pass + 2 skip，零 fail。两项原生集成用例在实际 Node20 不兼容目标上明确跳过，纯原生验收契约实际执行。实际 OpenClaw 的隔离合成修复复核24项通过；真实UI/模型和领域验收仍待精确批准。

M3 来源增强前历史收据：[2026.10.14-node20-native-minimax-receipt.json](../release/evidence/2026.10.14-node20-native-minimax-receipt.json)；SHA-256 b8af991656c4c42f0252614b1b3da2759ed6b8750244f5f5a107fa985dafb6d3。syntax55 pass、core90 pass +6 skip、Stage3 pass +2 skip，零fail。新增正式来源和模型契约执行；Node20不支持当前OpenClaw，原生运行用例明确跳过。实际SDK的两个模型已用合成上游验证，真实M3凭据与领域验收未执行。

M3 当前来源闭包收据：[2026.10.14-node20-native-minimax-source-receipt.json](../release/evidence/2026.10.14-node20-native-minimax-source-receipt.json)；SHA-256 d91fd522afd42df480d304770aa8b77174b6a0ec33c7627438a23f1b5d92b729。syntax55 pass、core90 pass +7 skip、Stage3 pass +2 skip，零fail。共享安装/激活预检必须获取真实Blueprint/Build Contract准入，检查来源摘要与模型一致；重新哈希归档也不能代替正式Plan来源。Node20不支持当前SDK，相关运行用例明确skip，实际SDK的两模型合成集成另行通过。
