---
phase: 04-package
plan: "12"
subsystem: openclaw-probe-and-apply-authority
tags:
  - openclaw
  - reprobe
  - provenance
  - process-isolation
  - fail-closed
requires:
  - 04-11
provides:
  - companion-backed OpenClaw probe authority
  - private verified executable copy and private cwd
  - mandatory fresh production reprobe before public apply effects
  - exact D-42 embedded package-manifest admission
affects:
  - 04-13
  - 04-14
  - 04-15
key-files:
  created:
    - .planning/phases/04-package/04-12-SUMMARY.md
  modified:
    - src/artifact-admission.js
    - src/artifact-contract.js
    - src/cli.js
    - src/javascript-static-analysis.js
    - src/openclaw-install-transaction.js
    - src/openclaw-probe-contract.js
    - src/openclaw-probe.js
    - src/package-archive.js
    - docs/MVP_RUNBOOK.md
    - release/2026.07.30.md
    - test/artifact-contract.test.js
    - test/artifact-surface-coverage.test.js
    - test/codex-builder-behavior.test.js
    - test/helpers/io-surface-inventory.js
    - test/openclaw-install-plan.test.js
    - test/openclaw-install-transaction.test.js
    - test/openclaw-probe.test.js
decisions:
  - A probe cannot authenticate its own source bindings; production validation requires authentic external companion admissions.
  - Public apply has no adapter or approved-probe fallback and must complete a fresh production reprobe before journal creation or target mutation.
  - OpenClaw observations execute only a verified private executable copy from a private empty cwd and synthetic environment.
  - Genesis and preview admit the package manifest from the already verified D-42 capture instead of rereading a mutable package pathname.
status: complete
completed: 2026-07-30
---

# Phase 04 Plan 12：可信新鲜 reprobe 与执行窗口收口

Plan 12 已关闭 CR-01、CR-02 与 CR-09 对应的首个根缺口：OpenClaw probe 不再能用内部自洽 digest 自证，public apply 不再允许复用旧 probe 或注入可替换 adapter，并且外部 OpenClaw pathname、调用 cwd 与 target 漂移均在任何 journal 或 target 写入前失败关闭。

## 完成内容

- `openclaw-probe` 现在精确准入 blueprint、build contract、plan approval、target carrier admission、target descriptor 与 D-42 archive 的真实 companion closure。
- probe 从保留的 no-follow 文件句柄复制已验证 executable bytes 到 mode `0700` 的私有目录，重新验证 identity/digest 后仅执行该私有副本；三次 observation 均使用私有空 cwd、固定 argv、`shell:false` 与合成非秘密环境。
- probe contract 关闭顶层与 nested key 集，并绑定 producer、source bindings、required observation、compatibility 与完整 fingerprint。
- `openclaw-install-apply` 删除 public adapter 和旧批准 probe fallback；每次 apply 在 authority/nonce 消费、journal 创建和目标效果前直接执行生产 reprobe，并比较完整 package、target、source 与 fingerprint closure。
- genesis/preview 从一次验证完成的 D-42 capture 精确准入内嵌 canonical package manifest，避免第二次 pathname 读取带来的替换窗口。
- 公开 help 与 runbook 已同步完整 blueprint/build-contract/plan-approval/target companion 参数。
- 静态 I/O inventory 明确登记新增的 6 个 durable loader，未新增未归属写入面。

## 对抗验证

新增或强化的用例覆盖：

- 内部 digest 自洽但没有真实 companion provenance 的 hand-built probe；
- identity-only target carrier；
- public API/CLI 缺少 fresh reprobe 输入或试图回退到旧 probe；
- executable 在 observation 窗口内替换；
- target authority 在 observation 窗口内替换；
- 调用 cwd 注入恶意模块或配置；
- D-42 内嵌 manifest、成员、inventory 与外部 archive digest 漂移；
- genesis、install、upgrade、uninstall 与 rollback 的 exact companion admission。

## 验证结果

- package admission/produce/inspect gate：**37/37 PASS**。
- OpenClaw probe/install-plan/install-transaction/Phase 4 contract gate：**35/35 PASS**。
- artifact contract、command docs、static I/O surface gate：**30/30 PASS**。
- 独立 static I/O surface gate：**17/17 PASS**。
- `git diff --check`：**PASS**。

`npm run check` 完整运行得到明确退出码 `1`：893 tests，891 pass，1 fail，1 skip。唯一失败是既有 packed Builder behavior 测试把完整 CLI receipt/投影准入时间误计入 8 秒 PATH-shadow 回收预算。根因修复没有放宽生产 timeout 或 8 秒断言：测试现在与相邻用例一样，从恶意 PATH-shadow 真实启动时间计时。修复后的精确隔离用例为 **1/1 PASS**；总用例时间约 124 秒，其中实际恶意 probe 的有界回收仍满足 `<8s`。为避免无意义循环，没有再次运行约 24 分钟的全量套件；04-19 仍负责 canonical final full gate。

## 证据边界

所有 executable、target 与 lifecycle 效果均位于一次性 fixture root 或 fake official seam。未读取 `.env`，未使用真实凭据，未修改用户 HOME，未运行真实 OpenClaw install/activation/runtime，未连接 MCP，未执行 schedule，未形成 domain、Birth、Delivery 或 production 证明。

## 剩余工作

- 04-13：retained-dirfd native safe-fs kernel、OS no-replace 与 durable helper build receipt。
- 04-14/04-17：durable nonce、official credential route、publisher failure semantics、nested recipe 与 canonical goal metadata。
- 04-15/04-16：完整 lifecycle 与严格 receipt completion theorem。
- 04-18：packed archive 的完整 lifecycle/adversarial closure。
- 04-19：文档、release、canonical full gate 与 post-review/verifier 前置审计。

## 提交状态

未 stage、未 commit、未 push。
