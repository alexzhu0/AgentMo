---
phase: 04-package
plan: "17"
subsystem: atomic-package-publication
tags:
  - retained-dirfd
  - atomic-rename
  - no-replace
  - package
  - openclaw
  - recovery
requires:
  - 04-13
provides:
  - temp-complete atomic publication for package directory and authority files
  - explicit helper admission for every public publisher
  - prepublication private-temp and postpublication orphan evidence
  - nested recipe path preservation
affects:
  - 04-18
key-files:
  created:
    - .planning/phases/04-package/04-17-SUMMARY.md
  modified:
    - native/openclaw-fs-kernel.c
    - src/openclaw-safe-fs.js
    - src/package-produce.js
    - src/openclaw-target-descriptor.js
    - src/openclaw-target-admission.js
    - src/targets/openclaw-package.js
    - src/cli.js
    - test/openclaw-safe-fs.test.js
    - test/package-produce.test.js
    - test/openclaw-target-descriptor.test.js
    - test/openclaw-target-admission.test.js
    - test/openclaw-package.test.js
    - test/artifact-surface-coverage.test.js
decisions:
  - Complete private files and directories publish through one retained-dirfd native no-replace rename; there is no hard-link or JavaScript pathname-cleanup fallback.
  - Every public publisher requires the exact admitted helper, receipt, and external receipt digest tuple.
  - Prepublication private objects and postpublication final objects are distinct recovery evidence classes and are preserved rather than automatically deleted.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 17：temp-complete 原子发布

Plan 17 关闭了 CR-10 与 WR-03。package directory、D-42 archive、OpenClaw target descriptor 和 target/carrier admission 现在都先在 private sibling name 下完整构建、验证并持久化，再通过 04-13 native kernel 的一次 atomic no-replace rename 对外可见；失败处理不再按 reopened pathname 删除任何对象。

## 完成内容

- native safe-fs 新增 retained source/destination parent-dirfd `publish-no-replace`：Linux 使用 `renameat2(RENAME_NOREPLACE)`，Darwin 使用 `renameatx_np(RENAME_EXCL)`，同时核对 source device、inode、type、owner、mode、file link count 与 root device。
- 完整 source parent 在 rename 前 fsync；rename 后 source/destination parent 均 fsync，并重新观察 exact final identity。post-rename durability/observation 不确定时返回 `sourceConsumed: true` 与 exact identity，调用方不会把已经发布的对象误报为普通 private temp。
- package tree 的每个文件与目录完成 fsync 后，整个目录只通过一次 native rename 发布；archive、descriptor 与 admission 使用相同 primitive。成功 rename 原子消费 staging name。
- prepublication 失败保留并 itemize `preservedPrivateTemps`；postpublication、lost-response、replacement 或后续验证失败保留并 itemize `preservedPublications`。不存在 JavaScript `link`、`unlink`、`rm` 或 implicit cleanup fallback。
- `openclaw-target-describe`、`openclaw-target-admit` 与 `package-produce` 现在和 install apply 一样，强制接收 explicit `--fs-helper`、`--fs-helper-receipt` 与 external `--fs-helper-receipt-digest`。没有 auto-build、PATH lookup、global helper 或 JS fallback。
- OpenClaw recipe projection 保留 canonical nested suffix；同 basename 不同目录不会碰撞，traversal、absolute、NFD/normalization 与 case-fold collision 继续失败关闭。
- Phase 4 ROADMAP Goal 已是 canonical `As a ... I want to ... so that ...`，本计划没有扩大 Goal 语义；Phase 4 继续保持 Needs Review / gaps_found。

## 对抗验证

新增或强化的用例覆盖：

- complete private file 与 directory 的 source-consumed atomic publication；
- destination no-replace collision；
- helper 在 rename 可见后终止，最终只能有一个 exact identity；
- native post-rename unknown 与调用方 lost-response recovery；
- directory、archive、descriptor、admission 的 prepublication private-temp preservation；
- 四类 publisher 的 postpublication replacement 与 exact rename-window failure；
- nested same-basename recipes，以及 traversal/absolute/normalization/case-policy collision；
- public publisher 缺少 helper/receipt/external digest 时零输出效果。

## 验证结果

执行者验证：

- Plan 17 core：**41/41 PASS**。
- exact artifact/I/O inventory：**17/17 PASS**。
- package/projection/inspect/Phase 4 downstream：**40/40 PASS**。
- probe/install downstream：**29/29 PASS**。
- public CLI helper gate：**1/1 PASS**。
- native C warnings-as-errors、14 个 JavaScript syntax、source assertions 与 `git diff --check`：**PASS**。

orchestrator 独立复核：

- Plan 14 + Plan 17 组合核心、contracts 与 exact inventory：**93/93 PASS**。
- public CLI exact helper gate：**1/1 PASS**。
- command docs、package/carrier/contract/determinism/inspect、projection、probe 与 install-plan：**44/44 PASS**。
- 本轮独立复核合计：**138/138 PASS**。
- native C warnings-as-errors、publisher pathname cleanup grep 与 `git diff --check`：**PASS**。

本计划不重复运行全量 `npm run check`；04-19 负责所有 gap waves 合并后的 canonical full gate。

## 计划偏差

首轮实现只使用 final-name `mkdir` 与 hard-link publication。虽然它关闭了“失败后删除 replacement”窗口并通过 24/24 测试，但最终目录在填充期间可见，hard-link 成功后仍需 pathname unlink staging name，未满足计划明确要求的 `temp-complete + safe-fs publish-no-replace`。

复审后扩展 04-13 native kernel/facade，并把 public CLI、fixtures 与 exact I/O inventory 纳入必要范围。最终实现用一次 native rename 同时完成 source consumption 与 destination no-replace，删除了首轮机制缺口；没有弱化 scanner、helper trust contract 或 certification boundary。

## 证据边界

所有 helper、publisher、package 与 replacement 验证均在隔离 fixture/private roots 中完成。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未联网，未执行真实 OpenClaw install/activation/runtime、schedule 或 MCP，也不形成 domain、Birth、Delivery、production 或 wider-compatibility 证明。

## 剩余工作

- 04-15：现场 genesis、official action runner 与四 lifecycle 垂直旅程。
- 04-16：strict receipt completion theorem 与 companion-backed admission。
- 04-18：extracted packed archive 的完整 lifecycle/adversarial journey。
- 04-19：docs、release、canonical full gate 与 post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
