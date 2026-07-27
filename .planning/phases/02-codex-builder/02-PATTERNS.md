# Phase 02: Codex Builder 验收缺口 — Pattern Map

**Mapped:** 2026-07-15
**Scope:** 仅 `BLDR-01` / `BLDR-07` 的最小可执行修复面
**Strong analogs:** 5
**Source of truth:** `02-VERIFICATION.md` 的两条断链，不扩展 Phase 2 范围

## Scope anchor

本次修复不重做 Builder 架构，只接通已经存在但断开的两条链：

```text
packed release
  -> receipt-managed plugin + version-bound runtime launcher
  -> Codex official install/enable
  -> observed skill/hooks/trust state

Codex SessionStart / PreCompact / PostCompact payload
  -> installed runtime launcher
  -> canonical Builder event
  -> exact checkpoint CAS
  -> announcement/proposal only
```

锁定边界：

- setup 仍是 preview + explicit apply；preview 不得触发 Codex mutation。
- Codex cache、config 与 hook trust 都是 host-owned；只能通过官方接口观察或变更，不能直接写 cache/trust bytes。
- launcher/core 必须来自同一个 packed release，并进入 marker、receipt、digest、upgrade、uninstall 所有权模型。
- hook 只持久化已验证 checkpoint、发现恢复状态并给出 proposal；不得批准决定或推进阶段。
- `declared/projected`、`installed`、`enabled`、`visible`、`trusted`、`host-behavior-verified` 必须是不同状态。
- 自动化测试可以证明确定性机制；只有真实 Codex 新会话观察才能把 `hostBehaviorVerified` 置为 `true`。

## Minimal file classification

| File / symbol | Action | Gap role | Closest existing pattern |
| --- | --- | --- | --- |
| `src/builder-package.js` | modify | 将 `bin/agentmo.js`、`package.json` 与 `src/cli.js` 的完整本地 import closure 纳入 deterministic release assets，并投射到 plugin 内固定 `runtime/agentmo/` 路径 | 当前 `BUILDER_PLUGIN_FILES` + release basis (`8-94`) |
| `src/builder-install.js` | modify | 把 runtime assets 与官方 host activation operation 放进同一 preview digest；文件与 activation 验证完成后才发布 receipt / 返回 installed | 当前 managed files + receipt-last apply (`45-103`, `117-253`, `291-319`) |
| `src/builder-codex-host.js` | **new** | 唯一 Codex host adapter：固定 read-only observation 与显式 install/remove argv/RPC，限制输出并归一化 discovered/installed/enabled/skill/hooks/trust | `builder-probe.js:9-108` 的固定命令与 value-blind normalization |
| `src/builder-doctor.js` | modify | 合并文件投射与真实 host observation；保持严格只读，分别报告 activation surfaces | 当前 `diagnoseBuilderInstall` / `diagnoseVisibility` (`41-170`, `358-410`) |
| `src/builder-lifecycle.js` | modify | 将 runtime 文件纳入 exact receipt ownership；upgrade/uninstall 通过 host adapter 处理官方 plugin lifecycle，并继续 receipt-last | 当前 plan/apply + revalidation/quarantine (`73-173`, `176-380`, `626-669`, `757-871`) |
| `src/builder-hook-bridge.js` | **new** | bounded host payload -> admitted receipt/checkpoint -> stable hook event -> checkpoint CAS；不接受 host 提供的 workflow/stage/sequence | `builder-events.js` + `builder-checkpoint.js` + CLI hook route |
| `src/builder-events.js` | reuse-first | 保留 canonical event validation、origin restrictions、dedup/cursor 与 proposal-only reducer；仅在 bridge 需要共享 event-identity helper 时小改 | `48-181`, `254-349`, `419-434` |
| `src/builder-checkpoint.js` | reuse-first | 保留 exact digest admission 与 lock-backed CAS；bridge 必须调用它，不能另写 checkpoint writer | `103-145`, `311-347`, `362-380` |
| `src/builder-behavior-eval.js` | modify | 从 standalone hook + synthetic CLI 拼接改为调用已安装 runtime/hook bridge，并绑定真实 host observation；证据旗标只由观测事实决定 | 当前 bounded receipt/release/result binding (`71-180`) 与隔离 child (`356-419`) |
| `src/cli.js` | modify | 注入 host adapter；增加内部 hook-bridge route；维持统一脱敏输出与现有 Builder dispatcher | 当前 Builder dispatch (`123-244`) 与 exact parser (`834-981`) |
| `plugin/hooks/agentmo-hook.js` | modify | 继续做 64 KiB 输入边界；non-trigger no-op；对三类 hook 调用 `${PLUGIN_ROOT}` 下版本绑定 launcher 并映射 bounded result | 当前 bounded stdin/event allowlist (`3-20`) |
| `plugin/hooks/hooks.json` | modify if needed | 把 `${PLUGIN_ROOT}` 下 runtime launcher 的精确路径传给 hook；不调用全局 `agentmo` | 当前 command hook registration (`1-38`) |
| `plugin/skills/agentmo/SKILL.md` | modify | 所有命令改为项目投射中的确定性 `node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js ...` 入口 | 当前错误地依赖裸 `agentmo` (`8-13`) |
| `package.json` | modify | 将新增 production modules 加入 syntax check；packed `files` 已包含 `bin/`, `plugin/`, `src/`，不再添加第二个发行物 | 当前 `files` / `check` (`6-16`) |
| focused tests below | modify/new | 用 packed artifact、isolated HOME/CODEX_HOME、fake official host adapter 和 hostile races 封闭两条链 | 见 Pattern 1–5 |
| `test/helpers/io-surface-inventory.js` | modify after code settles | 对新/移动的生产 I/O 行做 exact allowlist 分类 | 当前 Phase 02 rows (`90-179`) |

### Files to leave alone unless a failing test proves otherwise

- `src/builders/contract.js`, `src/builders/codex.js`, `src/builders/registry.js`: adapter contract 已通过验收；不要借 gap 修复重写中立核心。
- `src/builder-entry.js`: start/direct/resume 共用路由已满足 `BLDR-03`。
- checkpoint schema 与 reducer transition rules：当前已经 exact、fail-closed、proposal-only；hook bridge 应复用，不应建立第二套状态机。
- Stage 3/4 research、OpenClaw package、domain evaluation：不属于本切片。

## Pattern assignments

### 1. Packed release -> deterministic runtime projection -> receipt-last

**Primary analog:** `src/builder-package.js:8-94` + `src/builder-install.js:117-253`
**Test analog:** `test/builder-packed-install.test.js:91-202,288-330`

当前 release loader 已经具备正确骨架：固定资产清单、no-follow bounded read、逐资产 digest、由资产清单生成 release digest。安装侧把这些资产转为 managed files，并让 receipt 最后发布：

```js
// src/builder-package.js:47-59,77-94
for (const relativePath of BUILDER_PLUGIN_FILES) {
  const bytes = await readBoundedNoFollowFile(/* fixed package path */);
  assets.push({ relativePath, sourcePath, digest, byteLength, bytes });
}
// releaseDigest binds sourcePath + digest + byteLength

// src/builder-install.js:53-73
for (const desired of prepared.allFiles) stageDesiredFile(/* ... */);
for (const nonReceipt of staged.filter(/* ... */)) publishStagedFile(/* ... */);
for (const desired of prepared.managedFiles) assertInstalledDigest(/* ... */);
publish receipt last;
```

把同一模式扩展到 runtime，不要制造另一个 package/version：

- release asset descriptor 应明确区分 `sourcePath` 与 plugin 内 `relativePath`；例如 packed `bin/agentmo.js` 投射到 `runtime/agentmo/bin/agentmo.js`。
- runtime inventory 必须是固定、排序、可 hash 的清单，至少包含 `package.json`、`bin/agentmo.js` 和 `src/cli.js` 的完整本地 import closure。禁止运行时递归复制任意 package 目录。
- runtime bytes 与 plugin bytes共同进入 `releaseBasis.assets`、install plan、marker、receipt 和每路径 ownership。
- skill 调用 project projection；hook 调用 `${PLUGIN_ROOT}` 内同一 runtime projection。两者都不依赖 PATH、npm cache 或源码 checkout。
- receipt exact-shape validators 分布在 install、doctor、lifecycle。若 receipt 增加 host activation binding 或资产契约改变，应显式 bump/迁移 schema，并同步三个 validator；不能让旧 `status: installed` 被静默重新解释。

安装 apply 的最小正确顺序：

1. 重算并匹配 preview digest；
2. stage/publish/revalidate 所有 project-owned bytes；
3. 经唯一 host adapter 执行 preview 中声明的官方 activation operation；
4. 重新只读观察 `installed/enabled/skill/hooks/trust`；
5. 只有要求的 activation 状态成立才发布 receipt；trust 仍未批准时明确返回 `activation-pending-trust`，不得伪报行为就绪；
6. receipt publish 后再次检查 project bytes 与 normalized host state。

`test/builder-packed-install.test.js` 应从 packed npm tarball 验证：

- project runtime bytes 与 packed source exact-equal，receipt 覆盖每个 runtime path；
- 在空 cwd、无全局 `agentmo` 的 PATH 下，`node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js builder ...` 可运行；
- preview 不调用 mutating host operation；apply 只调用固定 official operation；
- activation failure 不发布成功 receipt；
- setup 后 normalized host state 不再是仅 marketplace discovered。

### 2. Official host lifecycle uses the same plan/revalidate discipline

**Primary analog:** `src/builder-lifecycle.js:176-380,383-525,626-669,757-871`
**Test analog:** `test/builder-lifecycle.test.js:88-154,301-399,523-564`

现有 lifecycle 已提供最强的 mutation pattern：

- externally admitted current receipt digest (`62-70`, `383-411`);
- installed/current/desired 三方分类 (`261-292`);
- blockers 与 exact preview digest (`294-380`);
- 每次 mutation 前重验 receipt/checkpoint/shared/unknown state (`90-150`, `633-669`);
- quarantine retained identity + no-clobber publication (`687-871`);
- receipt 最后 replacement/deletion。

应用到 gap 时：

- runtime launcher/core 文件只是新的 `exclusive-plugin-file`（或一个单义的新 exclusive ownership），自动继承 modified/hardlink/symlink/race 防护；不要为 launcher 写第二套 updater。
- `EXPECTED_FILES`、receipt validator、unknown plugin inventory 必须从同一 canonical asset inventory 派生，避免 install/doctor/lifecycle 三份手写列表漂移。
- host activation 是计划中的独立 operation，不是 filesystem ownership。它只能经 `builder-codex-host.js` 调用 official install/remove/update surface，绝不读取或删除 Codex cache 路径。
- upgrade/uninstall 在 receipt terminal mutation 前验证 host operation 的结果；失败时保留旧 receipt，报告 recoverable partial state，不能返回 `upgraded/uninstalled`。
- hook trust 是人的 host approval，不得由 lifecycle 绕过；upgrade 后 hash 改变导致 `untrusted` 时要明确降级并等待批准。
- normalized host selector、observed version/state digest可以进入 receipt/plan evidence；不得记录 HOME、CODEX_HOME、raw stdout/stderr 或 trust database bytes。

需要补的 hostile tests：

- runtime file modified/hardlinked/swapped after compare 时，upgrade/uninstall 与现有 plugin files 一样失败关闭；
- host install/remove 报错或 post-observation 不匹配时 receipt 不进入 terminal 状态；
- caller 不能注入任意 host argv、cache path、claimed `enabled/trusted` 状态；
- shared/unknown project content 与 host-owned cache 均不被直接删除。

### 3. Fixed host observation, normalized truth, read-only doctor

**Primary analog:** `src/builder-probe.js:9-108,144-194` + `src/builder-doctor.js:41-170,358-410`
**Test analog:** `test/codex-builder-probe.test.js:24-79` + `test/builder-doctor.test.js:72-139`

`probeBuilderAdapter` 的模式应直接复用：command/method allowlist 固定、`shell:false`、timeout/maxBuffer 有界、raw output 只在模块内解析、对外只返回 normalized evidence。新的 host adapter 不应扩大 capability probe 的含义；probe 回答“host surface 是否存在”，host observation 回答“AgentMo 当前是否 installed/enabled/visible/trusted”。

建议唯一 normalized host observation 至少包含：

```text
marketplace: discovered | missing | inconsistent
plugin: installed | not-installed | inconsistent
enabled: true | false | unknown
skill: visible | missing | unknown
hooks: visible | missing | unknown
hookTrust: trusted | untrusted | unknown
observationLevel: observed | unavailable
mutatesHost: false
```

规则：

- 通过当前 Codex official CLI/App Server 的固定 read-only surface 获取这些事实；不要根据 project files 推断 installed/enabled。
- mutation executor 与 observer 可以同文件但必须是不同 exported functions；doctor 只能拿到 observer。
- doctor 继续做 before/after project tree equality 与 `mutatesHost:false`；输出不能含 project absolute path、raw host output 或 secret-like values。
- `status: declared` 只表示 receipt-owned projection pristine。新的总体状态应能表达 projected、installed-disabled、enabled-untrusted、active-trusted、inconsistent。
- trust 未批准时 remediation 是明确的人类动作；doctor 不 repair、不 auto-trust。

### 4. Host hook bridge reuses canonical event + checkpoint CAS

**Primary analog:** `src/builder-events.js:48-181,184-251,419-434` + `src/builder-checkpoint.js:103-145,311-347`
**Controller analog:** `src/cli.js:195-220`
**Test analog:** `test/builder-hook.test.js:49-118,206-236`

当前 reducer 已经满足核心安全属性：

- event exact keys、origin/type restrictions、canonical digest admission；
- workflow/adapter scope match；
- duplicate ID 必须绑定相同 sequence + exact event digest；
- cursor gap fail-closed、旧 sequence stale no-op；
- hook 事件只改变 resume/compaction boundary，announcement/proposal 不审批、不推进；
- checkpoint writer 用 expected previous digest + lock 做 CAS。

因此 bridge 只负责适配，不能复制 reducer。最小 bridge 数据流：

1. hook runner 保持当前 64 KiB stdin 上限，只接收 `SessionStart|PreCompact|PostCompact`；non-trigger 直接零输出且不启动 launcher；
2. 通过 hooks registration 把 `${PLUGIN_ROOT}/runtime/agentmo/bin/agentmo.js` 的精确路径交给 hook runner，runner 用 `process.execPath` 启动，不调用裸 `agentmo`；
3. launcher 的内部 hook route 以当前 project root 为唯一 scope，先 exact-admit receipt，再 stable-read checkpoint 并计算其当前 digest；
4. 从 host payload 的固定、非 secret 字段生成 bounded canonical identity；host payload不得提供 workflowId、stage、nextAction、sequence 或 checkpoint digest；
5. 若 event ID 已在 checkpoint ledger，复用其原 sequence/digest 走 duplicate no-op；否则使用 `cursor + 1` 构造 `origin: hook` event；
6. 调用 `reduceBuilderHookEvent`，再用原 checkpoint digest 调 `writeBuilderCheckpoint(... expectedPreviousDigest)`；并发投递由 CAS 拒绝，不能 last-write-wins；
7. hook runner 仅把 bounded announcement/proposal 映射为 Codex hook JSON。PreCompact 成功后可输出 `{}`；SessionStart/PostCompact 可给恢复提示。任何失败都不得输出 raw child stderr 或 payload。

事件 identity 不能读取或持久化 `transcript_path` 内容。若当前 official payload 没有足以区分多次合法 PreCompact 的稳定 delivery identity，bridge 必须把该情况报告为 unsupported/degraded，而不是用时间戳制造无法去重的 ID。

Focused tests 应覆盖真实 installed path，而非直接调用 reducer：

- installed hook -> installed runtime launcher -> checkpoint CAS 的端到端 child process；
- SessionStart / PreCompact / PostCompact 与 non-trigger；
- 同一 payload 在磁盘 reload 后 duplicate no-op；
- concurrent same/different delivery 只有一个 CAS winner；
- absent/corrupt/wrong-receipt checkpoint fail-closed，且无 raw payload/secret/transcript 泄漏；
- stage、pending approval 与 nextAction 从不被 hook 自动改变。

### 5. Evidence binding stays honest while moving from mechanism to host behavior

**Primary analog:** `src/builder-behavior-eval.js:71-180,183-373`
**Test analog:** `test/codex-builder-behavior.test.js:105-210`

当前 evaluator 的可保留部分很强：

- 在任何 host probe 前 admit exact receipt，并拒绝 modified managed files (`71-79`);
- isolation temp cwd 与最小 child env (`81-93`, `356-419`);
- release/receipt/host-observation/scenario/result 五项 digest binding (`95-176`);
- caller 不能注入 doctor/scenario/result/observation claims；
- 输出不含 repo/package absolute path、secret canary、`NODE_OPTIONS`/`NODE_PATH` canary。

需要替换的只是 observation source：删除“standalone hook output + separately synthesized CLI event”作为 host behavior 的组合。场景必须穿过 Pattern 4 的 installed hook bridge；host activation/trust/visibility 由 Pattern 3 的 observer提供。

证据升级规则：

- deterministic packed test：`basis: fresh-process-mechanism`，`codexActivationVerified:false`、`hostBehaviorVerified:false`；
- isolated real Codex session 且 plugin installed/enabled、skill/hooks visible、hook trusted、host-delivered scenarios 全部观察成功：才允许 `basis: real-codex-session` 与两个 verified flag 为 true；
- 两种报告都继续保持 `agentPackageQualityCertified:false`、`domainQualityCertified:false`、`productionApproved:false`。

真实 UAT 最少覆盖：新会话 skill discovery、SessionStart trigger、UserPromptSubmit non-trigger、manual pause、PreCompact flush、PostCompact resume proposal、session restart/resume、duplicate delivery no-op，以及 upgrade/uninstall 后 visibility 变化。该 UAT 必须绑定 release digest、receipt digest、normalized host observation digest、scenario digest 与 result digest。

## Recommended implementation order

按一个窄纵向切片推进，不再增加架构文档：

1. **Runtime + activation:** `builder-package/install/codex-host/doctor/skill`，先让 packed clean project 在无全局 PATH 下可调用，并让 Codex 显式 installed/enabled。
2. **Lifecycle parity:** 让同一 runtime inventory 与 official host operations 通过现有 upgrade/uninstall safety gate。
3. **Hook bridge:** 接通 installed hook -> installed launcher -> event reducer -> checkpoint CAS。
4. **Evidence gate:** 先跑 packed/fake-host focused tests，再跑 isolated trusted real-Codex UAT；只有真实 observation 通过才关闭 `BLDR-01` / `BLDR-07`。

## Focused verification matrix

| Goal | Primary tests |
| --- | --- |
| packed runtime + no global PATH | `test/builder-packed-install.test.js`, `test/builder-cli.test.js` |
| fixed official host calls + normalized observation | new `test/builder-codex-host.test.js`, `test/codex-builder-probe.test.js` |
| doctor remains read-only and truthful | `test/builder-doctor.test.js` |
| runtime ownership and host lifecycle | `test/builder-lifecycle.test.js` |
| host hook reaches CAS reducer | new `test/builder-hook-bridge.test.js`, `test/builder-hook.test.js`, `test/builder-checkpoint.test.js` |
| packed mechanism evidence boundaries | `test/codex-builder-behavior.test.js` |
| static I/O closure | inventory test using `test/helpers/io-surface-inventory.js` |
| final gate | `npm run check`, `git diff --check`, then isolated real-Codex UAT |

## Anti-patterns to reject during implementation

- 继续让 skill 或 hook 调用裸 `agentmo`。
- 只把 marketplace 写到项目就返回 `status: installed`。
- 通过文件存在性推断 Codex plugin installed/enabled 或 hooks trusted。
- 直接写/删 Codex cache、config 或 trust database。
- 让 hook 自己实现 checkpoint writer/reducer，或接收 host 提供的 stage/sequence/digest。
- 用时间戳/随机数作为重复投递 identity，然后声称 dedup 已验证。
- 把 fake Codex、standalone hook 或 synthetic event 升级为 real host behavior evidence。
- 为补 gap 重写中立 adapter、Builder entry 或三阶段状态机。

---

## PATTERN MAPPING COMPLETE
