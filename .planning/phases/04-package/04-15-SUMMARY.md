---
phase: 04-package
plan: "15"
subsystem: openclaw-four-lifecycle-execution
tags:
  - openclaw
  - install
  - upgrade
  - rollback
  - uninstall
  - observed-genesis
  - official-actions
requires:
  - 04-14
provides:
  - retained-observation absent genesis authority
  - closed official config and credential dispatcher
  - real isolated four-lifecycle state transitions
  - predecessor-bound lifecycle receipt chain
affects:
  - 04-16
  - 04-18
key-files:
  created:
    - src/openclaw-official-action-runner.js
    - test/openclaw-credential-handoff.test.js
    - .planning/phases/04-package/04-15-SUMMARY.md
  modified:
    - src/openclaw-install-plan.js
    - src/openclaw-install-transaction.js
    - src/openclaw-credential-handoff.js
    - src/cli.js
    - src/artifact-contract.js
    - src/builder-package.js
    - package.json
    - test/openclaw-install-plan.test.js
    - test/openclaw-install-transaction.test.js
    - test/phase4-contracts.test.js
    - test/artifact-surface-coverage.test.js
    - test/builder-packed-install.test.js
decisions:
  - Absent genesis authority is derived from two retained safe-fs observations of plan-derived paths and cannot be supplied as caller truth.
  - Configuration mutation crosses only an exact official config-patch dry-run/actual pair; credential actions retain the Plan 14 closed route and decision validation.
  - Install, upgrade, rollback, and uninstall execute as one predecessor-bound receipt chain in an isolated target while unknown and modified assets remain preserved.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 15：真实四生命周期执行

Plan 15 关闭了 root gap 5、WR-01 与 WR-02：Phase 4 不再只生成 lifecycle plan，而是在同一隔离 target 上真实执行 install → upgrade → rollback → uninstall，并用现场 retained safe-fs observation 生成与复验 absent genesis authority。

## 完成内容

- `buildOpenClawAbsentGenesisAuthority` 删除 caller-supplied `checkedPaths`、`verifiedAbsent` 与 absence digest；checked paths 只从 exact operations 派生，并通过 retained safe-fs 连续两次观察 absence 与 parent identity。
- lifecycle preview 在使用 genesis authority 前重新观察相同 path set；路径出现、parent identity 漂移或 path set 改变会在 approval/effect 前失败关闭。
- `openclaw-install-genesis` 强制接收 isolated target root 与 exact admitted helper/receipt/external digest tuple；公开 artifact minimal template 不再示范调用方自报 absence。
- 新增 `openclaw-official-action-runner.js`：
  - config mutation 只允许 exact `config patch --file <digest-bound-patch>`；
  - 先执行 dry-run，确认 target 未改变，再执行 actual 并核对 exact result digest；
  - credential 只复用 Plan 14 的 `secrets apply` / `models auth login` closed grammar；
  - plugin、MCP、agent、schedule、restart、unknown 或 ambiguous route 均在 child process 前拒绝；
  - executable 来自 fresh probe 绑定的 exact target member，复制到 private `0700` root 后以 private cwd、closed env、`shell:false` 执行；
  - evidence 只记录 bounded status/digests，不记录 stdout、stderr、credential value 或 target config path。
- transaction 继续用 retained safe-fs 执行 immutable generation writes；config patch/remove 在 durable authority reservation 后才交给 official runner，任一 external failure 阻止后续 effect。
- 同一隔离 target 的四生命周期 receipt chain 已完成：
  - install 创建首代 managed generation；
  - upgrade 创建 successor generation；
  - rollback 的 selected predecessor 精确指向 install；
  - uninstall 形成 sequence 3 successor；
  - 每一步 official config 均完成 exact dry-run/actual；
  - unknown config fields、unknown assets 与 modified inactive generation bytes 均保持不变。
- Builder packed runtime closure 加入 official action runner，并补齐此前 package inventory 已包含但 Builder runtime inventory 漏掉的 Plan 14 authority-consumption module。

## 对抗验证

新增或强化的用例覆盖：

- caller 伪造 checked paths、verified absence 或 absence digest；
- genesis 与 preview 之间路径出现或 parent identity 改变；
- config dry-run 修改 target、base digest 漂移、actual result digest 不符；
- plugin/MCP/config confusion、agent/schedule/restart 与 ambiguous action route；
- exact decision/reservation/probe executable/patch digest 漂移；
- write destination 与 archive `sourcePath` 不同时仍读取正确 source bytes/mode；
- unknown config/assets 与 modified inactive generation preservation；
- 四生命周期 predecessor、archive generation 与 receipt sequence closure；
- packed Builder 缺少 runtime member 时失败关闭。

## 验证结果

执行者与 orchestrator 的两轮结果一致：

- Plan 15 focused（含 approval、credential、transaction 与 Phase 4 contracts）：**45/45 PASS**。
- artifact contracts/subjects、probe 与 safe-fs：**32/32 PASS**。
- exact I/O inventory：**17/17 PASS**。
- packed runtime closure：**3/3 PASS**。
- 唯一 focused/adjacent tests 合计：**97/97 PASS**。
- JavaScript syntax 与 `git diff --check`：**PASS**。

本计划不重复运行全量 `npm run check`；04-19 负责所有 gap waves 合并后的 canonical full gate。

## 计划偏差

- 公共 artifact minimal genesis template 仍调用旧 caller-absence API。经 orchestrator 批准，最小同步修改 `src/artifact-contract.js` 与对应 contract tests，避免 production API 已关闭但公共模板继续示范不安全权威。
- 四生命周期 RED 暴露 write operation 在 `sourcePath !== destination path` 时错误用 destination 查 archive mode；已改为 exact `operation.sourcePath`。
- package manifest 已列出 Plan 14 authority-consumption，但 Builder runtime inventory 漏列，导致 packed closure fail closed；已补 exact runtime member，当前为 98 assets / 93 runtime。

这些偏差都是 existing contract closure，不新增 live runtime、domain 或 production authority。

## 证据边界

所有 lifecycle、config 与 credential-runner 验证都使用 disposable target、fake exact OpenClaw executable 和 value-blind results。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未联网，未触发真实 OpenClaw install/activation/runtime、schedule 或 MCP。当前证明 bounded mechanism execution，不证明真实 OpenClaw compatibility、domain quality、Birth、Delivery 或 production readiness。

External action results 当前由 transaction 返回，但 strict receipt 中的一对一 authority/result closure 仍由 04-16 实现。

## 剩余工作

- 04-16：strict receipt completion theorem 与 companion-backed exact authority/result admission。
- 04-18：extracted packed archive 的完整 lifecycle/adversarial journey。
- 04-19：docs、release、canonical full gate 与 post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
