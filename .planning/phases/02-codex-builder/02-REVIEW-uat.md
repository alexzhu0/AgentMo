---
phase: 02-codex-builder
reviewed: 2026-07-22T03:49:32Z
depth: deep
partition: uat
files_reviewed: 17
files_reviewed_list:
  - src/builder-codex-uat-private-authority.js
  - src/builder-codex-uat.js
  - src/builder-codex-uat-continuation.js
  - src/builder-immutable-journal.js
  - src/builder-hook-bridge.js
  - src/builder-behavior-eval.js
  - scripts/build-builder-uat-releases.js
  - scripts/preflight-codex-uat-prior-attempt.js
  - scripts/verify-codex-uat-candidate.js
  - test/builder-codex-uat-prior-attempt.test.js
  - test/builder-codex-uat.test.js
  - test/builder-hook-bridge.test.js
  - test/builder-hook.test.js
  - test/builder-packed-install.test.js
  - test/codex-builder-behavior.test.js
  - test/helpers/io-surface-inventory.js
  - test/artifact-surface-coverage.test.js
findings:
  critical: 12
  warning: 2
  info: 0
  total: 14
status: issues_found
---

# Phase 02: UAT / Journal / Hook Evidence-Chain Code Review

**Reviewed:** 2026-07-22T03:49:32Z
**Depth:** deep
**Files Reviewed:** 17
**Status:** issues_found

## Summary

对指定的 UAT、append-only journal、hook、continuation、private authority、behavior admission 及其测试链进行了逐文件和跨模块调用链审查。当前实现仍有 12 个阻断级正确性/证据完整性缺陷：prepared 数据可提前成为权威、若干崩溃窗口不可恢复、任意 hardlink 可被当作受控链接、cleanup 会物理删除或移动 pathname、human admission 可由普通调用者自铸、以及孤立 candidate 可伪装成 11/11 UAT 链。另有 2 个测试可靠性警告。

本次只读审查没有运行真实 UAT、网络调用或私有 locator，也没有修改源代码或测试。

## Narrative Findings (AI reviewer)

### Critical Issues

#### UAT-CR-01: Private authority 的 prepare/commit 协议会提前宣告 committed、接受陈旧 inode，并在崩溃后永久楔死

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:658-667`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:716-770`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:799-844`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat-prior-attempt.test.js:182-210`

**Mechanism:** publication final link 在 716 行出现，commit marker 在 760 行出现；761 行立即设置 `committed = true`，而 769 行把 authority-root directory `sync()` 失败吞掉，839-844 行随后仍返回 `committed-recovery-required`。若进程在 final link 后、commit marker 前死亡，catch cleanup 根本不会运行：未提交 final 占据确定名称，loader 因缺 marker 忽略它，后续 writer 又因 `link(..., final)` 的 `EEXIST` 永久失败。loader 还先完整读取并关闭 publication handle，再读取 marker，最后没有重开/重验 publication pathname；两次读取之间的 same-byte inode swap 会产出指向旧 inode 的 admission。`assertPrivateAuthorityMetadata` 只要求 `nlink >= 1`，因此额外任意 hardlink 也不会被拒绝。

**Impact:** 未经持久化的 bytes 可被报告为 committed；重启后无法继续唯一 successor；admission 的 identity 可能已不再绑定 canonical pathname，破坏 exact-byte/exact-inode authority。

**Fix direction:** 为 publication 和 marker 建立显式 `prepared -> directory-synced -> committed` operation record；只有 final、marker 及其父目录均成功 sync 后才置 committed。每次打开时恢复或拒绝所有 orphan prepared 状态；同时持有 publication/marker handles，读取后再次核对 pathname、inode、ctime/mtime/nlink，并只接受 operation-record 明确列出的链接。v1 恢复不得 rename/unlink，只追加 tombstone/inert recovery evidence。

**Deterministic test:** 用独立 child writer 在 `after-final-link`、`after-commit-link/before-directory-sync` 两处由父进程强制终止；fresh process 必须恢复到唯一确定状态且可继续一次。另注入 root `sync()` 失败、在 publication/marker 两次读取之间换入相同 bytes 的新 inode、以及创建未登记 hardlink；均不得返回 committed/admission。

#### UAT-CR-02: Immutable journal 在父目录持久化前暴露 successor，并在 sync 失败后本地铸造 committed head

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:159-216`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:252-303`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:497-580`

**Mechanism:** successor hardlink 在 167 行发布，但 parent directory 直到 188 行才 sync。并发 reader 的 `loadWithParent` 会把该链接直接纳入链并 mint head；没有独立 committed marker 将 prepared entry 隐藏。若 sync 或之后的检查抛错，256-273 行仅凭两个 hardlink 的 inode/nlink 就本地 `mintAdmission`，302 行再次吞掉 parent sync 失败，然后返回 committed。

**Impact:** reader 可观察并基于尚未 durable 的 head 追加下一 successor；崩溃后该 head 可能消失或恢复成不同状态，违反单 successor、append-only 和 restart consistency。

**Fix direction:** successor publication 必须先保持不可见 prepared 状态，父目录 sync 后再通过独立、同样 durable 的 commit record 变为可加载；loader 必须忽略 prepared entry。任何必要 sync 失败都只能返回 `rejected-before-commit`，不得由当前进程自行 mint committed admission。

**Deterministic test:** 三进程测试：writer 停在 `after_entry_link`，reader 此时必须仍看到旧 head，第二 writer 也不得从 prepared head 继续；分别在 entry link 后和 commit sync 前 kill writer，重启只能得到一个确定 head。注入 parent sync 失败时结果必须是未提交。

#### UAT-CR-03: Retained 目录中的任意 hardlink 会被 journal 当成合法 recovery link

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:583-611`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:918-995`

**Mechanism:** `inspectRetainedRemainders` 把 retained 目录中每个普通文件都加入 `retainedStats`，不校验名称、operation id、role 或 recovery record。`assertExpectedPublicationLinks` 随后把所有同 inode 项都计入允许的 nlink。相同 uid 的进程只要在 retained 目录创建一个任意名字的 hardlink，就能让多出的 link 被“正常化”为受控 recovery evidence。

**Impact:** loader 无法证明 publication 的完整 link set；任意别名可长期保留或被用于绕过 single-authority 检查，且后续 cleanup/recovery 会在错误的 authority 模型上继续。

**Fix direction:** retained link 必须由 canonical operation record 一一命名并绑定 operation id、role、publication digest 和 inode identity；出现任何未登记普通文件或同 inode link 都应 fail closed。不要用目录全量 inode 计数推导合法性。

**Deterministic test:** 在 retained 目录创建指向 genesis/successor 的 `foreign-copy` hardlink，同时保留所有合法文件；fresh loader 必须拒绝。再测试正确名字但无 operation record、错误 role 和跨 operation 重用，均必须拒绝。

#### UAT-CR-04: UAT leaf 的成功清理与 rollback 会物理 unlink pathname，并存在最后校验后的删除竞态

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1600-1616`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1720-1777`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat.test.js:686-740`

**Mechanism:** 正常成功路径会 unlink stage；错误路径会 unlink final 和 stage。`unlinkExactLeafBinding` 是 `lstat/assert` 后再按 pathname `unlink` 的 check/use 两步操作；并发者可在最后 assert 与 unlink syscall 之间换入 foreign inode，后者仍会被删除。现有 competitor 测试只在 final publish 之前占位，没有覆盖最后一次重验之后的竞态，也没有验证 v1 的“零物理删除”约束。

**Impact:** operation-owned 或 foreign pathname/bytes 会被物理删除；即使没有攻击，也直接违反本阶段 cleanup/retire/rollback 只能逻辑 tombstone/append-only/inert evidence 的目标合同。

**Fix direction:** 移除 leaf 路径上的所有自动 `unlink`。stage/final 只可追加不可变 disposition/tombstone record 并保持 inert；遇到不确定 binding 立即停止且不移动任何路径。若未来版本允许物理 GC，应由独立、明确授权且基于目录 fd/不可伪造 operation identity 的流程执行，而非 UAT 事务本身。

**Deterministic test:** 增加“最后一次 binding assert 之后、unlink 之前”的生产 seam，换入 foreign inode，断言其 pathname、bytes、dev/ino 全部保留；再覆盖 success、pre-link failure、post-link failure，断言没有任何 pathname 被删除，仅多出 tombstone evidence。

#### UAT-CR-05: Journal/private retirement 用 overwrite-capable rename 移走 source，甚至主动移动未知 foreign occupant

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:814-863`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:877-935`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat-prior-attempt.test.js:247-329`

**Mechanism:** 两个 retire 实现都在 pathname 校验后调用普通 `rename(source, randomDestination)`。该 syscall 会删除 source pathname，并可覆盖已存在 destination；source 也可在最后校验后被换成 foreign inode。更严重的是 `preserveAmbiguousPrivatePath` 在无法证明 ownership 时仍 rename 当前 source。现有测试把 foreign canonical occupant 被移动到 `.authority-retained`、canonical path 消失当成成功，正好固化了错误语义。

**Impact:** cleanup 可改变或覆盖非本 operation 所有的 pathname；private/public 边界出现歧义时不是 fail closed，而是主动变更外部状态。

**Fix direction:** v1 retirement 只追加绑定原 pathname、observed identity、operation id 和 disposition 的不可变 tombstone；永不 rename source。只要 identity 不确定，保留所有路径原状并返回 recovery-required。destination 也不得靠随机名规避覆盖语义。

**Deterministic test:** 在最后校验后换入 foreign source，并预置 deterministic retained destination；retire 必须不改变两者。将现有“foreign 被搬走”的断言反转为 canonical foreign pathname 与 inode 必须原样存在。

#### UAT-CR-06: Behavior/release cleanup 会递归删除可被换入的目录，release publish 还能覆盖迟到的输出目录

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-behavior-eval.js:114-213`, `/Users/alexzhu/Lenovo/AgentMo/scripts/build-builder-uat-releases.js:270-315`

**Mechanism:** behavior evaluation 在 `finally` 对临时 pathname 执行 `rm({recursive:true, force:true})`，没有保留目录 handle/identity，也不在删除前后验证 binding。release builder 同样按 pathname 递归删除 scratch root；且仅在长时间 build 之前检查一次 `outDirectory` 不存在，最后普通 `rename(publishRoot, outDirectory)` 可替换竞态期间出现的空目录。

**Impact:** 同 uid 并发者可把 pathname 换成 foreign tree，触发递归数据删除；release publication 可删除/替换迟到的 foreign output pathname。两者都违反本阶段禁止自动物理删除和 overwrite rename 的 v1 合同。

**Fix direction:** 临时结果在 v1 仅标记 inert/retired，不递归删除；保存并持续验证 parent/root authority。release 输出使用 absent-only publication protocol 和 durable commit marker，遇到 late occupant 必须保留双方并拒绝，不能 rename-overwrite。

**Deterministic test:** 在 pre-rm seam 将 work/scratch pathname 换成包含 sentinel 的 foreign tree，操作结束后 sentinel 与 inode 必须保留；在最终 publish 前创建空 output 目录，builder 必须拒绝且不得替换它。

#### UAT-CR-07: Uninstall arm 使用固定 stage/retained 名称且 loader 不证明第二 hardlink，导致崩溃楔死和伪造 admission

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:492-545`

**Mechanism:** publisher 固定使用 `${file}.stage` 和 `${file}.retained`。在 stage sync 后、final link 前死亡会留下 `.stage`，fresh retry 的 `O_EXCL` 永久失败；`rename(stage, retained)` 还可覆盖已有 retained pathname。loader 只要求 final 的 `nlink === 2`，从不打开或验证 `.retained` 是同一 inode，也不在 read/parse 后重新 stat handle/path。因此任意位置的第二 hardlink即可满足检查，same-byte inode swap 也能在返回前替换 canonical final。

**Impact:** after-uninstall continuation 既可能无法恢复，也可能接受未由 arm publication protocol 创建的文件作为 authority；foreign retained pathname 还可能被覆盖。

**Fix direction:** 使用唯一 operation id 和不可覆盖的 absent-only links，显式 durable commit record；loader 必须同时 retain final 与登记的 retained link，验证两者同 inode、精确 nlink/metadata/bytes，并在解析后复验。所有 crash remainder 通过 append-only recovery record 处理，不 rename/unlink。

**Deterministic test:** child process 分别死在 open/write/sync/link/retained-link/directory-sync 边界，fresh process 必须得到唯一 arm 或安全重试；另创建 arbitrary second hardlink、same-byte replacement 和 foreign `.retained` occupant，三者均不得被接纳或改变。

#### UAT-CR-08: After-uninstall continuation 缺失多个合法崩溃恢复状态，完成后重试也不是幂等的

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:92-109`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:347-470`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:1498-1552`

**Mechanism:** `completeArmedUninstall` 依次推进 checkpoint arm、observation leaf、scenario journal entry、candidate leaf、candidate-ready entry，但没有跨这些 durable stores 的 recovery state matrix：

- arm 写入后、scenario journal append 前崩溃，arm record 仍保存旧 `checkpointDigest`；重启 413-415 行按旧 digest 加载已前进 checkpoint，必然失败；
- scenario entry 已提交、candidate leaf 尚未发布时，`recoverCandidateReady` 只调用 `loadExistingCodexUatCandidate`，不会 publish-or-load，因文件不存在永久失败；
- candidate-ready 已提交但返回前崩溃，入口只接受 `observing` 或 `scenarios-complete`，fresh retry 直接拒绝。现有测试 1498-1503、1547-1552 反而把完成状态重试失败编码成期望行为。

**Impact:** 正常进程死亡可把唯一 UAT attempt 留在不可继续、不可幂等确认的状态；checkpoint、leaf 和 journal 之间可能永久分裂，违反 restart/compaction/after-uninstall continuation 要求。

**Fix direction:** 定义并实现每个 durable boundary 的显式恢复矩阵：old/new checkpoint、observation absent/present、scenario head old/new、candidate absent/present、candidate-ready absent/present。每一组合只能执行缺失的下一步或返回已完成结果；所有比较基于 exact admission/digest，不能假设 exception unwinding。

**Deterministic test:** child process 在每个 `await` 后由父进程 kill，fresh process 反复调用直至稳定；每个 case 最终都必须有一个 journal successor、一个 candidate、一个 candidate-ready entry，额外重试零 mutation 且返回同一结果。

#### UAT-CR-09: 普通调用者可绕过所谓私有 transition，直接自铸 `human-admission`

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:55-85`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:288-325`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:658-792`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1079-1142`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1250-1260`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1336-1344`, `/Users/alexzhu/Lenovo/AgentMo/scripts/verify-codex-uat-candidate.js:33-69`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat.test.js:338-370`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat.test.js:539-562`

**Mechanism:** 测试只确认 UAT 模块没有导出名为 raw transition 的 helper，但同一测试已直接导入并调用公开的 `appendImmutableJournalEntry`。任意调用者可先 `loadImmutableJournal` 取得有效 predecessor admission，再追加 canonical UAT `human-admission` entry；UAT loader 只做 schema/transition replay，而 candidate-ready -> human transition 仅核对 `candidateDigest`，不把 successor/release/tarball/verifier/decision evidence 重新绑定到 state 或外部人类凭据。正常 verifier API/CLI 也只接受调用者传入的字符串 `approve`，其 `decisionEvidenceDigest` 是对同一组调用参数自行求 digest，不是独立 human-decision artifact。

**Impact:** 自动化代码可在没有人类观察/批准、甚至没有真实 leaf evidence 的情况下生成 terminal `admitted` journal；这正是 D-29/D-31 禁止的自我认证。

**Fix direction:** human decision 必须是 producer 无法自行制造的一次性外部 admission，并绑定 candidate exact bytes、candidate-ready head、release/tarball/verifier identity 和 operator decision。loader 必须验证该 admission，而不是仅验证 entry 形状。若当前威胁模型无法证明人类来源，则 journal 只能记录“caller-reported decision”，不得把它升级为 terminal human admission。

**Deterministic test:** 从 candidate-ready head 仅使用公开 generic journal API 构造一个形状合法的 `human-admission`，fresh UAT loader 必须拒绝；无外部 decision admission 的 `verify...decision: approve` 也不得终结 attempt。有效外部 decision bytes 只能消费一次，且任何字段/bytes/head 改动都拒绝。

#### UAT-CR-10: `builder behavior --uat` 可把手写 candidate 与无关项目 receipt 拼接成“11/11” admission

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:546-561`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:795-820`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-behavior-eval.js:257-370`, `/Users/alexzhu/Lenovo/AgentMo/test/codex-builder-behavior.test.js:292-421`, `/Users/alexzhu/Lenovo/AgentMo/test/codex-builder-behavior.test.js:573-648`

**Mechanism:** candidate loader 只验证 caller 提供的 digest、canonical schema 和 false certification flags。behavior admission 检查 candidate 的 release/version/scenarioCount 与当前 receipt/host 相符，却从不加载 attempt journal、candidate-ready head、observation/checkpoint leaves 或 verifier decision，也不绑定 candidate attemptId 到当前 project/receipt。测试 helper 的 `_project` 参数完全未使用，且 behavior 接受的是刚发布、尚未 append candidate-ready 的 leaf；没有 handwritten canonical candidate 的负例。

**Impact:** 调用者可手写一个 release 相符、`scenarioCount: 11`、任意 `orderedEvidenceDigest` 的 canonical JSON，自报其 digest，即得到带当前 receipt/host bindings 的 UAT report 和人类输出 `Scenarios: 11/11`。这把互不相关的 bytes 合成为不存在的证据链。

**Fix direction:** behavior UAT 输入应是 attempt/journal authority，而非孤立 candidate path；要求 exact-load candidate-ready head、candidate bytes 以及被 journal 单向引用的 leaf admissions，并把 attempt/project/receipt/release 全部绑定。无法提供链时只能报告 untrusted candidate blob，不能显示 11/11 admission。

**Deterministic test:** 手写完全 canonical、release 匹配且 flags 全 false 的 candidate，不创建 journal/leaves；当前实现会通过，修复后必须拒绝。再把真实 candidate 跨项目/跨 receipt 重放，也必须拒绝且输出不得出现 11/11。

#### UAT-CR-11: Hook bridge 对同一有效 delivery 不是幂等的；重复/崩溃重放会因已存在 observation leaf 失败

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-hook-bridge.js:168-249`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-hook-bridge.js:390-441`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:387-445`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1524-1648`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:2171-2179`

**Mechanism:** applied event 先 durable 写 checkpoint，再发布 observation。replay 分支仍会为 active challenge 调用 `publishInstalledObservation`。observation value 不含 `applied/status`，所以同一 event/challenge 的 applied 与 duplicate replay 导出完全相同的 content-addressed final。`publishContentAddressedLeaf` 每次都新建 stage 并 hardlink final；final 已存在时 `EEXIST` 被映射为 leaf rejection，没有 exact-load-existing 的幂等路径。进程在 leaf 发布后、返回前崩溃也会触发同样问题。现有 replay 测试发生在不匹配当前 challenge 的 PostCompact 路径，因而没有实际走 observation publish。

**Impact:** 正常 duplicate delivery 或一次响应窗口崩溃可把 hook 变成永久错误，尽管 checkpoint 和 leaf 已正确提交；UAT 之后无法稳定记录/继续该 scenario。

**Fix direction:** content-addressed publisher 在 final 已存在时必须 exact-load、验证同 bytes/metadata/parent authority，并返回 `created:false`；不同 bytes/identity 才拒绝。hook result 应保留同一 observation digest，replay 不得新增 journal/leaf mutation。stage 处置仍遵守无 unlink/rename 的 tombstone 规则。

**Deterministic test:** 在 active `session-start`/`duplicate-replay` challenge 下连续提交相同 delivery 两次，两次都成功且返回同 digest，第二次 filesystem snapshot 不变；再 kill child 于 leaf publish 后、bridge return 前，fresh replay 必须得到相同结果。

#### UAT-CR-12: Candidate-ready 之后禁止 failure/interruption，违反完整状态矩阵和 bounded-failure 合同

**Severity:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1275-1300`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:37-46`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat.test.js:873-935`, `/Users/alexzhu/Lenovo/AgentMo/.planning/phases/02-codex-builder/02-CONTEXT.md:44-45`

**Mechanism:** 主 UAT reducer 在 1293-1295 行明确拒绝 candidate-ready -> failure/interruption，测试也把该拒绝写成期望；但 private continuation 的合法矩阵允许这两个转移，且 D-30/D-31 要求任一阶段失败都追加 bounded failure/interruption。candidate-ready 尚未得到 human decision，verifier 失败、operator 中断或证据漂移均无合法 terminal outcome。

**Impact:** attempt 会永久停留在非 terminal candidate-ready，不能忠实记录人工批准前的失败/中断；公共 journal 与 private continuation 还可能给出互相冲突的 terminal 状态。

**Fix direction:** 对所有非 terminal phase（包括 candidate-ready）允许 exact-evidence-bound failure/interruption；明确与 human-rejection 的语义差异，并保证只能追加一个 terminal successor。

**Deterministic test:** candidate-ready 后分别提交 verifier failure 与 operator interruption，fresh reload 必须得到相应单一 terminal；同一 predecessor 并发 human admission/failure 时必须只有一个成功，另一个 stale-reject。

### Warnings

#### UAT-WR-01: I/O surface coverage 只登记破坏性调用为 `gated`，并不执行 no-delete/no-overwrite 合同

**Severity:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:584`, `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:671`, `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:967`, `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:992`, `/Users/alexzhu/Lenovo/AgentMo/test/artifact-surface-coverage.test.js:163-184`

**Mechanism:** allowlist 明确包含 `rm`、`unlink` 和 `rename`，统一标为 `gated`；coverage test 只比较 discovered id 与 allowlist 并验证 status 字符串属于枚举。它不检查 UAT 模块是否禁止 recursive rm、pathname unlink 或 overwrite-capable rename。

**Impact:** 当前所有阻断级 destructive surfaces 都能让“every current repository write/output surface”测试通过；后续新增同类调用只需添加 allowlist 行即可获得假绿色。

**Fix direction:** 在 scanner/policy 中为 Phase 02 UAT 范围增加语义禁令：`rm`/`unlink` 一律拒绝，普通 `rename` 必须证明非 retirement/publication 或被 absent-only primitive 替代；`gated` 不能覆盖这些禁令。

**Deterministic test:** 添加包含 `unlink`、recursive `rm`、以及向已存在 destination rename 的 fixture，policy test 必须失败；当前生产清单在移除这些 surfaces 前不得通过。

#### UAT-WR-02: Fault tests 主要抛可捕获异常而非终止进程，并把完成后重试失败当成正确行为

**Severity:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat-prior-attempt.test.js:182-210`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-uat-prior-attempt.test.js:247-329`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:1498-1552`

**Mechanism:** private-authority fault seams 都是在同一 async 调用中 throw，生产 catch/finally 因而有机会移动 remainder 和关闭 handles；这不等价于 SIGKILL/power loss。packed continuation 只覆盖 `after-uninstall` 与 `after-candidate` 两个粗边界，并显式期待 candidate-ready 重试失败，没有枚举 checkpoint/observation/journal/candidate 各 commit 边界。

**Impact:** 测试无法发现只在没有 exception unwinding 的真实崩溃中出现的 orphan/wedge，也把非幂等恢复固化为测试合同。

**Fix direction:** 用父/子进程 barrier 和强制终止构建 crash harness；对每个 filesystem/journal commit 边界生成状态矩阵，并把“fresh retry 收敛到同一 authority、零额外 mutation”作为统一 oracle。

**Deterministic test:** 参数化遍历 private final/marker sync、journal entry/parent sync、uninstall checkpoint/leaf/journal/candidate/ready 等 checkpoint，逐个 kill child 后由第二个 fresh process 恢复两次，比较 head、inode set、bytes 和 directory snapshot。

---

_Reviewed: 2026-07-22T03:49:32Z_
_Reviewer: the agent (gsd-code-reviewer, UAT partition)_
_Depth: deep_
