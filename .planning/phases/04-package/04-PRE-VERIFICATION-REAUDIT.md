# NONCANONICAL PRE-VERIFICATION REAUDIT

> 本报告是 fresh、advisory、non-self-certifying 的 Phase 4 pre-verification 输入。它不运行或模拟 `gsd-verifier`，不证明 Phase 4 通过，不证明 OpenClaw live-success、domain quality、Birth、Delivery、production readiness 或 wider compatibility。

**Reviewed:** 2026-07-31T12:13:48Z  
**Depth:** deep / adversarial / cross-module  
**Result:** **BLOCKED — 不应进入 canonical verification**  
**Findings:** **Critical 3 / Warning 0 / Total 3**

## 审计范围与边界

本轮从当前 dirty worktree 重新阅读 Phase 4 的 authority、receipt/evidence、official action、safe-fs、package publication、CLI 与 packed-test 调用链，并复核：root gaps 1..6、`CR-01..10`、`WR-01..03`、`PACK-01..05`、Plan 04-13 helper admission、Plan 04-14 marker crash/race、Plans 04-12..19 的 ASVS L1 high/critical claims，以及 main / packed-hook-chain / packed-behavior / immutable-successor test lanes。

主要实现与测试证据包括：

- `src/openclaw-authority-consumption.js`
- `src/openclaw-install-transaction.js`
- `src/openclaw-install-approval.js`
- `src/openclaw-install-evidence.js`
- `src/openclaw-install-receipt.js`
- `src/openclaw-official-action-runner.js`
- `src/openclaw-credential-handoff.js`
- `src/openclaw-safe-fs.js`
- `src/package-produce.js`
- `src/package-archive.js`
- `native/openclaw-fs-kernel.c`
- `src/cli.js`, `package.json`
- `test/openclaw-install-transaction.test.js`
- `test/openclaw-install-evidence.test.js`
- `test/openclaw-credential-handoff.test.js`
- `test/package-produce.test.js`
- `test/builder-packed-install.test.js`
- `test/codex-builder-behavior.test.js`
- `AGENTS.md`、Plans/Summaries 04-13/14/19、既有 review/verification/pre-audit、runbook/contracts 与 `release/2026.07.31.md`

本轮未读取 `.env`，未联网，未运行真实 OpenClaw，未修改 product/test/canonical review/verification/ROADMAP/STATE/release，未 stage、commit 或 push。既有全量/packed 结果只作为 bounded mechanism evidence；本报告没有把绿测当成安全证明，也没有重复耗时全量门。

## 结论摘要

此前 C-03/C-04/C-05/C-08、W-01/W-02 的主体修复是实质性的：config child 已改用 retained FD，跨 family nonce 先做全局唯一性检查，package directory/archive 在关键 publication 边界重复关闭完整 member closure，credential 路由 fail-closed 为 proposal-only，helper/receipt 与 private-temp recovery 也有成对、逐项证据。

但仍存在三个 ship-blocking 缺陷：

1. canonical authority ledger 的**路径**虽不再由 CLI 选择，其**对象身份**却没有进入任何预先批准的 authority。相同 UID 可移走整个 ledger 目录，让下一次调用在同一路径创建新 inode，已消费 nonce、finalization head 和 producer evidence 一并失去约束。
2. config candidate 在打开并保留三个 FD 后，仍直接 `unlink(candidatePath)`；相同 UID 在 open 与 unlink 之间替换该名称时，AgentMo 会删除替换者对象，构成真实数据丢失竞态。
3. official runner 仅证明原始 PGID 关闭。后代执行 `setsid` 并使用 ignored stdio 后会脱离该 PGID；父进程正常退出时 runner 可返回 `processGroupClosed=true`、`quiescenceVerified=true` 和成功，而逃逸进程仍可继续执行或延迟修改状态。

因此 `release/2026.07.31.md` 对 C-01、C-06、C-07 的 closure 表述不成立；已有 tests 对 caller-selected CLI flag、inherited stdout 和普通 process-group descendants 的覆盖没有命中上述状态转换。

## Critical findings

### C-01 — 派生路径不是不可替换 authority：ledger 目录重建会恢复已消费 approvals

**Severity:** Critical  
**Affected:** root gap 2、root gap 4、historical CR-05/CR-07/CR-08、old audit C-01/C-02、Plan 04-14 T-04-G14-01/02、Plan 04-16 T-04-G16-01/02

**Evidence:**

- `src/openclaw-authority-consumption.js:110-143` 对 target root 做身份检查后，仅由 target descriptor digest 推导 sibling pathname；该路径 absent 时会直接 `mkdir`。
- `src/openclaw-authority-consumption.js:155-167` 直到打开新目录后才把当前 inode 写入 `authorityId`。这个新 `authorityId/rootIdentity` 没有被先前批准的 install/sensitive/conflict authority 锁定。
- `src/openclaw-install-approval.js:66-85` 与 `src/openclaw-install-approval.js:100-130` 的 ordinary approval 只绑定 plan/archive/lifecycle/target/scope/time/nonce，没有 canonical ledger identity；conflict approval 在 `src/openclaw-install-approval.js:185-230` 也没有该绑定。
- `src/openclaw-install-transaction.js:233-244` 只比较 canonical **pathname**，随后在 `src/openclaw-install-transaction.js:261-280` 打开或创建该 pathname 对应的 ledger 并消费 authority。
- `test/openclaw-install-transaction.test.js:2337-2356` 只证明公开 CLI 拒绝 `--authority-state-root`，没有覆盖“同一 canonical pathname 的原 ledger 被 rename/remove，随后创建新 inode”的 replay。
- post-state/action/finalization 的 re-admission 最终仍重新打开这个 ledger（`src/openclaw-install-transaction.js:995-1033`）；evidence 和 finalization records 也全部创建在该 ledger（`src/openclaw-authority-consumption.js:378-407`、`:446-515`）。所以 ledger replacement 同时削弱 old C-02 的 non-self-certifying producer boundary，而不只是 nonce marker。

**Impact:** 持有一组仍在时间窗内的精确批准与 artifact bytes 的相同 UID 调用方，可以先移动 canonical ledger 目录，再以相同 target/descriptor 调用 apply。新目录产生新 `authorityId`，原 marker/finalization/evidence 不再可见，原本 one-use 的普通、敏感和 conflict authority 可被再次消费。receipt closure 随新 ledger 自洽，无法证明这是同一 approval 的第二次使用。

**Required fix:** 在任何批准签发前建立不可替换的 authority anchor，并将其 `authorityId + root identity` 精确纳入 install、sensitive、conflict approvals、plan/preview 与 receipt closure。若无法依赖 OS-protected/append-only storage，则 canonical root 一旦缺失或 inode 改变必须永久 fail closed，不能自动 `mkdir` 新 authority universe。增加 fresh-process regression：完成一次消费后 rename 整个 ledger root，在原 pathname 建同 mode 新目录；第二次精确 replay 必须在 journal/effect 前拒绝。

### C-02 — retained candidate 仍按 pathname 删除，替换竞态可误删无关对象

**Severity:** Critical  
**Affected:** root gap 3、root gap 6、historical CR-04/CR-10、old audit C-06、Plan 04-13 T-04-G13-03、Plan 04-17 T-04-G17-01/02

**Evidence:**

- `src/openclaw-official-action-runner.js:444-468` 以 `O_EXCL|O_NOFOLLOW` 创建 candidate，关闭 writer，然后通过同一 pathname 打开三个 retained handles。
- `src/openclaw-official-action-runner.js:469` 随即无任何 name-to-inode revalidation 地执行 `unlink(candidatePath)`。
- 对 inode/digest/nlink 的检查在 unlink **之后**才发生（`src/openclaw-official-action-runner.js:470-485`、`:503-535`），只能证明 retained handles 指向旧 candidate，不能证明被 pathname 删除的是旧 candidate。
- `release/2026.07.31.md:25` 和 `docs/MVP_RUNBOOK.md:453` 宣称失败/producer 路径没有 pathname cleanup；生产代码的这一处 `unlink` 与声明矛盾。

**Impact:** 相同 UID 进程可在三个 open 完成后、unlink 发生前 rename candidate 并在原名称放入另一普通文件。AgentMo 将 unlink 替换文件；若它是该对象唯一链接，会造成数据丢失。之后 retained FD 仍能通过全部 candidate 检查，所以删除动作不会被检测或体现在 recovery evidence 中。

**Required fix:** 不要从 JavaScript 按 pathname unlink 已打开对象。Linux 可使用 native helper 的 `O_TMPFILE`/等价 unnamed inode；无法提供 identity-safe unnamed file 的平台应保留 named private candidate 并在结果/recovery 中 itemize，而不是删除。若继续使用名称，必须由 retained-parent native primitive 原子验证 expected dev/inode 后处理，且替换者只能 preserved。增加 deterministic hook/race test：open 后替换 candidate pathname，断言替换者 bytes/inode 保留且操作 fail closed。

### C-03 — `setsid` + ignored stdio 可逃离 PGID 并被误报为 quiescent success

**Severity:** Critical  
**Affected:** root gap 1、root gap 5、historical CR-09、old audit C-07、Plan 04-12 T-04-G12-02/03、Plan 04-15 T-04-G15-02/04

**Evidence:**

- `src/openclaw-official-action-runner.js:767-777` 只把直接 child 建成新的 POSIX process group；`processGroupId` 固定为 direct child PID（`:784-788`）。
- closure proof 只调用 `process.kill(-processGroupId, 0)`（`:818-825`、`:1023-1029`），TERM/KILL 也只发给该原始 PGID（`:886-920`）。代码没有 subreaper、cgroup/namespace、pidfd descendant tracking 或其他跨 `setsid` containment。
- direct child 的 `close` 到达且原 PGID 不存在时，会执行 `settle(true, !streamsForcedClosed)`（`:939-947`）；`successful` 把这些字段当充分成功条件（`:1001-1008`）。一个 detached child 若 `stdio:"ignore"` 并 unref，不会阻止 parent stdout/stderr close。
- 当前逃逸测试 `test/openclaw-credential-handoff.test.js:617-660` 刻意让 escaped child `stdio:['ignore','inherit','ignore']`，因此只验证 inherited stdout 会让 quiescence false；它没有覆盖 ignored stdio 的逃逸后代。
- `release/2026.07.31.md:26,44` 与 `docs/STAGE_CONTRACTS.md:173-176` 已把 `setsid` 明列为 residual limitation，但 official config result 仍可据此签发成功 evidence，而不是将该平台/route 标为 unsupported。

**Impact:** 被执行的 OpenClaw bytes 或其依赖可创建新 session、关闭 stdio、让 parent 以 0 退出，并在 AgentMo 返回成功后继续读取 private state、写文件或延迟修改。该状态会被记录为 process group closed/quiescent，破坏 result evidence 与 receipt completion 的因果边界。

**Required fix:** 在无法证明全 descendant closure 的平台上让有副作用的 official route fail closed/unsupported。可接受的实现需要 OS-level containment（例如专用 cgroup + 完整成员为空证明、受控 sandbox/service/job object，或等价 descendant authority），而非增加原 PGID 的等待时间。增加 escaped child `detached:true, stdio:'ignore'` 的回归测试：parent 0 退出，escaped child 延迟写 canary；AgentMo 必须不能返回 success，且 canary 不得在返回后出现。

## Coverage matrix

### Root gaps 1..6

| Gap | Fresh status | Evidence/conclusion |
|---|---|---|
| 1 — authentic fresh probe/execution window | **PARTIAL / BLOCKED** | companion-backed fresh probe、private executable/cwd/env 与 FD config transport 已存在；跨-session descendant containment 仍失败（C-03）。 |
| 2 — durable authority/credential confusion | **FAIL** | closed credential grammar/proposal-only 是安全的；marker root 可整体重建，one-use authority 不成立（C-01）。 |
| 3 — retained-dirfd mutation/helper chain | **PARTIAL / BLOCKED** | target safe-fs 与 helper admission 主体成立；candidate unlink 仍是 destructive pathname operation（C-02）。 |
| 4 — non-self-certifying receipt | **FAIL** | recursive companion/evidence re-open 明显收紧；但 producer/evidence universe 依赖可重建 ledger，不能成为独立 post-effect authority（C-01）。 |
| 5 — observed genesis/executable lifecycle | **PARTIAL / BLOCKED** | observed genesis、四 lifecycle 与 credential fail-closed 已实现；official action 仍可留下未被证明关闭的后代（C-03）。 |
| 6 — temp-complete publication/recovery/nested packed closure | **PARTIAL / BLOCKED** | package nested closure 和逐项 temp evidence 已修复；official candidate 的 pathname unlink 仍可删除 replacement（C-02）。 |

### Historical `CR-01..10` / `WR-01..03`

| Item | Fresh status | Revalidation |
|---|---|---|
| CR-01 | CLOSED original | Apply 直接做 production reprobe；未发现旧 approved-probe fallback。 |
| CR-02 | CLOSED for input authority | carrier/probe/descriptor/plan/archive 都有 external digest + companion admission；output authority 仍受 C-01 影响。 |
| CR-03 | CLOSED original | Config child 只接收 retained config FD，final mutation 走 `replaceExact`；Darwin fail closed。 |
| CR-04 | CLOSED original, new destructive branch | cached recovery truth 已移除；C-02 是新的 candidate name swap/delete 路径。 |
| CR-05 | **OPEN** | marker primitive durable，但其 canonical ledger 可被整体重建（C-01）。 |
| CR-06 | CLOSED | plugin/MCP/config confusion grammar 被拒；credential route proposal-only 且不启动进程。 |
| CR-07 | **PARTIAL / BLOCKED** | completion theorem + recursive companions 已实现；可重建 evidence ledger 仍破坏独立 complete proof（C-01）。 |
| CR-08 | **PARTIAL / BLOCKED** | plan/approvals/nonces/results/evidence 字段和 cardinality 已补齐；producer root 仍不稳定（C-01）。 |
| CR-09 | **OPEN in descendant window** | private executable/cwd/env 修复 pathname race；`setsid` escape 尚未封闭（C-03）。 |
| CR-10 | **OPEN** | package publishers 不删 reopened public names；official candidate 仍无 identity check 地 unlink（C-02）。 |
| WR-01 | CLOSED as bounded Phase 4 behavior | 四 lifecycle 可执行；credential 明确 unsupported/proposal-only，不再伪称成功。 |
| WR-02 | CLOSED | absent genesis 由 retained session 观察/复验，不再信 caller absence claim。 |
| WR-03 | CLOSED | nested approved suffix 保留并做 collision/traversal validation。 |

### Old audit `C-01..C-08` / `W-01..W-02`

| Old item | Fresh status |
|---|---|
| C-01 caller-selected authority root | **OPEN in a different form**：CLI selector 删除，但同 canonical pathname 可重建为新 inode（本轮 C-01）。 |
| C-02 receipt self-certification | **PARTIAL / BLOCKED**：specialized evidence + recursive closure 是实质修复；root replacement 使 producer authority 仍不独立（本轮 C-01）。 |
| C-03 config pathname/hard-link race | CLOSED original：retained FD + `replaceExact`。 |
| C-04 cross-family nonce late failure | CLOSED：`src/openclaw-authority-consumption.js:718-725` 在 reservation/effect 前拒绝跨-family duplicate nonce。 |
| C-05 nested package closure | CLOSED：`src/package-produce.js:230-349` 在 archive build、directory publication 和 archive publication 后均复验完整 closure。 |
| C-06 destructive cleanup | **OPEN**：`src/openclaw-official-action-runner.js:469`（本轮 C-02）。 |
| C-07 child-only timeout | **OPEN**：原 PGID 处理加强，但 `setsid`/ignored-stdio escape 仍可成功返回（本轮 C-03）。 |
| C-08 credential false success | CLOSED：`src/openclaw-credential-handoff.js:74-127` 固定返回 unsupported、credentialPresent false、processStarted false。 |
| W-01 helper/receipt orphan | CLOSED：`src/openclaw-safe-fs.js:91-278` 对 pair 的 parent/member identity、failure point 和 recovery 做闭合记录。 |
| W-02 missing temp evidence | CLOSED：`src/package-produce.js:844-933` 对 exact/mismatch/unknown candidate 均保留一条 recovery item。 |

### `PACK-01..05`

| Requirement | Fresh status | Boundary |
|---|---|---|
| PACK-01 | SATISFIED (bounded) | versioned manifest 的 identity/bindings/compatibility/inventory/permissions/evidence/boundary/risk 闭合。 |
| PACK-02 | SATISFIED (bounded) | offline package 提供声明的 prompts/skills/tools/hooks/memory/evals/mappings，不自动 activation。 |
| PACK-03 | SATISFIED (bounded) | deterministic archive 与当前三次 nested directory/archive closure 已关闭旧 C-05。 |
| PACK-04 | SATISFIED (bounded) | workspace/skill default；native plugin 依赖 exact recipe/admission；无 MCP surface。 |
| PACK-05 | SATISFIED (bounded) | inspect/read-only 与 inventory/persistability 边界不包含 `.env`、credential/raw transcript/provider payload/authority state/prebuilt helper。 |

PACK 结论只证明离线 bytes、inventory、determinism 与 inspection contract，不抵消 install authority/official action 的三个 Critical，也不构成 live 或 domain certification。

## Plan 04-13 / 04-14 re-audit

### 04-13 helper admission

**PASS for the helper tuple, not phase closure.** `src/openclaw-safe-fs.js:91-278` 固定 source、`/usr/bin/cc`、argv、closed environment、binary/receipt bytes、parents/member identities；apply 在 journal/effect 前重开 exact helper tuple。native kernel 的 retained-dirfd walk、no-follow、native no-replace 与 marker sync 主体没有发现新的 supply-chain bypass。C-02 位于 official config candidate 的 JavaScript unlink 分支，说明“所有相关 writer 均无 pathname cleanup”的上层结论不能通过，但不否定 helper admission 本身。

### 04-14 marker crash/race semantics

**PASS primitive / FAIL authority lifecycle.** `native/openclaw-fs-kernel.c:1200-1240` 的 final-name-first marker write/fsync/identity checks 与 per-name O_EXCL 能处理 concurrent writer、zero/partial crash 和 exact-resume；`src/openclaw-authority-consumption.js:718-725` 也先拒绝跨-family nonce reuse。可是 marker 只对当前 ledger inode 有效；`openOpenClawCanonicalAuthorityLedger` 在 canonical pathname absent 时创建全新 root，因此“nonce 永不释放”的系统级结论仍因 C-01 失败。

## ASVS L1 high/critical re-audit

| Plan / threat set | Fresh disposition |
|---|---|
| 04-12 G12-01/04 companion + reprobe | MITIGATED in reviewed path。 |
| 04-12 G12-02/03 executable window + cwd/env | **PARTIAL**：private copy/cwd/env 有效；descendant execution window 因 C-03 未闭合。 |
| 04-13 G13-01/02 retained path/root | MITIGATED in native target path。 |
| 04-13 G13-03 recovery replacement | **PARTIAL**：target recovery 安全；official candidate unlink 仍删除 pathname replacement（C-02）。 |
| 04-13 G13-04/SC helper supply chain/install hooks | MITIGATED in reviewed bounded path。 |
| 04-14 G14-01/02 nonce + marker | **FAIL at root lifecycle**（C-01）；marker primitive 本身通过。 |
| 04-14 G14-03/04/05 credential/decision/disclosure | MITIGATED by closed grammar、exact validation、proposal-only/value-blind result。 |
| 04-15 G15-01 genesis | MITIGATED。 |
| 04-15 G15-02 config patch/base drift | **PARTIAL / BLOCKED** by C-02 and C-03。 |
| 04-15 G15-03 lifecycle asset preservation | MITIGATED in reviewed retained-safe-fs path。 |
| 04-15 G15-04 dispatcher | **FAIL containment**：grammar/verified executable 成立，escaped descendant 不成立（C-03）。 |
| 04-15 G15-05/SC disclosure + no plugin/MCP route | MITIGATED in persisted evidence/grammar。 |
| 04-16 G16-01/02 receipt complete/substitution | **PARTIAL / BLOCKED**：recursive closure 成立，authority root 不稳定（C-01）。 |
| 04-16 G16-03/04 dropped result/disclosure | MITIGATED in schema/cardinality/value-blind path。 |
| 04-17 G17-01/02 publication cleanup | **FAIL as repo-wide claim**：package publishers 安全，但 C-02 仍存在。 |
| 04-17 G17-03 nested path | MITIGATED。 |
| 04-18 G18-01..04/SC packed boundary | MITIGATED for bounded extracted-package inventory/test boundary；不认证 live behavior。 |
| 04-19 G19-01/03/04 audit boundary | MITIGATED by this report：首行/non-self-certifying 标记、无 secrets/raw logs、无 canonical artifact mutation。 |

## Test-lane re-audit

| Lane | Composition finding | Security conclusion |
|---|---|---|
| `check:test:main` | `package.json:119` 设置 `AGENTMO_TEST_LANE=main`；packed behavior describe 在 `test/codex-builder-behavior.test.js:922-927` 整体 skip，packed hook 在 `test/builder-packed-install.test.js:3647-3651` skip。 | 分 lane 设计清晰，不把 packed setup 混进 main。 |
| `check:test:packed-hook-chain` | `package.json:120` 精确运行单一 hook-chain name。 | 覆盖 hook/bridge/reducer/checkpoint；与本轮三个 install/runtime finding 无关。 |
| `check:test:packed-behavior` | `package.json:121` 运行整个 behavior file；setup 在非-main lane 执行（`test/codex-builder-behavior.test.js:814-920`），describe `concurrency:false`，8 个 tests 均位于该 describe。 | lane 没有隐藏 behavior tests；但不是 OpenClaw install containment test。 |
| `check:test:immutable-successor` | 独立 script 在 `package.json:122`；同名 test 在 packed-behavior lane 也会执行，因为其 skip 只针对 main。 | `npm run check` 未单独调用它不构成 omission；packed-behavior 已包含。 |
| authority replay tests | 当前 public CLI test 只拒绝 caller-provided root flag（`test/openclaw-install-transaction.test.js:2337-2356`）。 | **缺失 ledger pathname same / inode replaced regression**，故无法关闭 C-01。 |
| process escape tests | 当前 test 让 escaped process 继承 stdout（`test/openclaw-credential-handoff.test.js:617-660`）。 | **缺失 ignored-stdio setsid escape + delayed mutation regression**，故无法关闭 C-03。 |
| package closure tests | `test/package-produce.test.js:375+` 覆盖 archive 后 nested mutation；生产 `src/package-produce.js:237-349` 多次复验。 | 足以关闭 old C-05/W-02 的当前机制缺口。 |

已有 2026-07-31 full/packed exit evidence 可以证明这些 lanes 在其既定场景中运行成功；它不能反驳未建模的 ledger-root replacement、candidate unlink replacement 或 ignored-stdio session escape。

## Gate disposition 与非认证边界

- **不得开始 canonical Phase 4 verification**：Critical 3，Warning 0。
- 必须先修复 C-01..C-03，并加入上述三个 deterministic adversarial regressions；随后重跑 focused OpenClaw suites、main、packed-hook-chain、packed-behavior、`npm run check`、`npm pack --dry-run --json` 与 `git diff --check`。
- 修复后需由另一 fresh reviewer 重新检查 authority anchor、no-pathname-delete 和 descendant containment；本报告不能自我关闭这些 findings。
- 即使后续全部绿灯，证明范围仍限于 deterministic/fixture/native/packed mechanism。真实 OpenClaw HTTPS/runtime、credential state、domain quality、Birth、Delivery 和 production 必须留给其明确的人类 gate 与后续 phase。

---

_Reviewer: fresh adversarial Phase 4 re-audit_  
_Status: noncanonical / advisory / non-self-certifying_
