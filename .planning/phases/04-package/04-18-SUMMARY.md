---
phase: 04-package
plan: "18"
subsystem: packed-phase4-lifecycle-closure
tags:
  - npm-tarball
  - openclaw
  - public-cli
  - four-lifecycle
  - adversarial-tests
requires:
  - 04-16
  - 04-17
provides:
  - exact source-only Phase 4 published inventory
  - extracted-tarball public CLI full lifecycle journey
  - packed regressions for six reviewed root gaps
affects:
  - 04-19
key-files:
  modified:
    - package.json
    - test/artifact-surface-coverage.test.js
    - test/builder-packed-install.test.js
decisions:
  - The packed proof must execute every successful public Phase 4 command through the extracted tarball bin, not merely import the extracted implementation modules.
  - The native helper is distributed as auditable C source only and must be explicitly built and admitted inside the isolated journey.
  - Every packed negative asserts its exact stable rejection code; an unrelated failure is not accepted as security evidence.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 18：发布 tarball 完整生命周期闭环

Plan 18 关闭 packed/runtime distribution gap：实际 `npm pack` 产物在隔离目录解包后，可以仅凭 tarball 内的公共 CLI 与 runtime/source closure 完成 helper build、package Produce/Inspect、fresh probe、审批与 install → upgrade → rollback → uninstall，并重新准入 strict receipts。

## 完成内容

- published source/check inventory 补齐五个安全关键模块：
  - `src/artifact-admission.js`
  - `src/artifact-registry.js`
  - `src/openclaw-target-admission.js`
  - `src/openclaw-target-descriptor.js`
  - `src/package-carriers.js`
- exact inventory test 同时约束：
  - 全部 04-12..17 runtime/validator 与 `native/openclaw-fs-kernel.c` 存在；
  - 没有 compiled helper、helper receipt、authority/nonce state、`.env`、raw transcript；
  - 没有 `preinstall`、`install`、`postinstall`、`prepare` lifecycle hook；
  - Builder release closure 与 npm tarball closure 一致。
- 新增一条 extracted-tarball public CLI 正向旅程：
  1. `openclaw-fs-kernel-build`
  2. `package-produce`
  3. `package-inspect`
  4. `openclaw-probe`
  5. `openclaw-install-genesis`
  6. 每个 lifecycle 的 `openclaw-install-preview`
  7. ordinary、sensitive、conflict 三类 `openclaw-install-approve`
  8. install、upgrade、rollback、uninstall 的 `openclaw-install-apply`
  9. 从 tarball 动态导入 admission runtime，递归重新准入四份 strict receipts
- CLI 在 private HOME/cwd、closed env、disposable roots 与 fake exact OpenClaw executable 下执行；没有 checkout runtime fallback。测试 harness 仅构造外部已批准 fixture bytes。
- packed negatives 对六个 root gap 提供代表性证明：
  - target replacement / fresh probe drift；
  - durable authority replay 与 credential command confusion；
  - helper receipt drift 与 symlink ancestor；
  - false-complete receipt；
  - caller-self-certified genesis；
  - postpublication replacement preservation 与 nested recipe suffix。

## 独立复核修复

初版 full journey 除 helper build 外使用 tarball direct APIs。虽然实现代码来自 extracted tarball，但不满足计划对 public CLI success path 的字面要求。独立复核后，Produce、Inspect、Probe、Genesis、Preview、三类 Approve 与四个 Apply 全部改为真实执行 extracted `bin/agentmo.js`。

第二轮复核发现 target replacement、nonce replay 与 helper receipt drift 只断言“任意 error code”。精确观察后：

- target replacement：`AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT`
- helper receipt drift：`AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED`
- 原 transaction replay 实际也先命中 probe drift，未证明 nonce seam；测试改为对已消费的三-family durable marker set 做 fresh-attempt replay，精确拒绝码为 `AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED`

当前不存在 broad error predicate，不能用无关故障冒充安全证明。

## 验证结果

- inventory RED：**29/30 PASS，exit 1**，精确暴露五个 public syntax-check 缺项。
- inventory GREEN：**30/30 PASS，exit 0**。
- extracted public CLI journey：**1/1 PASS，exit 0**。
- one-time combined packed/focused gate：**55/55 PASS，exit 0**，约 16 分 20 秒；最终 CLI/test-only refinement 之后按效率约束只重跑唯一 named journey。
- orchestrator 独立 inventory replay：**30/30 PASS**。
- orchestrator 独立最终 named journey replay：**1/1 PASS**。
- `npm pack --dry-run --json`：**exit 0，99 entries**（README + 98 release assets）；只有 native C source，没有 compiled helper。
- JavaScript syntax、JSON parse 与 `git diff --check`：**PASS**。

全量 `npm run check` 未在本计划运行；04-19 负责最终 source state 的唯一 canonical full gate。

## 证据边界

未读取 `.env`，未使用真实凭据、真实 HOME、真实 OpenClaw state 或网络，未安装或激活真实 plugin/MCP/schedule/runtime。当前证明 extracted distribution 与 bounded lifecycle mechanism，不证明 live OpenClaw compatibility、domain quality、Birth、Delivery 或 production readiness。

## 剩余工作

- 04-19：同步 operator docs/release，运行唯一全量检查，生成明确 noncanonical 的 pre-verification deep audit。
- 04-19 SUMMARY 后：execute-phase canonical reviewer 与 verifier 独立决定 Phase 4 verdict。

## 提交状态

未 stage、未 commit、未 push。
