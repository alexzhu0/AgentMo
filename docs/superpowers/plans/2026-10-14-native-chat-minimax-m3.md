# Native chat MiniMax M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 支持已确认的国内按量MiniMax-M3，贯穿正式工件、预算代理、SDK和原生验收来源；完成离线验证后交付真实创建/运行所需的精确预览。

**Architecture:** 复用现有native-chat生命周期与共享预算，只增加仓库固定的minimax-m3-cn-v1选择。缺省仍为原DeepSeek且旧工件字节不变；新选择显式绑定来源、Package、计划、回执和观察，不信任环境或CLI自述。

**Tech Stack:** Node标准库、已有Artifact admission/Package/预算实现、OpenClaw 2026.9.4；不添加依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-native-chat-minimax-m3-design.md`，原字节sha256:fde7dfedb3e1f460bb6361b5c01b0b2f79da52f275edb310052e61b5f085515d。

## Global Constraints

- 用户2026-10-14要求“继续完成未完成的事情”；继续本机离线实现，保留既有单一实现者与最终独立审阅。
- 不提交或push；不修改/清理旧私有证据、会话、claim或账本，不读取.env内容。
- 国内按量；变量MINIMAX_API_KEY；固定MiniMax-M3；上游https://api.minimax.cn/v1/chat/completions。
- thinking disabled、max_completion_tokens=2048、n=1、standard；无工具、自动retry、fallback。
- 48KiB请求、32条历史、8000 Unicode码点、31分预留、原累计CNY100账本。
- 新真实运行根/批准存储初始化、Discover/Plan/Produce及安装/激活/付费须当时具体预览授权；本计划不伪造这些批准。
- Node20信任策略不改；新收据必须空缺路径生产成功后发布原字节，再消费。

## Review Focus

- 缺省与显式null/未知profile不同：前者保留DeepSeek，后者在副作用前拒绝。Task1测试。
- M3来源拼接旧Blueprint/Package/计划/回执不能借用旧批准。Tasks1–2测试。
- SDK真实M3 wire可能缺thinking或带特有参数：仅补固定disabled，拒绝扩大权限，SDK加模拟上游验证。Task2测试。
- 错误对象可能携密钥/body：只保留控制侧枚举与数字HTTP状态。Task2负例。
- 包发布/Node20库存漏列新模块会让本机测试假绿：真实打包导入、producer/consumer和全套检查。Task3测试。

---

### Task 1: 固定配置与正式来源传播

**Files:** Create `src/native-chat-model-profile.js`, `test/native-chat-minimax.test.js`; Modify `src/user-need.js`, `src/design-plan.js`, `src/blueprint-draft.js`, `src/blueprint.js`, `src/build-contract.js`, `src/artifact-contract.js`, `src/targets/openclaw-package.js`; existing Stage2 fixtures/tests as needed.

**Interfaces:** `nativeChatModelProfile(id?) -> frozen fixed configuration`; only omitted id and minimax-m3-cn-v1 accepted. Configuration has provider/model/nativeModel/endpoint/envName/label/responseModels/outputLimitKey. `native_model_profile` is optional on native Need/Plan/Blueprint; `specification.runtimeBinding.modelProfile` only present for M3. Old outputs omit all new fields.

- [x] Add failing authentic Stage2 test: Need→Design Plan→Blueprint→Build Contract retains minimax-m3-cn-v1/MiniMax-M3; non-native/null/unknown and mismatched Plan/Blueprint reject.
- [x] Run `node --test test/native-chat-minimax.test.js`; expected new behavior fails before implementation.
- [x] Add fixed resolver and profile validation/copying; make native specification/resource/projection match the selection and preserve absent-profile output bytes.
- [x] Run new test plus `test/design-plan.test.js`, `test/blueprint-draft.test.js`, `test/build-contract.test.js`, `test/package-produce.test.js`; expected zero failures.
- [x] Record evidence and progress; do not commit.

### Task 2: 精确生命周期、预算与真实SDK合成集成

**Files:** Modify `src/openclaw-install-plan.js`, `src/native-chat-install-cli.js`, `src/native-chat-cli.js`, `src/native-chat-runtime.js`, `src/native-chat-proxy.js`, `src/course-wiki-budget.js`, `src/openclaw-probe.js`, `src/behavior-evidence.js`, `src/delivery-report.js`; tests/fixtures in `test/native-chat-minimax.test.js`, `test/native-chat-proxy.test.js`, `test/helpers/native-chat-fixture.js`, existing install/runtime/acceptance tests.

**Interfaces:** `nativeBinding.modelProfile?` is digest-bound; `validateNativeChatRequest(value, modelProfile?)` and `validateCourseBudgetRequest(value, modelProfile?)` use Task1 resolver. `sendBudgetedCompletion({...existing, modelProfile?})` uses fixed endpoint/model and preserves default DeepSeek. Probe carries selected profile internally; runtime derives actual configuration from admitted archive and checks requested binding before consumption. Acceptance.model must match Blueprint/Package/nativeBinding.

- [x] Write failing M3 proxy test: one fixed domestic request, disabled thinking/standard/2048 output, one persistent claim and31fen; repeated request or wrong profile/model/priority/unknown structure cannot pay.
- [x] Write failing source mismatch and lifecycle-action tests; M3 plan uses MINIMAX_API_KEY and correct endpoint, archive mismatch rejects before nonce consumption/token/control.
- [x] Write failing bounded error test: upstream401 preserved only as numeric status and enum; provider body/raw error/token absent, no retry/refund.
- [x] Run focused tests to observe each new failure, then implement through existing shared helpers, not parallel budget storage or generic endpoint overrides.
- [x] Extend disposable fixture to take modelProfile, and run actual installed SDK M3 registration, chat, failure and restart against a mocked upstream with synthetic credentials. Expected exact provider/minimax model, one budget reservation, no tools or duplicate attempt; never use real.env.
- [x] Run native install/runtime/proxy/acceptance plus legacyCourse Wiki budget tests and Stage2/support-triage set from MVP_RUNBOOK. Expected zero failures; explicit platform skips separately counted.
- [x] Record evidence and progress; do not commit.

### Task 3: 发布闭包、整批审阅与精确创建预览

**Files:** Modify `package.json`, `src/builder-package.js`, `scripts/node20-core-receipt.js`, `test/helpers/io-surface-inventory.js`, inventory assertions and maintained docs as needed; new dated release/evidence. Create M3 Need/Discover preview only after code supports it; preserve old snapshots.

**Interfaces:** New profile module is repository-owned runtime asset and Node20 syntax input; consumers stay outside producer. New M3 preview uses actual Need/manifest/DB, target descriptor and current budget, with unknown future approval/receipt identities explicitly pending.

- [x] Add/update exact inventory regression; run to observe missing profile asset/syntax ownership before adding it to owned lists.
- [x] Run packed import/security/inventory and post-publication consumer tests; expected imported module closure and no unexpected assets.
- [x] Freeze final source/test bytes; request independent whole-batch correctness and complexity review. Fix verified important issues with failing regressions before repeating affected checks.
- [x] Run Node20 producer using repository-owned trust and an absent receipt, publish exact successful bytes, then consumers; record new counts/digests without altering trust anchor.
- [x] Run `npm run check` once to natural completion under existing single-flight supervisor; record each lane and exit status. Never delete a lock or claim an interrupted result passed.
- [x] Run `git diff --check`; confirm source freeze, SDK target, budget and old runtime state are intact.
- [x] Prepare genuine M3 Discover/enter-plan preview with existing source gaps; next Plan/Produce/install/activate/paid artifacts remain dependent on their corresponding user approvals.
- [x] Update current status/release and show concrete pending preview; retain all work and private evidence without commit/push.

## Self-review

Tasks1–2 cover fixed configuration/source propagation, legacy compatibility, package/profile admission, lifecycle authority, proxy/fee/diagnostic boundaries and SDK protocol. Task3 covers closure/trust/full verification/independent review and genuine next preview. Real lifecycle and nineteen semantic/boundary observations remain separately gated; no local synthetic result is a domain or production certificate.

## Additional review correction

A rehashed M3 resource could retain DS planning digests and use a genuine new probe plus new installation decisions through the direct API. New installation decisions do not replace M3 Plan approval. Shared lifecycle preflight now requires actual `blueprintAdmission` and `buildContractAdmission`, verifies provenance/digests/selected model/resource declaration before consumption, and callers must forward these admissions. No legacy artifact bytes change. A genuinely rehashed/reprobed negative test and missing/cloned activation source tests must pass before final review/freeze/full verification. First five-lane run completed on the earlier source; final source requires a fresh run and Node20 receipt.
