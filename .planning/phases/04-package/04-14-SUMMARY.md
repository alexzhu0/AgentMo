---
phase: 04-package
plan: "14"
subsystem: openclaw-durable-authority-consumption
tags:
  - openclaw
  - nonce
  - retained-dirfd
  - one-use-authority
  - credential-boundary
  - fail-closed
requires:
  - 04-13
provides:
  - durable per-family and per-nonce authority reservation
  - exact-attempt recovery admission
  - canonical all-family decision validation
  - closed official credential command grammar
affects:
  - 04-15
  - 04-16
  - 04-18
key-files:
  created:
    - src/openclaw-authority-consumption.js
    - .planning/phases/04-package/04-14-SUMMARY.md
  modified:
    - native/openclaw-fs-kernel.c
    - src/openclaw-safe-fs.js
    - src/openclaw-install-approval.js
    - src/openclaw-credential-handoff.js
    - src/openclaw-install-transaction.js
    - src/cli.js
    - test/openclaw-safe-fs.test.js
    - test/openclaw-install-approval.test.js
    - test/openclaw-install-transaction.test.js
    - test/phase4-contracts.test.js
decisions:
  - A nonce is consumed when its final create-exclusive marker name is durably reserved; a crash may leave an unusable marker but never releases the nonce.
  - Ordinary, sensitive, and conflict authorities use independent markers, while one exact attempt may resume only when the complete marker set and private journal are byte-exact.
  - Credential actions accept only the closed official secrets-apply or models-auth-login grammar and reuse the canonical sensitive-decision validator.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 14：durable 一次性 authority

Plan 14 关闭了 CR-05 与 CR-06：批准不再依赖调用方提供的进程内 `usedNonces`，而是在任何 journal 或 target effect 前，通过 retained-dirfd native kernel 将 ordinary、每个 sensitive action 和完整 conflict set 的 nonce 分别消费为 durable create-exclusive marker。

## 完成内容

- 新增 `agentmo.openclaw-authority-marker.v1` 与完整 reservation-set admission；marker 绑定 authority family、nonce、attempt、install plan、target、archive、lifecycle、probe、decision/action/conflict 与时间窗口。
- native kernel 新增 reserve/finalize 协议：最终 marker 名先以 `O_CREAT|O_EXCL|O_NOFOLLOW`、mode `0600` 建立并同步父目录，再写 canonical bytes、同步文件与父目录。崩溃留下的 zero/partial/unknown marker 永不删除或重用。
- transaction 要求显式 bounded attempt ID 与 private `0700` authority-state root；完整三类 marker set 在 private journal 和所有 effects 之前完成。
- fully durable、完整且属于同一 exact attempt 的 marker set 可在 fresh process 复验 journal 后恢复；混合 created/resume、stale、truncated、wrong digest/identity/owner 或不完整集合全部返回 recovery-required。
- `validateOpenClawInstallDecision` 统一验证三类 decision 与 admitted reservation set；生产源码不再接受或引用 caller-controlled `usedNonces`。
- credential handoff 改为封闭 allowlist：仅允许 exact `secrets apply --from <relative-ref> [--dry-run]` 或 `models auth login --provider <safe-id>` 及明确批准的 method/profile 选项。plugin、MCP、config、agent、schedule、restart、额外 flags、重排与重复均在 runner 前拒绝。
- CLI 增加 `--attempt-id` 与 `--authority-state-root`，并保持 helper/receipt/external digest 的 04-13 trust contract。

## 对抗验证

新增或强化的用例覆盖：

- 同一 ordinary、sensitive 与 conflict nonce 的 fresh-attempt replay；
- 两个独立 writer 对同一 marker 的并发单赢家；
- crash-before-write 留下 zero-byte final marker，随后新 attempt 无法重用；
- fully durable exact attempt 的 journal-bound resume；
- partial、stale、unknown、wrong-mode/owner/digest 与 symlink marker fail closed；
- plugin/MCP/config/agent/schedule/restart 及 argv confusion；
- decision、plan、action、时间、nonce、probe executable 与 executable digest 漂移；
- missing authority root、attempt ID 或 helper tuple 时 journal/target 零效果。

## 验证结果

- 独立 focused gate：**44/44 PASS**，覆盖 approval、safe-fs、transaction 与 Phase 4 contracts。
- native C 使用 warnings-as-errors 编译：**PASS**。
- 修改的 JavaScript syntax 与 `package.json` parse：**PASS**。
- 生产源码 `usedNonces` 检查：**0 references**。
- `git diff --check`：**PASS**。

本计划没有重复运行耗时的全量 `npm run check`；04-19 负责所有 gap waves 合并后的 canonical full gate。Plan 14 自身的 exact I/O rows 已更新，但 repo-wide surface gate 需在并发 Plan 17 原子 publisher 代码稳定后由 orchestrator 统一对齐，不能把并发 line drift 伪报为 Plan 14 失败。

## 计划偏差

04-13 的既有 `createOnly` 不能满足“崩溃后 nonce 仍永久不可复用”：若 final publication 尚未发生，临时对象可能不会消费最终名称。因此本计划在同一 repository-owned native kernel/facade 中新增 final-name-first reserve/finalize primitive，并补充 safe-fs、package/runtime inventory 与测试。该偏差收紧一次性 authority，不扩展 install、runtime、domain 或 production authority。

## 证据边界

所有 marker、journal、target 与 credential-runner 验证均在隔离 fixture/private roots 中完成。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未联网，未执行真实 OpenClaw install/activation/runtime、schedule 或 MCP，也不形成 domain、Birth、Delivery、production 或 wider-compatibility 证明。

## 剩余工作

- 04-15：现场 genesis、official action runner 与四 lifecycle 垂直旅程。
- 04-16：strict receipt completion theorem 与 companion-backed admission。
- 04-17：temp-complete retained-dirfd publisher 与 nested recipe path。
- 04-18：extracted packed archive 的完整 lifecycle/adversarial journey。
- 04-19：docs、release、canonical full gate 与 post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
