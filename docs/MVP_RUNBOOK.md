# AgentMo MVP Runbook

This runbook executes the support-triage MVP as a composed vertical demo of AgentMo's three artifact contracts. It is not the only valid AgentMo path.

```text
Stage 1 Discover -> Discovery Contract
Stage 2 Plan     -> Agent Design / Blueprint Contract
Stage 3 Produce  -> Delivery Evidence Contract
```

Stage 1 has three distinct lanes. `discover-pack` materializes declarations without reading sources, `discover-workspace` reads approved repository-local files, and `discover-live` retrieves only exact-admitted HTTPS locations inside the manifest's fixed allowlist through closed Web, GitHub REST, or arXiv metadata policies. It is not a generic crawler, browser-automation surface, or open search interface.

For live sources, `source_inventory[].evidence_class` is a closed role classification: `primary`, `first-party`, `context`, or `community`. Web and GitHub preserve the explicit role; arXiv is `primary` only; approved local intake remains `approved-local`. Evidence class is independent from `trust_level`, retrieval success, and `confidence`, so a community source declared `verified` still yields unverified live evidence. Multiple arXiv sources are serialized with an enforced 3000 ms minimum request-start interval that counts against `aggregateTimeoutMs`.

Build, install/doctor, runtime smoke, birth, eval, delivery, and release evidence are Produce-internal gates. These artifacts do not certify one another, domain-wide quality, production readiness, or deployment approval.

AgentMo core supports Node.js `>=20`; OpenClaw target mutation separately requires `>=22.19.0 <23 || >=23.11.0`. The authoritative operator preflight is `node ./bin/agentmo.js runtime-check --target openclaw`, and it must precede mutation without a copied range predicate.

## Contract architecture

- **Stage 1 Discover** has three paths: `discover-pack` is manifest-only, `discover-workspace` is approved local source intake, and `discover-live` is exact allowlist-bound public HTTPS intake. All produce a valid discovery DB; workspace/live intake also writes bounded sanitized source sidecars, and live intake adds `retrievals.jsonl` without raw provider bodies.
- **Stage 2 Plan** consumes an exact manifest/database `agentmo.discovery-approval.v1`, `agentmo.user-need.v1`, and the exact current `agentmo.decision-ledger.v1` head. It produces `agentmo.design-plan.v1`, drafts a non-authoritative blueprint, emits the complete `agentmo.build-contract.v1`, and requires a separate exact blueprint/contract `agentmo.plan-approval.v1` before Produce.
- **Stage 3 Produce** consumes any valid blueprint/design contract and produces delivery evidence: `agentmo.handoff.v1`, `agentmo.build.v1`, `agentmo.run.v1`, `agentmo.run-eval.v1`, `agentmo.birth-report.v1`, `agentmo.domain-eval.v1`, and `agentmo.delivery.v1`.

Stage 3 may start from an externally reviewed or business-provided valid blueprint/design contract when bounded provenance records the source, reviewed status, review reference, contract version, and non-secret notes. That provenance admits the design to Stage 3; it does not certify runtime behavior, domain-wide quality, production readiness, or deployment approval. If generated handoff wording names discovery pack or user-need artifacts, read those as provenance/review references for AgentMo-generated designs, not as mandatory command ancestry for externally reviewed designs.

See `docs/STAGE_CONTRACTS.md` for the full contract matrix.

## Phase 3 approved research-to-build-contract lane

The public sequence and durable authority are:

```text
discover-live <manifest> --digest discovery-manifest=<exact> --out <absent-dir>
discovery-approve <manifest> --discovery-db <db> --digest discovery-manifest=<exact> --digest discovery-db=<exact>
discovery-approve <manifest> --discovery-db <db> --digest discovery-manifest=<exact> --digest discovery-db=<exact> --approve --preview-digest <exact-preview> --out <approval>
decision-ledger append --journal <ledger> --entry <entry> --digest decision-entry=<exact> [--expected-head-sha256 <exact-head>]
design-plan <db> --manifest <manifest> --discovery-approval <approval> --need <need> --decision-ledger <ledger> --digest discovery-manifest=<exact> --digest discovery-db=<exact> --digest discovery-approval=<exact> --digest user-need=<exact> --digest decision-ledger=<exact-head> --out <plan> --target openclaw
blueprint-draft <db> --need <need> --design-plan <plan> --digest discovery-db=<exact> --digest user-need=<exact> --digest design-plan=<exact> --out <blueprint> --target openclaw
openclaw-fs-kernel-build --binary-out <absent-private-helper> --receipt-out <absent-private-receipt>
openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=<exact> --digest target-package-json=<exact> --digest target-build-info=<exact> --fs-helper <helper> --fs-helper-receipt <helper-receipt> --fs-helper-receipt-digest <exact> --out <descriptor>
build-contract <blueprint> --design-plan <plan> --discovery-approval <approval> --decision-ledger <ledger> --target-descriptor <descriptor> --digest blueprint=<exact> --digest design-plan=<exact> --digest discovery-approval=<exact> --digest decision-ledger=<exact-head> --digest openclaw-target-descriptor=<exact> --out <contract> --target openclaw
plan-approve <blueprint> --build-contract <contract> --digest blueprint=<exact> --digest build-contract=<exact>
plan-approve <blueprint> --build-contract <contract> --digest blueprint=<exact> --digest build-contract=<exact> --approve --preview-digest <exact-preview> --out <plan-approval>
```

Every command can start in a fresh process from those supplied exact files. `discovery-approve` and `plan-approve` previews write nothing; apply requires the exact preview digest and publishes to an absent output. Changing any admitted manifest, DB, approval, need, ledger, plan, blueprint, or contract invalidates the next transition and creates no successor.

Decision entries use only `fact`, `inference`, `unknown`, `rejected-option`, or `human-decision`. The build contract binds one exact, data-produced OpenClaw target descriptor and all 22 prompt/workspace/skill/tool/policy/plugin/memory/RAG/storage/schedule/harness/loop/runtime/permission/trust/secret/transition/recovery/acceptance/evidence resource families. A target change requires a new descriptor and exact approval rather than a code change. Phase 3 specifies and approves; Phase 4 generates and performs separately authorized installation/loading; Phase 5 executes and proves runtime/recovery.

`extraction_field` is declaration-only. Mechanical deduplication, freshness, conflict candidates, and coverage are not semantic proof. Collection and explicit local approval do not establish authenticated organizational identity. An approved build contract authorizes entry to Produce only. Collection, blueprint drafting, build-contract closure, `declared-ready`, and a bounded live smoke do not certify source quality, package quality, runtime behavior, domain quality, production readiness, or deployment approval.

### Separately labelled bounded public HTTPS smoke

Task 3 is a human verification gate, not part of automated tests. Use one fixed public HTTPS URL already present in an inspected `agentmo.discovery.v1` allowlist, `maxSources: 1`, conservative byte/time/redirect bounds, a new absent output root, and no credential-bearing headers. Run `discover-live` with the exact manifest digest, then inspect only the canonical record fields: requested/final canonical URL, retrieval time, raw-byte content digest, sanitized bounded summary, provider provenance, evidence class, confidence rationale, and original reference.

Do not retain the provider body, raw stdout/stderr, credentials, or transcript. Independently inspect the exact manifest/DB pair before discovery approval and the exact blueprint/build-contract pair before plan approval. Mutate copies to confirm both approvals fail closed. Record only bounded status/digests and remaining risks in release evidence. This smoke proves current bounded transport execution and local operator intent only.

## Phase 4 deterministic Agent Package and OpenClaw lifecycle

Phase 4 is a bounded Produce sub-contract. The canonical directory is
deterministic build authority; the D-42 archive is the only probe, preview,
approval, and apply transport. A directory path or standalone manifest must
never be passed as install input.

The operator-visible closure of D-32..D-42 is:

| Decision | Enforced behavior |
| --- | --- |
| D-32..D-34 | Produce emits executable prompts, workspace content, skills, tool bindings, typed hooks, memory policy, evals, and one target-neutral canonical manifest plus a complete OpenClaw projection. Least-trust workspace/content/skill carriers are preferred; the approved typed-hook need uses a native plugin and this package has no MCP carrier. |
| D-35..D-37 | The default target is an isolated project root. Managed writes, every sensitive action, and the complete exact conflict set are three non-interchangeable approval families; scope, bytes, target, action, or conflict drift invalidates authority. |
| D-38..D-39 | Credential values stay inside the closed official OpenClaw route. Failure preserves unknown, modified, external, ambiguous, and reopened published objects and reports incomplete recovery work instead of destructive cleanup. |
| D-40..D-42 | Directory/archive inspection has stable human and JSON views. Probe binds a complete fresh capability fingerprint. Only the deterministic, externally digest-bound D-42 archive is admitted downstream, with strict recursive member closure and no-follow identity revalidation. |

The 2026-07-31 noncanonical pre-verification audit is retained as historical
evidence: it reported Critical 3 / Warning 0 after an earlier eight-Critical /
two-Warning remediation pass. The
`7c902af59b5705de5ca31e83561adeaaeeed130f` candidate addresses those three
findings with an exact external authority-root binding, preserved named config
candidates with path/FD identity checks, and a Linux native subreaper/pidfd
supervisor with terminal-slot recycling, pre-exec pidfd/clock handshake, x32
rejection, and an inherited group/signal/ptrace lock. Non-Linux
official process execution rejects before spawn. Prior Phase 4 install plans,
approvals, and receipts do not bind the new root authority and must be regenerated
and explicitly reapproved. A second fresh re-audit found a supervisor
capacity/pidfd gap and stale contract text. A third re-audit then found
supervisor-signal, bootstrap-failure, and x32 gaps. That candidate adds
their targeted implementation and Linux-only regressions. The latest completed
aggregate attempt reached main 956 pass / 0 fail / 10 skip and
packed hook 1/1; after its one load-sensitive hook replay failure received a
test-first bounded timeout fix, packed behavior passes 8/8. The Ubuntu 24.04 /
Node 20.20.2 native supervisor job for that exact candidate completed
successfully in GitHub Actions run `30781382363`, job `91586558379`. This
proves only the bounded Linux containment and credential regressions in the
workflow; the exact-candidate full-project job and a new independent
zero-blocker audit remain required. It is not a Phase 4 passed or
production-ready claim.

The selected support-triage package closure is:

| Subject | Exact value |
| --- | --- |
| D-42 external SHA-256 | `sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f` |
| package manifest SHA-256 | `sha256:af98b46e5d5a6e46db7c7b020fea51115bae0829d943583ce9d756ce1d1c45` |
| canonical inventory SHA-256 | `sha256:d6be393fc176c9f28811e9e8771fae7cff5efb81a824697a6300ae80466c32a5` |
| member closure | 40 portable regular files with exact mode, byte length, and SHA-256 |
| target/carrier admission SHA-256 | `sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6` |
| target descriptor SHA-256 | `sha256:0abad669ae3cac7b6219737a728df21799eeec6ac7946e8fd38285f9e4322bee` |
| exact target | OpenClaw `2026.7.1-2@0790d9f` |

These values identify the repository Phase 4 fixture only. They are not a
substitute for recomputing external SHA-256 values from the exact files used by
an operator. A target byte, version, revision, target-root closure, or
carrier-recipe mismatch invalidates the old descriptor, build contract, plan
approval, target/carrier admission, probe, and lifecycle authorities. An
install approval cannot make a mismatched target valid.

### Produce and inspect

Build the repository-owned retained-dirfd helper before any current public
publisher. The npm tarball contains only the auditable C source and JavaScript
facade; it contains no compiled helper, helper receipt, authority state, npm
lifecycle compiler hook, or downloaded binary.

```text
node ./bin/agentmo.js openclaw-fs-kernel-build \
  --binary-out "$FS_HELPER" \
  --receipt-out "$FS_HELPER_RECEIPT" \
  --json
FS_HELPER_RECEIPT_DIGEST="$(digest_file "$FS_HELPER_RECEIPT")"
```

The build uses fixed `/usr/bin/cc`, fixed argv, `shell:false`, a closed
environment descriptor, and absent private output paths. Every publisher
re-admits the exact helper path, durable build receipt, caller-supplied external
receipt digest, repository source digest, compiler/toolchain fingerprint, argv,
environment descriptor, binary digest, mode, and retained identities. There is
no auto-build, PATH lookup, prebuilt fallback, or JavaScript mutation fallback.
The two public outputs form one recoverable pair: a partial or failed build
returns closed per-member disposition, identity, digest, parent binding, and
failure-point evidence, and a later invocation can admit only the exact pair.

The current target descriptor publisher uses the same tuple, and after exact
build-contract/plan approval the carrier admission is published explicitly:

```text
node ./bin/agentmo.js openclaw-target-admit "$BLUEPRINT" \
  --build-contract "$BUILD_CONTRACT" \
  --plan-approval "$PLAN_APPROVAL" \
  --target-descriptor "$TARGET_DESCRIPTOR" \
  --target-executable "$OPENCLAW_EXECUTABLE" \
  --target-package-json "$OPENCLAW_PACKAGE_JSON" \
  --target-build-info "$OPENCLAW_BUILD_INFO" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-contract=$(digest_file "$BUILD_CONTRACT")" \
  --digest "plan-approval=$(digest_file "$PLAN_APPROVAL")" \
  --digest "openclaw-target-descriptor=$(digest_file "$TARGET_DESCRIPTOR")" \
  --digest "target-executable=$(digest_file "$OPENCLAW_EXECUTABLE")" \
  --digest "target-package-json=$(digest_file "$OPENCLAW_PACKAGE_JSON")" \
  --digest "target-build-info=$(digest_file "$OPENCLAW_BUILD_INFO")" \
  --fs-helper "$FS_HELPER" \
  --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --out "$TARGET_CARRIER_ADMISSION" \
  --json
```

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }

node ./bin/agentmo.js package-produce "$BLUEPRINT" \
  --design-plan "$DESIGN_PLAN" \
  --discovery-approval "$DISCOVERY_APPROVAL" \
  --decision-ledger "$DECISION_LEDGER" \
  --build-contract "$BUILD_CONTRACT" \
  --plan-approval "$PLAN_APPROVAL" \
  --target-descriptor "$TARGET_DESCRIPTOR" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "design-plan=$(digest_file "$DESIGN_PLAN")" \
  --digest "discovery-approval=$(digest_file "$DISCOVERY_APPROVAL")" \
  --digest "decision-ledger=$(digest_file "$DECISION_LEDGER")" \
  --digest "build-contract=$(digest_file "$BUILD_CONTRACT")" \
  --digest "plan-approval=$(digest_file "$PLAN_APPROVAL")" \
  --digest "openclaw-target-descriptor=$(digest_file "$TARGET_DESCRIPTOR")" \
  --digest "openclaw-target-carrier-admission=$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --fs-helper "$FS_HELPER" \
  --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --out "$PACKAGE_DIRECTORY" \
  --archive "$PACKAGE_ARCHIVE" \
  --json

node ./bin/agentmo.js package-inspect "$PACKAGE_DIRECTORY" \
  --manifest-sha256 "$(digest_file "$PACKAGE_DIRECTORY/agentmo.package.json")" \
  --json
node ./bin/agentmo.js package-inspect "$PACKAGE_ARCHIVE" \
  --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --json
```

`package-produce` publishes only new absent outputs. It materializes the native
plugin solely from the exact Phase 3-reapproved inline recipe and emits no MCP
carrier. Directory inspection verifies build authority; archive inspection
verifies the external archive digest, internal manifest and inventory digests,
and the complete member closure without installing or loading anything.

### Read-only exact-target probe

```text
node ./bin/agentmo.js openclaw-probe \
  --archive "$PACKAGE_ARCHIVE" \
  --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --blueprint "$BLUEPRINT" \
  --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" \
  --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" \
  --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" \
  --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --target-descriptor "$TARGET_DESCRIPTOR" \
  --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --target-root "$ISOLATED_OPENCLAW_TARGET_ROOT" \
  --out "$PROBE" \
  --json
```

The probe uses retained no-follow reads and fixed `shell:false` observations in
a disposable synthetic HOME/state/config/workspace with a closed non-secret
environment. It does not use an operator's live OpenClaw HOME and does not load
a plugin, connect MCP, use credentials, invoke an agent, or trigger a schedule.
The blueprint, build contract, plan approval, target carrier admission, target
descriptor, and D-42 archive form one exact companion closure; the probe cannot
use its own embedded digests to authenticate that closure.

### Genesis and four lifecycle previews

Create verified absent-genesis authority only for an install into an exact
absent target:

```text
node ./bin/agentmo.js openclaw-install-genesis \
  --archive "$PACKAGE_ARCHIVE" \
  --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --blueprint "$BLUEPRINT" \
  --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" \
  --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" \
  --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" \
  --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --target-descriptor "$TARGET_DESCRIPTOR" \
  --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --probe "$PROBE" \
  --probe-sha256 "$(digest_file "$PROBE")" \
  --request "$GENESIS_REQUEST" \
  --request-sha256 "$(digest_file "$GENESIS_REQUEST")" \
  --target-root "$ISOLATED_PROJECT_ROOT" \
  --fs-helper "$FS_HELPER" \
  --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --out "$ABSENT_GENESIS" \
  --json
```

Genesis and every preview re-admit the same exact companion closure used by the
probe. The package manifest is admitted from the already validated D-42 bytes,
so no second pathname read can substitute it. Every preview carries that
deterministic archive and its external digest. The lifecycle basis is mutually
exclusive:

```text
# install: verified absent genesis
node ./bin/agentmo.js openclaw-install-preview --lifecycle install \
  --archive "$PACKAGE_ARCHIVE" --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --blueprint "$BLUEPRINT" --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --target-descriptor "$TARGET_DESCRIPTOR" --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --probe "$PROBE" --probe-sha256 "$(digest_file "$PROBE")" \
  --request "$PREVIEW_REQUEST" --request-sha256 "$(digest_file "$PREVIEW_REQUEST")" \
  --openclaw-target-root "$OPENCLAW_TARGET_ROOT" \
  --target-root "$ISOLATED_PROJECT_ROOT" \
  --fs-helper "$FS_HELPER" --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --absent-genesis "$ABSENT_GENESIS" --absent-genesis-sha256 "$(digest_file "$ABSENT_GENESIS")" \
  --out "$INSTALL_PLAN" --json

# upgrade or uninstall: exact current receipt
node ./bin/agentmo.js openclaw-install-preview --lifecycle upgrade \
  --archive "$PACKAGE_ARCHIVE" --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --blueprint "$BLUEPRINT" --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --target-descriptor "$TARGET_DESCRIPTOR" --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --probe "$PROBE" --probe-sha256 "$(digest_file "$PROBE")" \
  --request "$PREVIEW_REQUEST" --request-sha256 "$(digest_file "$PREVIEW_REQUEST")" \
  --openclaw-target-root "$OPENCLAW_TARGET_ROOT" \
  --target-root "$ISOLATED_PROJECT_ROOT" \
  --fs-helper "$FS_HELPER" --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --current-receipt "$CURRENT_RECEIPT" --current-receipt-sha256 "$(digest_file "$CURRENT_RECEIPT")" \
  --current-receipt-companion-bundle "$CURRENT_COMPANION_BUNDLE" --current-receipt-companion-bundle-sha256 "$(digest_file "$CURRENT_COMPANION_BUNDLE")" \
  --out "$INSTALL_PLAN" --json

# explicit rollback: current receipt plus selected predecessor receipt/archive
node ./bin/agentmo.js openclaw-install-preview --lifecycle rollback \
  --archive "$PACKAGE_ARCHIVE" --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --blueprint "$BLUEPRINT" --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --target-descriptor "$TARGET_DESCRIPTOR" --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --probe "$PROBE" --probe-sha256 "$(digest_file "$PROBE")" \
  --request "$PREVIEW_REQUEST" --request-sha256 "$(digest_file "$PREVIEW_REQUEST")" \
  --openclaw-target-root "$OPENCLAW_TARGET_ROOT" \
  --target-root "$ISOLATED_PROJECT_ROOT" \
  --fs-helper "$FS_HELPER" --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --current-receipt "$CURRENT_RECEIPT" --current-receipt-sha256 "$(digest_file "$CURRENT_RECEIPT")" \
  --current-receipt-companion-bundle "$CURRENT_COMPANION_BUNDLE" --current-receipt-companion-bundle-sha256 "$(digest_file "$CURRENT_COMPANION_BUNDLE")" \
  --predecessor-receipt "$PREDECESSOR_RECEIPT" --predecessor-receipt-sha256 "$(digest_file "$PREDECESSOR_RECEIPT")" \
  --predecessor-receipt-companion-bundle "$PREDECESSOR_COMPANION_BUNDLE" --predecessor-receipt-companion-bundle-sha256 "$(digest_file "$PREDECESSOR_COMPANION_BUNDLE")" \
  --predecessor-archive "$PREDECESSOR_ARCHIVE" --predecessor-archive-sha256 "$(digest_file "$PREDECESSOR_ARCHIVE")" \
  --out "$INSTALL_PLAN" --json
```

Use the same current-receipt form with `--lifecycle uninstall` for uninstall.
Explicit rollback is an operator-selected lifecycle successor; it is not
automatic failure cleanup.

### Three independent approval families

One review publishes three authority families with independent exact bytes:

```text
node ./bin/agentmo.js openclaw-install-approve \
  --plan "$INSTALL_PLAN" \
  --plan-sha256 "$(digest_file "$INSTALL_PLAN")" \
  --request "$APPROVAL_REQUEST" \
  --request-sha256 "$(digest_file "$APPROVAL_REQUEST")" \
  --ordinary-out "$ORDINARY_APPROVAL" \
  --sensitive-out "$SENSITIVE_DECISION_1" \
  --conflict-out "$CONFLICT_APPROVAL" \
  --json
```

`--sensitive-out` repeats once for every exact sensitive action. The ordinary
approval grants managed writes only; every sensitive decision binds its exact
executable/argv/cwd/scope/target/timeout/environment-name set; the conflict
approval binds the entire exact path/current-digest/desired-digest/action set.
No authority family can substitute for another. Apply requires the exact
conflict approval even when the approved conflict set is empty.

### Receipt-last apply

Use a new bounded attempt identifier. There is no public caller-selectable
authority/evidence-root option: the CLI
derives the canonical ledger from the real OpenClaw target root plus the exact
target descriptor, and apply rejects any internally supplied root that does not
match that derivation. The caller cannot select a fresh ledger to replay an
approval.

```text
node ./bin/agentmo.js openclaw-install-apply --lifecycle install \
  --attempt-id "$ATTEMPT_ID" \
  --blueprint "$BLUEPRINT" --blueprint-sha256 "$(digest_file "$BLUEPRINT")" \
  --build-contract "$BUILD_CONTRACT" --build-contract-sha256 "$(digest_file "$BUILD_CONTRACT")" \
  --plan-approval "$PLAN_APPROVAL" --plan-approval-sha256 "$(digest_file "$PLAN_APPROVAL")" \
  --target-descriptor "$TARGET_DESCRIPTOR" --target-descriptor-sha256 "$(digest_file "$TARGET_DESCRIPTOR")" \
  --target-carrier-admission "$TARGET_CARRIER_ADMISSION" \
  --target-carrier-admission-sha256 "$(digest_file "$TARGET_CARRIER_ADMISSION")" \
  --archive "$PACKAGE_ARCHIVE" \
  --archive-sha256 "$(digest_file "$PACKAGE_ARCHIVE")" \
  --probe "$PROBE" --probe-sha256 "$(digest_file "$PROBE")" \
  --install-plan "$INSTALL_PLAN" --install-plan-sha256 "$(digest_file "$INSTALL_PLAN")" \
  --ordinary-approval "$ORDINARY_APPROVAL" --ordinary-approval-sha256 "$(digest_file "$ORDINARY_APPROVAL")" \
  --sensitive-decision "$SENSITIVE_DECISION_1" --sensitive-decision-sha256 "$(digest_file "$SENSITIVE_DECISION_1")" \
  --conflict-approval "$CONFLICT_APPROVAL" --conflict-approval-sha256 "$(digest_file "$CONFLICT_APPROVAL")" \
  --absent-genesis "$ABSENT_GENESIS" --absent-genesis-sha256 "$(digest_file "$ABSENT_GENESIS")" \
  --fs-helper "$FS_HELPER" \
  --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --openclaw-target-root "$OPENCLAW_TARGET_ROOT" \
  --target-root "$ISOLATED_PROJECT_ROOT" \
  --out "$INSTALL_RECEIPT" \
  --json
```

For upgrade/uninstall, replace the absent-genesis pair with the exact current
receipt pair. For explicit rollback, also add the exact selected predecessor
receipt/archive pairs. Repeat the sensitive-decision pair for each action;
always include the exact conflict-approval pair, including for an empty set.
Current and rollback predecessor receipts additionally require their explicit
companion closure for the install plan, ordinary approval, ordered sensitive
decisions, conflict approval, private journal, probe, package manifest,
target/carrier admission, blueprint, build contract, plan approval, target
descriptor, and every historical predecessor. A non-install chain uses one
canonical request-only `--current-receipt-companion-bundle` or
`--predecessor-receipt-companion-bundle` plus its external digest; the bundle
is read bounded/no-follow and is never an installed or durable package
artifact. Flat companion flags remain valid only where the selected receipt is
an install receipt with no predecessor. Run
`node ./bin/agentmo.js openclaw-install-apply --help` for the closed
`--current-receipt-companion-*` and
`--predecessor-receipt-companion-*` flag families; omission, substitution,
duplication, or reordering fails before effects.

Before its private journal or any target effect, apply re-admits every authority
from the selected file and external SHA-256, retains and revalidates the D-42
archive through the complete member closure and identity, and immediately
re-probes target, ownership, parents, current digests, and conflict state. It
then performs only approved operations, post-observes every path, and publishes
a create-only complete or incomplete receipt last.

Before any marker, private journal, official action, or managed effect, apply
checks `useNonce` uniqueness globally across ordinary, every sensitive, and
conflict authority. It then reserves each family marker in the one derived
canonical ledger. The retained-dirfd kernel creates the final marker name
exclusively before writing canonical bytes. A zero-byte, partial, stale,
unknown, wrong-owner, wrong-mode, wrong-identity, or wrong-digest marker is
permanently fail-closed and never releases the nonce. All three family markers
are canonically reopened before effects or resume. A fresh process may resume
only the same exact attempt when the complete marker set and byte-exact private
journal re-admit together; otherwise the result is recovery-required.

Unknown, modified, external, or ownership-ambiguous assets are preserved.
Recovery reopens and revalidates every named object in a new retained-dirfd
session. Published objects are never deleted from a reopened pathname, even
when identity, marker, and digest still match; they remain itemized in an
incomplete receipt for explicit operator review.

A strict `complete` receipt requires unique successful managed and external
results for the exact plan, exact consumption of all three authority families,
the exact post-state, and empty preservation/recovery sets. Those facts are not
trusted from receipt JSON. The producer publishes retained-session post-state,
one ordered canonical official-action-result per action, and one append-only
finalization into the derived ledger. Receipt admission reopens all three
evidence classes and recomputes the receipt projection; generic JSON plus a
caller-computed digest cannot mint authority. Current and rollback predecessor
receipts recurse through the same companion and producer-auth evidence closure.
Failed, unsupported, preserved, ambiguous, missing, duplicate, substituted,
reordered, or forked evidence cannot validate as complete. To inspect a receipt
without running OpenClaw, render only a bounded value-blind summary:

```text
node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({schemaVersion:r.schemaVersion,status:r.status,lifecycle:r.lifecycle,lineage:r.lineage,managedResultCount:r.managedResults.length,externalResultCount:r.externalResults.length,preservedAssetCount:r.preservedAssets.length,recoveryRequired:r.recovery.required},null,2)+"\n")' "$INSTALL_RECEIPT"
```

Official config patching is currently supported only on Linux. The verified
child receives a retained private candidate through `/proc/self/fd`, and the
native subreaper/pidfd supervisor must prove its descendant set closed before an
identity-bound native `replaceExact` may publish the final bytes. Darwin
deliberately returns `platform-fd-config-transport-unavailable`; there is no
final-path fallback, so the current evidence does not prove all four lifecycles
on macOS.

The closed `secrets apply` / `models auth login` grammar is proposal-only in
Phase 4. Credential execution is unsupported, starts no process, records
`credentialPresent:false`, and cannot complete a receipt as a successful
credential effect. No credential value, auth/session state, credential-bearing
OpenClaw state, raw stdout/stderr, MCP route, or install-time credential process
is accepted or persisted.

Official config processes run behind the Linux native subreaper/pidfd
supervisor. A bidirectional handshake withholds `exec` until direct pidfd and
clock admission succeed. The inherited seccomp lock rejects x32 on x86_64 and
denies `setsid`, `setpgid`, outbound signal syscalls, `pidfd_send_signal`, and
`ptrace`; terminal pidfd slots are recycled. Timeout, output-limit, parent-exit,
and stream failure paths use `/proc` plus bounded TERM/KILL settlement. These
current-source controls require Linux execution before closure and must not be
interpreted as a general OS sandbox.

Package success rechecks the complete nested directory and archive closure
before and after publication. Failure performs no pathname cleanup or recursive
delete: every known package stage is returned as exact, mismatched, or unknown
recovery evidence, and ambiguous published objects remain preserved.

This workflow proves bounded mechanism execution only. Real OpenClaw
install/upgrade/rollback/uninstall, plugin activation, credential login, agent
or schedule execution, restart recovery, memory/RAG behavior, domain evaluation,
`live-success`, Birth, Delivery, production readiness, and wider compatibility
remain absent and belong to Phase 5.

The 2026-07-30 and 2026-07-31 aggregate records apply only to their historical
source states. Current focused evidence covers the exact authority-root replay,
candidate name drift, native-supervisor inventory/no-spawn boundary, Phase 4
package/lifecycle closure, and packed full journey. The latest aggregate attempt
reached main 956 pass / 0 fail / 10 skip and packed hook 1/1 before exposing one
load-sensitive packed hook replay. The bounded timeout contract passes 4/4 and
the corrected packed behavior lane passes 8/8. The current npm dry-run is
recorded in `release/2026.08.02.md`. The Linux native runtime gate and new
independent re-audit remain separate; neither historical audit nor focused
evidence may certify Phase 4 by itself.

## Codex Builder v1 lifecycle boundary

The Codex Builder is a Produce-internal mechanism and is not part of the support-triage command ancestry below. Its v1 lifecycle is append-only:

- `builder deactivate` appends a tombstone and makes the selected release inert without deleting its bytes, receipt, host evidence, or prior lifecycle evidence.
- `builder reactivate` appends an activation successor. `builder upgrade` publishes a new immutable version-qualified release and appends its selection.
- The hidden deprecated `builder uninstall` spelling has the same non-delete effect as `deactivate`; it is omitted from help.
- Purge, selector removal, host projection replacement, and `--remove-host-selector` are unsupported. There is no public or recovery-only physical-delete path.

Every lifecycle action uses preview/apply with the exact currently selected receipt digest:

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
CURRENT_RECEIPT=<receipt.path-from-current-lifecycle-result>
CURRENT_RECEIPT_DIGEST=$(digest_file "$CURRENT_RECEIPT")
node ./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
node ./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" \
  --apply --plan-digest <exact-preview-plan-digest> --json
node ./bin/agentmo.js builder reactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
```

An existing projected-v2 canonical receipt cannot be replaced in place by an activated-v4 setup receipt. Such a setup fails with `AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED`. Preserve the canonical genesis and use the immutable version-qualified lifecycle successor path. For a new absent installation that needs user-host activation, select `--host-scope user` during its initial setup.

The formal Codex UAT public route is `start`, exact-head `record`, `scenario-arm`, `terminal failure|interruption`, `inspect`, `resume`, and packed `continue`. `--journal` and `--uat-journal` take the journal file itself (for example, `<attempt-dir>/attempt.journal`), while packed `continue` takes `--attempt-dir <attempt-dir>`. Exact candidate admission uses `builder behavior --uat-journal <journal-file> --uat-candidate <candidate.json>` plus `builder-codex-uat-head` and `builder-codex-uat-candidate` digest bindings. The old `begin`/`finalize`, `--uat`, and `builder-codex-uat=` forms are not accepted.

The separately packed verifier's `preview` is read-only. Its `decide approve|reject` result is explicitly caller-reported, nonterminal, and journal-preserving: `humanAuthorityVerified` stays `false` and `externalDecisionAuthorityRequired` stays `true`. AgentMo does not implement an independent external human decision authority. No eleven-scenario completion, verifier output, or focused test count certifies a real Codex session, Agent Package quality, domain quality, production readiness, or deployment approval.

Builder v1 currently requires POSIX filesystem semantics and is supported on macOS and Linux. Unsupported Windows paths or filesystem semantics fail closed.

## Run each stage independently

### Stage 1 only: materialize a Discovery Contract

Stage 1 has two supported paths. Use only one for a given discovery output directory.

#### Path A: manifest-only discovery pack

```bash
WORK=/tmp/agentmo-stage1-only
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

Expected outputs:

```text
$WORK/discovery/agentmo-discovery-db.json
$WORK/discovery/facts.jsonl
$WORK/discovery/coverage.json
```

`discover-pack` is manifest-only: it validates and materializes manifest metadata without reading the referenced local source files.

#### Path B: approved local source intake

Installed CLI form:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
DISCOVERY_MANIFEST=path/to/discovery.json
SOURCE_ROOT=path/to/source-root
OUTPUT_ROOT=path/to/discovery-output
agentmo discover-workspace "$DISCOVERY_MANIFEST" --source-root "$SOURCE_ROOT" --out "$OUTPUT_ROOT" --json --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")"
```

Repo-local form:

```bash
WORK=/tmp/agentmo-stage1-workspace
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

Expected outputs:

```text
$WORK/discovery/agentmo-discovery-db.json
$WORK/discovery/facts.jsonl
$WORK/discovery/coverage.json
$WORK/discovery/source-cards.json
$WORK/discovery/source-chunks.jsonl
```

`discover-workspace` reads only approved local source files referenced by the manifest under the repo-bound `--source-root`. It must not be pointed at `.env` files, key/cert directories, parent directories, or sibling projects. It does not perform web crawling, live search, browser automation, or search API calls.

Source-derived evidence enters `agentmo-discovery-db.json.facts` and `facts.jsonl` as `kind:"source_chunk"` records. `source-cards.json` and `source-chunks.jsonl` are supplemental sidecars for inspection/debugging; Stage 2 consumes the discovery DB, not the sidecars.

Manifest-only `kind:"extraction_field"` facts describe what a future collector should extract. They are planning declarations, not retrieved evidence, and can produce at most `partial` Stage 2 coverage. `supported` requires multiple matching `source_chunk` facts whose trust level is `derived`, `trusted`, or `verified`. Unverified chunks also remain at most `partial`.

Stop here when the goal is only a sanitized Discovery Contract. Do not infer blueprint, runtime, or domain certification from Stage 1 outputs. Stage 1 must not write blueprint, handoff, build, run, birth, domain-eval, or delivery artifacts. If workspace safety marks a DB unsafe, fail closed and do not pass that DB to Stage 2.

### Stage 2 only: plan and draft from contract artifacts

Point `DISCOVERY_DB` at any existing valid `agentmo.discovery-db.v1` artifact and `DISCOVERY_MANIFEST` at its exact approved source inventory. This command does not invoke Stage 1 or require workspace sidecars. Do not use a workspace DB when `validation.ok` is false or `safety.workspaceOk` is false.

```bash
WORK=/tmp/agentmo-stage2-only
rm -rf "$WORK"
mkdir -p "$WORK"
DISCOVERY_DB=/path/to/agentmo-discovery-db.json
DISCOVERY_MANIFEST=/path/to/discovery.json
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
PREVIEW_DIGEST=$(node ./bin/agentmo.js discovery-approve "$DISCOVERY_MANIFEST" --discovery-db "$DISCOVERY_DB" --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).previewDigest));')
node ./bin/agentmo.js discovery-approve "$DISCOVERY_MANIFEST" --discovery-db "$DISCOVERY_DB" --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" --approve --preview-digest "$PREVIEW_DIGEST" --out "$WORK/agentmo-discovery-approval.json" --json
node ./bin/agentmo.js decision-ledger append --journal "$WORK/decision-ledger.json" --entry examples/support-triage.decision-entry.json --digest "decision-entry=$(digest_file "examples/support-triage.decision-entry.json")" --json
node ./bin/agentmo.js design-plan "$DISCOVERY_DB" \
  --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "discovery-approval=$(digest_file "$WORK/agentmo-discovery-approval.json")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "decision-ledger=$(digest_file "$WORK/decision-ledger.json")" \
  --manifest "$DISCOVERY_MANIFEST" \
  --discovery-approval "$WORK/agentmo-discovery-approval.json" \
  --need examples/support-triage.need.json \
  --decision-ledger "$WORK/decision-ledger.json" \
  --out "$WORK/agentmo-design-plan.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js blueprint-draft "$DISCOVERY_DB" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")" \
  --need examples/support-triage.need.json \
  --design-plan "$WORK/agentmo-design-plan.json" \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js validate "$WORK/support-triage.agentmo.json" --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
```

Stop here when the goal is only a reviewed blueprint/design contract. A valid blueprint is not runtime evidence and does not certify domain-wide quality or production approval.

### Stage 3 only: produce delivery evidence from a valid blueprint

This path starts from `examples/support-triage.agentmo.json`. It does not invoke `discover-pack`, `discover-workspace`, `need-report`, `design-plan`, or `blueprint-draft`.

```bash
WORK=/tmp/agentmo-stage3-only
rm -rf "$WORK"
mkdir -p "$WORK"
BLUEPRINT=examples/support-triage.agentmo.json
RUNTIME_PLAN="$WORK/runtime-plan.json"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js validate "$BLUEPRINT" --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js handoff "$BLUEPRINT" --target openclaw --out "$WORK/handoff" --json --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js scaffold "$BLUEPRINT" --target openclaw --out "$WORK/scaffold" --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js run-plan "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --json > "$RUNTIME_PLAN"
node ./bin/agentmo.js run "$RUNTIME_PLAN" \
  --digest "runtime-plan=$(digest_file "$RUNTIME_PLAN")" \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json --digest "run-state=$(digest_file "$RUN_STATE")" > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --digest "birth-report=$(digest_file "$WORK/birth-report.json")" \
  --digest "domain-eval=$(digest_file "$WORK/domain-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --birth-report "$WORK/birth-report.json" \
  --domain-eval "$WORK/domain-eval.json" \
  --json > "$WORK/delivery-report.json"
```

Expected result:

- `birth-report.ok === true`
- `birthStatus === "declared-ready"`
- birth/run certification boundary fields remain false
- `domain-eval.ok === true` for the sanitized deterministic fixture
- `delivery-report.ok === true`
- `delivery-report.deliveryReady === false` for declared-only runtime evidence

Scaffold, declared run-state, run-eval, birth-report, domain-eval, and delivery-report are delivery evidence only. They do not certify runtime behavior, domain-wide quality, production readiness, or deployment approval by themselves; a passing domain-eval proves only the supplied bounded case suite, and delivery-report only aggregates source artifacts.

## Support-triage composed vertical demo

The full support-triage sequence composes all three stages. The default demo below uses the manifest-only Stage 1 path:

```text
discover-pack -> discovery-approve -> need-report+decision-ledger -> design-plan -> blueprint-draft -> build-contract -> plan-approve -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

```bash
WORK=/tmp/agentmo-support-triage-mvp
rm -rf "$WORK"
mkdir -p "$WORK"
RUNTIME_PLAN="$WORK/runtime-plan.json"

digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
node ./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
PREVIEW_DIGEST=$(node ./bin/agentmo.js discovery-approve examples/support-triage.discovery.json --discovery-db "$WORK/discovery/agentmo-discovery-db.json" --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).previewDigest));')
node ./bin/agentmo.js discovery-approve examples/support-triage.discovery.json --discovery-db "$WORK/discovery/agentmo-discovery-db.json" --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" --approve --preview-digest "$PREVIEW_DIGEST" --out "$WORK/agentmo-discovery-approval.json" --json
node ./bin/agentmo.js decision-ledger append --journal "$WORK/decision-ledger.json" --entry examples/support-triage.decision-entry.json --digest "decision-entry=$(digest_file "examples/support-triage.decision-entry.json")" --json
node ./bin/agentmo.js design-plan "$WORK/discovery/agentmo-discovery-db.json" \
  --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" \
  --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" \
  --digest "discovery-approval=$(digest_file "$WORK/agentmo-discovery-approval.json")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "decision-ledger=$(digest_file "$WORK/decision-ledger.json")" \
  --manifest examples/support-triage.discovery.json \
  --discovery-approval "$WORK/agentmo-discovery-approval.json" \
  --need examples/support-triage.need.json \
  --decision-ledger "$WORK/decision-ledger.json" \
  --out "$WORK/agentmo-design-plan.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" \
  --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")" \
  --need examples/support-triage.need.json \
  --design-plan "$WORK/agentmo-design-plan.json" \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
FS_HELPER="$WORK/openclaw-fs-kernel"
FS_HELPER_RECEIPT="$WORK/openclaw-fs-kernel-receipt.json"
# Precondition: create these absent paths with the exact
# openclaw-fs-kernel-build command in the Phase 4 section above.
FS_HELPER_RECEIPT_DIGEST="$(digest_file "$WORK/openclaw-fs-kernel-receipt.json")"
node ./bin/agentmo.js openclaw-target-describe \
  --target-executable "$OPENCLAW_EXECUTABLE" \
  --target-package-json "$OPENCLAW_PACKAGE_JSON" \
  --target-build-info "$OPENCLAW_BUILD_INFO" \
  --digest "target-executable=$(digest_file "$OPENCLAW_EXECUTABLE")" \
  --digest "target-package-json=$(digest_file "$OPENCLAW_PACKAGE_JSON")" \
  --digest "target-build-info=$(digest_file "$OPENCLAW_BUILD_INFO")" \
  --fs-helper "$FS_HELPER" \
  --fs-helper-receipt "$FS_HELPER_RECEIPT" \
  --fs-helper-receipt-digest "$FS_HELPER_RECEIPT_DIGEST" \
  --out "$WORK/openclaw-target-descriptor.json" \
  --json
node ./bin/agentmo.js build-contract "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")" \
  --digest "discovery-approval=$(digest_file "$WORK/agentmo-discovery-approval.json")" \
  --digest "decision-ledger=$(digest_file "$WORK/decision-ledger.json")" \
  --digest "openclaw-target-descriptor=$(digest_file "$WORK/openclaw-target-descriptor.json")" \
  --design-plan "$WORK/agentmo-design-plan.json" \
  --discovery-approval "$WORK/agentmo-discovery-approval.json" \
  --decision-ledger "$WORK/decision-ledger.json" \
  --target-descriptor "$WORK/openclaw-target-descriptor.json" \
  --out "$WORK/agentmo-build-contract.json" \
  --target openclaw \
  --json
PLAN_PREVIEW_DIGEST=$(node ./bin/agentmo.js plan-approve "$WORK/support-triage.agentmo.json" --build-contract "$WORK/agentmo-build-contract.json" --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" --digest "build-contract=$(digest_file "$WORK/agentmo-build-contract.json")" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).previewDigest));')
node ./bin/agentmo.js plan-approve "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "build-contract=$(digest_file "$WORK/agentmo-build-contract.json")" \
  --build-contract "$WORK/agentmo-build-contract.json" \
  --approve \
  --preview-digest "$PLAN_PREVIEW_DIGEST" \
  --out "$WORK/agentmo-plan-approval.json" \
  --json
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold" --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js run-plan "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --json > "$RUNTIME_PLAN"
node ./bin/agentmo.js run "$RUNTIME_PLAN" \
  --digest "runtime-plan=$(digest_file "$RUNTIME_PLAN")" \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json --digest "run-state=$(digest_file "$RUN_STATE")" > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --digest "birth-report=$(digest_file "$WORK/birth-report.json")" \
  --digest "domain-eval=$(digest_file "$WORK/domain-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --birth-report "$WORK/birth-report.json" \
  --domain-eval "$WORK/domain-eval.json" \
  --json > "$WORK/delivery-report.json"
```

To run the same composed demo with approved local source intake, replace only the first Stage 1 command:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

The downstream `design-plan` and `blueprint-draft` commands still consume `$WORK/discovery/agentmo-discovery-db.json`. It does not need `source-cards.json` or `source-chunks.jsonl`; those sidecars remain supplemental.

Expected result:

- `birth-report.ok === true`
- `birthStatus === "declared-ready"`
- birth/run certification boundary fields remain false
- `domain-eval.ok === true` for the sanitized deterministic fixture
- `delivery-report.ok === true`
- `delivery-report.deliveryReady === false` for declared-only runtime evidence

The support-triage deterministic fixture is sanitized, bounded evidence. It proves contract composition and sample case coverage only; it is not production customer-support certification.

## Live-success promotion gate

Declared evidence is enough for MVP wiring, not runtime promotion. For promotion, run an isolated live smoke and rerun `birth-report` with `--expect-status success`.

```bash
node ./bin/agentmo.js runtime-check --target openclaw &&
OPENCLAW_SOURCE_ROOT="<openclaw-source-root>" &&
scripts/openclaw-live-smoke.sh --blueprint examples/support-triage.agentmo.json --agent support-triage --message "Say exactly: ok" --openclaw-source-root "$OPENCLAW_SOURCE_ROOT"
```

Do not claim OpenClaw production/domain certification from the live smoke, birth report, deterministic support-triage fixture, or delivery report alone. Production/domain certification needs separate reviewed domain eval/rubric evidence and approval.

## Verification

```bash
node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
npm run check
git diff --check
```
