---
phase: 04-package
plan: "13"
subsystem: openclaw-retained-dirfd-filesystem
tags:
  - openclaw
  - retained-dirfd
  - native-kernel
  - no-replace
  - supply-chain
  - fail-closed
requires:
  - 04-12
provides:
  - repository-owned Darwin/Linux retained-dirfd filesystem kernel
  - fixed-compiler durable helper build receipt
  - explicit helper/receipt/external-digest apply admission
  - identity-safe observation, journal, create-only publication, and recovery
affects:
  - 04-14
  - 04-15
  - 04-17
  - 04-18
key-files:
  created:
    - native/openclaw-fs-kernel.c
    - src/openclaw-safe-fs.js
    - test/openclaw-safe-fs.test.js
    - .planning/phases/04-package/04-13-SUMMARY.md
  modified:
    - src/openclaw-install-transaction.js
    - src/cli.js
    - package.json
    - src/builder-package.js
    - test/openclaw-install-transaction.test.js
    - test/cli.test.js
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js
    - test/builder-packed-install.test.js
    - test/runtime-compatibility-seams.test.js
    - README.md
    - docs/MVP_RUNBOOK.md
    - docs/STAGE_CONTRACTS.md
    - release/2026.07.30.md
decisions:
  - Published or reopened objects are never deleted from a pathname; uncertain cleanup is preserved and reported incomplete.
  - Linux and Darwin publication use their native atomic no-replace primitives with no plain-rename fallback.
  - The helper is built explicitly from packed source with fixed /usr/bin/cc and a closed environment; apply never builds, downloads, or resolves it through PATH.
  - Public apply re-admits the helper, durable receipt, source, compiler, arguments, environment descriptor, binary bytes, and file identities before journal creation.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 13：retained-dirfd 文件系统内核

Plan 13 关闭了 CR-03、CR-04 与 native helper supply-chain 根缺口：AgentMo 不再依赖“先验证 pathname、稍后再用 pathname 写入或删除”的竞态模型。OpenClaw target observation、private journal、create-only publication 与 recovery inspection 现在统一通过一次 admitted retained-root session 完成。

## 完成内容

- 新增小型仓库自有 C kernel：逐段 `openat`/`fstatat(..., AT_SYMLINK_NOFOLLOW)` 解析，拒绝绝对路径、`..`、symlink、unsafe ancestor 和 identity drift。
- Linux 只使用 `renameat2(..., RENAME_NOREPLACE)`，Darwin 只使用 `renameatx_np(..., RENAME_EXCL)`；不存在 plain `renameat`、check-then-replace 或 JavaScript mutation fallback。
- 新增 `openclaw-fs-kernel-build`：固定 `/usr/bin/cc`、固定 argv、closed environment、`shell:false`，向两个 absent private paths 发布 helper 与 durable closed receipt。
- `openclaw-install-apply` 强制接收 `--fs-helper`、`--fs-helper-receipt` 与外部 receipt digest，并在 journal/effect 前复验源码、compiler、toolchain fingerprint、argv、closed environment、binary digest 与 file identity。
- transaction 删除 pathname target/journal write/unlink 和 cached recovery truth；新进程恢复会重新打开、重新观察并保留所有已发布对象，不凭 cached boolean 或当前 pathname 删除。
- package 与 Builder runtime inventory 包含 C source/facade，不包含 host-built binary，也没有 npm lifecycle compilation。
- 公开 help 与 runbook 同步完整 blueprint/build-contract/plan-approval/target-descriptor、helper tuple、OpenClaw target root 和 isolated target root 参数。
- 静态 I/O inventory 为 safe-fs 的每一个 open/read/write/sync/process sink 指定了 `phase-04-plan-13` owner，没有新增 pending 或 unclassified surface。

## 对抗验证

新增或强化的用例覆盖：

- ancestor 在 admission 后替换为 symlink；
- final symlink 与 same-path inode replacement；
- destination 已存在时的 no-replace 单赢家与逐字节保留；
- external receipt digest、receipt keys、source、compiler、argv、binary 与 identity drift；
- PATH-only helper、missing helper、unsupported platform；
- oversized/extra-key/unknown-operation protocol 输入；
- cached recovery boolean 注入与 fresh-process recovery replacement；
- public API/CLI 缺少显式 helper tuple 时 journal/target 零效果；
- npm packed inventory、spawn inventory 与无预编译 helper closure。

## 验证结果

- OpenClaw、CLI、contract、documentation、runtime seam 与 exact I/O focused gate：**121/121 PASS**。
- Builder package trust-boundary 长测：**21/21 PASS**。
- packed runtime inventory 与 production spawn inventory 精确复验：**2/2 PASS**。
- 高负载 behavior scenario 独立复验：**1/1 PASS**，约 195 秒。
- `npm pack --dry-run --json`：**PASS**；使用隔离临时 npm cache，97 个 package entries，包含 `native/openclaw-fs-kernel.c` 与 `src/openclaw-safe-fs.js`，不含 compiled helper。
- C syntax、JavaScript syntax 与 `git diff --check`：**PASS**。

`npm run check` 按要求只完整运行一次并取得明确退出码 `1`：905 tests，901 pass，3 fail，1 skip，约 25 分 48 秒。两项失败是新 source/facade 与两个新 spawn sites 导致旧 exact inventory 仍期待 94/89 和旧 spawn set；修正后精确复验 **2/2 PASS**。第三项是 packed behavior scenario 在全量并发负载下返回 bounded scenario failure；同一精确用例隔离运行 **1/1 PASS**。为避免重复 26 分钟全量循环，本计划不再次运行 aggregate；04-19 仍负责所有 gap waves 合并后的 canonical final full gate。

## 证据边界

所有编译、helper execution、target mutation 与 recovery 均位于一次性 private/fixture roots。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未联网，未运行真实 OpenClaw install/activation/runtime，未执行 schedule，未连接 MCP，也未形成 domain、Birth、Delivery、production 或 wider-compatibility 证明。

## 剩余工作

- 04-14：durable per-authority/per-nonce reservation 与 official credential route。
- 04-17：publisher failure semantics、nested recipe paths 与 canonical Goal metadata。
- 04-15/04-16：完整四生命周期与严格 receipt completion theorem。
- 04-18：extracted packed archive 的完整 lifecycle/adversarial journey。
- 04-19：文档、release、canonical full gate 与 post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
