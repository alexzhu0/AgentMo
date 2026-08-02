---
phase: 04-package
plan: "16"
subsystem: openclaw-strict-install-receipts
tags:
  - openclaw
  - receipts
  - artifact-admission
  - authority-ledger
  - fail-closed
requires:
  - 04-15
provides:
  - strict receipt completion theorem
  - companion-backed exact authority and result ledger
  - recursively authenticated predecessor receipt chain
  - stable value-blind receipt evidence
affects:
  - 04-18
  - 04-19
key-files:
  created:
    - src/openclaw-install-receipt.js
    - .planning/phases/04-package/04-16-SUMMARY.md
  modified:
    - src/openclaw-install-transaction.js
    - src/artifact-admission.js
    - src/artifact-contract.js
    - src/artifact-registry.js
    - src/cli.js
    - test/openclaw-install-transaction.test.js
    - test/artifact-admission.test.js
    - test/artifact-contract.test.js
    - test/phase4-contracts.test.js
    - test/artifact-surface-coverage.test.js
decisions:
  - A complete receipt is derived from exact external companions and one-to-one authority, managed-result, external-result, preservation, and recovery closure; callers cannot self-report completion.
  - Historical current and rollback predecessor receipts require their full recursive authentic companion graph rather than a structurally valid receipt plus a recomputed digest.
  - Repeatable companions are registry-scoped only to sensitive action decisions for install receipts and remain ordered by the admitted install plan.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 16：严格 receipt 完成定理

Plan 16 关闭了 root gap 4、CR-07 与 CR-08：安装 receipt 不再是宽松 outcome 摘要，而是由外部 authentic companions 重算的 exact authority/result ledger。

## 完成内容

- `complete` 仅在以下条件全部成立时有效：
  - exact managed operations 与 sensitive/external actions 均一对一且唯一成功；
  - ordinary、conflict 与逐 sensitive-action approval/nonce 均精确消费；
  - plan、archive、target、probe、private journal 与 attempt authority 完整绑定；
  - post-state 与计划完全一致；
  - preserved 与 recovery 集合为空。
- 任一 failed、unsupported、preserved、ambiguous、recovery-required、少项、重复、替换或顺序漂移只能产生 admitted `incomplete`，或直接失败关闭；bounded reason 不保存秘密或原始子进程输出。
- receipt durable artifact admission 要求完整 companions：
  - install plan；
  - ordinary approval；
  - 按 plan 顺序的 sensitive decisions；
  - conflict approval；
  - private journal；
  - probe；
  - target descriptor。
- repeatable companion 机制仅由 registry 为 `openclaw-install-receipt` 的 `openclaw-sensitive-action-decision` 开放；其他 subject 仍拒绝数组 companion，重复 digest/path 与 action 顺序漂移均失败关闭。
- predecessor receipt admission 递归验证 probe 的 package manifest、target/carrier admission、blueprint、build contract、plan approval 与 target descriptor。upgrade、rollback、uninstall 不接受 receipt bytes 的结构有效性或自算 digest 作为历史真实性。
- public CLI 为 current 与 selected rollback predecessor 提供显式 path+digest companion 对；human 与 JSON 均来自同一 admitted receipt 数据，不引入 bundle/self-auth manifest。

## 安全复核中修复的关键问题

首次实现曾保留一个临时 predecessor fallback：当历史 companion 不完整时，可接受“结构有效 receipt + 调用者重算 digest”。独立复核判定这会允许伪造 lineage，已删除该 fallback，并把 historical receipt 扩展为完整递归 companion admission。当前缺少或替换任一层 companion 都会在 target effect 前失败关闭。

这是本计划最重要的偏差修复；它扩大了 `artifact-admission` 与 CLI 的必要改动范围，但没有扩大运行权限或认证声明。

## 对抗验证

测试覆盖：

- preserved/failed/unsupported/recovery/missing external result 的 false-complete；
- 删除、重复、替换或重排 plan、三类 approval、nonce、managed result、external result；
- 使用另一 target/probe/journal/plan 或重新计算顶层 receipt digest；
- 伪造 structurally valid current/rollback predecessor；
- 缺失、替换或错序的 recursive companion set；
- credential、raw stdout/stderr/provider payload 的持久化拒绝；
- install、upgrade、rollback、uninstall 的 strict receipt lineage。

## 验证结果

- 执行者 focused gate：**67/67 PASS**。
- 执行者 adjacent gate：**35/35 PASS**。
- 执行者 exact I/O inventory：**17/17 PASS**。
- orchestrator 独立 focused replay：**67/67 PASS**。
- orchestrator 独立 adjacent replay：**35/35 PASS**。
- `git diff --check`：**PASS**。

本计划不重复运行全量 `npm run check`；04-19 负责所有 gap waves 合并后的唯一 canonical full gate。

## 证据边界

全部验证使用 disposable roots、fixture/fake official seams 与 value-blind artifacts。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未联网，未运行真实 OpenClaw install、activation、runtime、schedule 或 MCP。

这些结果证明 bounded receipt/admission mechanism，不证明 live OpenClaw compatibility、domain quality、Birth、Delivery 或 production readiness。

## 剩余工作

- 04-18：从实际 npm tarball 解包后的完整 four-lifecycle 与 adversarial journey。
- 04-19：docs/release、唯一全量检查与 canonical post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
