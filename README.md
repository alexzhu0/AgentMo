# AgentMo

AgentMo is a minimal agent-building toolkit: it records what agent should be built, plans the agent from valid data plus user needs, then scaffolds a repo-native harness for coding-agent production.

AgentMo has three explicit stages connected by artifact contracts, not mandatory command ancestry:

1. **Discover -> Discovery Contract:** materialize bounded discovery evidence through `discover-pack` (manifest-only), `discover-workspace` (approved local source intake), or exact-admitted `discover-live` with closed Web, GitHub REST, and arXiv metadata adapters.
2. **Plan -> Agent Design / Blueprint Contract:** exact-admit a discovery manifest, its derived database, explicit local `agentmo.discovery-approval.v1`, user need, and the current predecessor-bound `agentmo.decision-ledger.v1` head to produce a bidirectionally traceable `agentmo.design-plan.v1`, then draft a non-authoritative blueprint with `agentmo_version: "0.1"`, eval requirements, and evidence policy.
3. **Produce -> Delivery Evidence Contract:** accept any valid AgentMo blueprint/design contract, including externally reviewed or business-provided designs with bounded provenance, then produce handoff, scaffold, run, eval, birth, domain-eval, and delivery evidence.

The support-triage MVP is a composed vertical demo of those contracts. It is not the only valid path. The current `domain-eval` / `delivery-report` work belongs to stage 3: it closes delivery evidence after scaffold, run-state, run-eval, and birth-report exist.

See `docs/STAGE_CONTRACTS.md` for the contract matrix, allowed inputs, forbidden coupling, and independent verification commands. Echo and future close collaborators should start with the tri-party collaboration protocol in `CONTRIBUTING.md`.

AgentMo is not a chat prompt generator. It is a mechanism for building agents as software:

```text
Discover what to build
+ plan from data and user needs
+ produce with Codex / coding agents
+ domain genome
+ agent architecture
+ tool contracts
+ runtime harness
+ eval suite
+ evidence ledger
+ governance gates
= reproducible domain agent
```

## Current MVP

AgentMo currently provides a dependency-free Node CLI:

### White-collar research OpenClaw POC

The current POC lane builds a local OpenClaw workspace for white-collar AI
research, collects bounded metadata into a persistent Research DB, deduplicates
successful repeated collections, writes an Asia/Shanghai daily evidence brief,
and invokes an isolated DeepSeek-backed OpenClaw agent against local evidence.

```text
node ./bin/agentmo.js poc build \
  --seed examples/ai-frontier-poc.seed.json \
  --out /private/tmp/agentmo-white-collar-poc --json

node ./bin/agentmo.js poc collect \
  /private/tmp/agentmo-white-collar-poc \
  --sources examples/white-collar-research.sources.json \
  --network-mode public-only --json

node ./bin/agentmo.js poc brief \
  /private/tmp/agentmo-white-collar-poc \
  --date YYYY-MM-DD --json

node ./bin/agentmo.js poc schedule-preview \
  /private/tmp/agentmo-white-collar-poc --json

node ./bin/agentmo.js poc dashboard \
  /private/tmp/agentmo-white-collar-poc \
  --profile agentmo-poc-white-collar \
  --model deepseek/deepseek-v4-flash \
  --runtime-env-file /absolute/path/to/runtime.env \
  --port 18889
```

`poc dashboard` loads only the existing runtime-environment allowlist, prepares
the pinned DeepSeek provider and model catalog inside the workspace-owned
profile HOME, starts a token-authenticated loopback Gateway in the foreground,
and opens the exact generated Agent session. It does not source the environment
file into the parent shell, use `--force`, stop an existing Gateway, or mutate
the default `~/.openclaw`. Port `18889` is the default and an occupied port is
rejected before profile setup. Press Ctrl-C in the launching terminal to stop
the isolated Dashboard.

`public-only` remains the default network policy. Hosts whose trusted local
proxy maps the four fixed POC source names into `198.18.0.0/15` may explicitly
select `--network-mode synthetic-dns-proxy`. That mode does not admit IP-literal
targets, redirects, other private/reserved ranges, or unauthenticated TLS.
Per-source failures are counted without erasing records from successful
sources; a collection with no successful source still fails closed.

The 2026-08-06 independent acceptance run admitted 20 dynamic records on its
first qualifying collection, admitted zero duplicates on its second, restored
the same DB after restart, produced an 8-evidence/0-gap brief, and completed
short evidence-bound OpenClaw/DeepSeek questions. This is POC mechanism and
acceptance evidence only: schedule activation, delivery, complete source
health, domain certification, and production readiness remain unproved. See
`release/2026.08.06.md`.

### Agent Package and OpenClaw lifecycle

Phase 4 turns one exact-approved build contract into a target-neutral canonical
Agent Package directory and deterministic D-42 transport archive. The directory
is build authority; `package-inspect` can verify it offline, but every
`openclaw-probe`, lifecycle preview, approval, and apply authority accepts only
the archive path plus its caller-supplied external SHA-256 and revalidates the
internal manifest, canonical inventory, and complete member closure.

The selected support-triage closure has archive
`sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f`,
manifest
`sha256:af98b46e5d5a6e46db7c7b020fea51115bae0829d943583ce9d756ce1d1c45`,
and 40-member inventory
`sha256:d6be393fc176c9f28811e9e8771fae7cff5efb81a824697a6300ae80466c32a5`.
It binds exact OpenClaw target `2026.7.1-2@0790d9f`; a changed target requires a
new descriptor, build contract, plan approval, target/carrier admission, probe,
and lifecycle review. An old approval never makes a mismatched target valid.

The public bounded flow is:

```text
openclaw-fs-kernel-build
  -> openclaw-target-describe -> openclaw-target-admit
  -> package-produce -> package-inspect -> openclaw-probe
  -> openclaw-install-genesis
  -> openclaw-install-preview
  -> openclaw-install-approve
  -> openclaw-install-apply
```

Install uses verified absent genesis; upgrade and uninstall use the exact
current receipt; explicit rollback uses the current receipt plus one selected
predecessor receipt/archive. Review keeps three authority families independent:
ordinary managed writes, one exact decision per sensitive action, and one exact
whole-conflict-set approval.

Apply has no public authority-root option. It derives one canonical ledger
location from the real OpenClaw target root and exact target descriptor, then
reopens that root and its three family markers canonically. Global nonce
uniqueness is checked across ordinary, sensitive, and conflict authorities
before any marker, private journal, official action, or managed effect.

The completion theorem is producer-authenticated by three canonical ledger
records: retained-session post-state, one ordered official-action-result record
per action, and one append-only finalization. Receipt admission reopens those
records and recomputes receipt fields from their bytes; a caller-created JSON
object plus its digest cannot mint install authority. Current and rollback
predecessors repeat the same recursive closure.

The official config effect is currently Linux-only: the child receives a
retained candidate through `/proc/self/fd`, the native supervisor must prove the
descendant set closed, and the final target is updated only by identity-bound
`replaceExact`. Darwin has no final-path fallback and returns an honest
unsupported result, so the four lifecycle claim is not cross-macOS completion.
The credential argv grammar is proposal-only in Phase 4: credential execution
does not spawn and always records `credentialPresent:false`.

Linux target operations run behind a native subreaper/pidfd supervisor. A
pre-exec handshake prevents target code from starting until direct pidfd and
clock admission succeed. The inherited seccomp lock rejects x32 on x86_64 and
denies `setsid`, `setpgid`, outbound signal syscalls, `pidfd_send_signal`, and
`ptrace`; terminal pidfd slots are recycled. Other platforms reject this route
before spawning. These current-source changes remain unproved until the Linux
adversarial gate executes.
The private config candidate remains named and retained; no pathname unlink can
delete a replacement. Package publication rechecks the complete nested
directory/archive closure, performs no pathname cleanup, and records every
known private temp as exact, mismatched, or unknown recovery evidence.

The three Critical findings from the 2026-07-31 fresh re-audit have focused
remediations. Two later fresh re-audits found one capacity/documentation pair,
then three supervisor-control/bootstrap/x32 issues plus one coverage warning.
All now have targeted code, test, and documentation changes without rewriting
the historical reports. The latest completed
aggregate attempt reached main 956 pass / 0 fail / 10 skip and packed hook 1/1;
its packed behavior lane exposed one load-sensitive hook replay, then passed 8/8
after a test-first bounded timeout correction. Compiled helpers, receipts,
authority state, evidence instances, and install hooks remain excluded. Phase 4
still requires the Linux native runtime gate before another independent
zero-blocker re-audit.

This is bounded mechanism evidence. Real OpenClaw lifecycle execution, plugin
activation, agent/schedule execution, restart and memory/RAG behavior, domain
evaluation, `live-success`, Birth, Delivery, production readiness, and wider
compatibility remain absent and Phase 5-owned. See
`docs/MVP_RUNBOOK.md` for the exact archive/digest command forms.

### Codex Builder lifecycle

The packed npm release contains one canonical Codex plugin. Builder setup, upgrade, deactivate, and reactivate are two-step operations: first inspect the exact plan, then apply that same project-bound plan digest explicitly.

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js builder setup --project . --json
./bin/agentmo.js builder setup --project . --apply --plan-digest <setup-plan-digest> --json
./bin/agentmo.js builder doctor --project . --json

# On an absent project, choose user-host activation during the initial setup
# instead of first publishing a project-only receipt and trying to replace it.
./bin/agentmo.js builder setup --project . --host-scope user --json
./bin/agentmo.js builder setup --project . --host-scope user \
  --apply --plan-digest <setup-and-activation-plan-digest> --json

# For every later lifecycle operation, use the receipt path/digest returned by
# the currently selected lifecycle result. The genesis path is shown here.
CURRENT_RECEIPT=.agentmo/builder/install-receipt.json
CURRENT_RECEIPT_DIGEST=$(digest_file "$CURRENT_RECEIPT")
./bin/agentmo.js builder upgrade --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
./bin/agentmo.js builder upgrade --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" \
  --apply --plan-digest <upgrade-plan-digest> --json

./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" \
  --apply --plan-digest <deactivation-plan-digest> --json
./bin/agentmo.js builder reactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
./bin/agentmo.js builder reactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" \
  --apply --plan-digest <reactivation-plan-digest> --json
```

AgentMo v1 does not physically delete Builder state. `deactivate` appends a tombstone while leaving the selected receipt, projected bytes, immutable release bytes, host evidence, and prior lifecycle evidence intact but inert. `reactivate` appends an activation successor. Upgrades publish under an immutable version-qualified path and append the new selection; they never overwrite the canonical genesis receipt. The hidden deprecated `uninstall` spelling maps to the same non-delete deactivation behavior. Purge, selector removal, host projection replacement, and every `--remove-host-selector` form are unsupported and fail closed.

Migration note: an existing projected-v2 canonical receipt cannot be replaced in place by an activated-v4 setup receipt. `builder setup --host-scope user` on that projected receipt returns `AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED`. Keep the canonical receipt immutable and use the version-qualified lifecycle successor path for later releases; when user-host activation is required for a new installation, select `--host-scope user` during the initial absent-project setup. Do not delete, rename, or rewrite old receipts to force the transition.

Builder v1 relies on POSIX ownership, mode, hard-link, and directory-sync guarantees and is supported on macOS and Linux. Windows paths and unsupported filesystem semantics fail closed. This platform boundary is mechanism support only, not Codex host, domain, or production certification.

After setup, run the bounded fresh-process mechanism evaluation with the currently selected receipt path and exact digest:

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
RECEIPT=<receipt.path-from-current-lifecycle-result>
./bin/agentmo.js builder behavior-eval --project . \
  --digest "builder-install-receipt=$(digest_file "$RECEIPT")" --json
```

Project setup projects a receipt-managed launcher at `plugins/agentmo/runtime/agentmo/bin/agentmo.js`. Exact installed `SessionStart`, `PreCompact`, and `PostCompact` deliveries traverse the fixed adjacent launcher, receipt-bound release, canonical hook reducer, and checkpoint CAS. Hook input cannot select project, workflow stage, approval, or next action. Host state and lifecycle state use append-only authority: old state files may serve as immutable genesis inputs, but current authority is a successor chain rather than a rewritten canonical file. AgentMo never writes Codex cache, config, or trust state directly, and hook trust remains human-owned.

Hook integrity has a deliberate seed boundary: the host must install and protect the initial `agentmo-hook.js` seed. After that seed starts, it authenticates the retained runtime graph before importing it. JavaScript cannot authenticate the seed before the host executes that same pathname; this remains a host-installation assumption, not a host-support certification. The retained bootstrap graph uses parent-owned, dedicated single-frame fd3 (loader) and fd4 (snapshot verifier) channels: parent injects canonical decimal `N` in `1..24 MiB`, each reader digests and interprets exactly `N` bytes, and returns once `N` arrives without waiting for peer EOF. Invalid/zero/non-canonical/out-of-range lengths and EOF before `N` fail closed. Bytes after `N` are never graph input; with a held-open peer, AgentMo makes no claim that a future `N+1` byte is detectable or rejectable.

Append-only recovery has a deliberate local-state boundary: the project-root `.agentmo-root-witness` prevents an authority from silently re-genesis when its root and local lineage evidence disappear while the rest of project evidence remains. Deleting every project-local authority and that witness is indistinguishable from a virgin project; no readiness or certification claim covers that case.

The formal `agentmo.codex-uat.v1` path is an immutable attempt journal, not a mutable run file. `start`, exact-head `record`, `scenario-arm`, `terminal`, `inspect`, `resume`, and the packed pre-deactivation `continue` command own progression. Candidate publication is leaf-first and absent-only. Exact candidate admission uses `builder behavior --uat-journal ... --uat-candidate ...` plus separate head and candidate digests; the removed `--uat` / `builder-codex-uat=` spelling returns `AGENTMO_CLI_BUILDER_UAT_MIGRATION_REQUIRED`. All surviving observations are bounded and value-blind. This mechanism does not establish cryptographic Codex origin, a real authenticated session, host behavior, Agent Package quality, domain quality, production readiness, or deployment approval.

The implemented Builder surfaces and their current evidence status are deliberately separate:

| Surface | Implemented boundary | Current status |
| --- | --- | --- |
| Packed UAT releases and verifier | Distinct baseline/successor tarballs, manifest-bound `scripts/verify-codex-uat-candidate.js`, read-only `preview`, and exact `decide approve\|reject` reports | Caller decisions are nonterminal; independent external decision authority is not implemented |
| Project runtime | Receipt-managed launcher and complete co-released import closure under `plugins/agentmo/runtime/agentmo/` | Mechanism-tested; not a host-support certification |
| User-host activation | Explicit `--host-scope user`, fixed official Codex calls, separate selector owner and sorted project-consumer ledger | Host trust remains human-owned |
| Doctor | Read-only projection, host, ownership, skill, hook, trust and checkpoint diagnosis | Observation only; never repairs or promotes support |
| Upgrade/deactivate/reactivate | Exact plan approval, immutable version-qualified releases, append-only tombstones and activation successors | No physical deletion, purge, selector removal, or canonical replacement |
| Installed recovery | Fixed hook runner -> adjacent project launcher -> canonical reducer -> checkpoint CAS | Packed integration gate pending; latest verifier-inclusive attempt stopped during setup apply |
| Formal UAT | Activation-first immutable journal, eleven ordered value-blind observations, leaf-first candidate publication, and separate exact successor verification | Mechanism and aggregate release gate passed; no real session or certification claim |

### Formal Codex UAT gate

On 2026-07-19, the first isolated host attempt used a fresh private root, project, `HOME`, and `CODEX_HOME`, the packed artifact, and the projected project-local launcher. It did not use the AgentMo source checkout or a global AgentMo executable. Project-only setup completed, the user-host activation preview produced its exact plan, and activation apply then failed closed at the fixed precondition `precondition:user-host-activation` with reason `AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED`. The setup receipt was preserved and the project projection remained `pristine`.

That attempt stopped before normal trust, authentication, a real Codex session, the formal eleven-scenario UAT run, candidate production, or exact admission. It is recorded only through a private value-blind continuation handle and digest; that record is not `agentmo.codex-uat.v1` and is not a real-session attestation. `realCodexSessionVerified`, activation verification, host-behavior verification, Agent Package certification, domain certification, production approval, and deployment approval all remain `false`. The real-session portions of Phase 2, BLDR-01, and BLDR-07 remain pending; the local mechanism release gate is separately complete.

#### Verifier-inclusive Plan 02-17 outcome (2026-07-20)

Plan 02-17 first closed the package/evidence mechanism before creating any actual UAT bytes. The core plus packed focused gate passed 25/25 tests, artifact-surface coverage passed 14/14, the full repository gate passed 658/658, and `git diff --check` passed. The combined Phase 02-11 through 02-17 Builder gate then passed 206/206 before the one final attempt was created. These results prove the bounded release, journal, candidate, and verifier mechanisms only.

The release builder produced distinct actual `agentmo` versions `0.1.0-uat.17.1` and `0.1.0-uat.17.2`. Their release digests are `sha256:04f700671552a27cd24561f433ff0bc12e527a0ec6fef3e026033c78e4337105` and `sha256:43fe7a96619f83563e48e34b82edb45b10327f4b575b029aca441d6ce0ecee97`; their tarball digests are `sha256:ab2c27521575d57ac11e32d27f5071114f65d30c6e9f892d685b1c1b27345563` and `sha256:dd6aeabdf92c9af1fba3f5ae7e22486b4854295b26ed42f722a75723661150be`. Fresh extraction independently matched both package closures and both manifest-bound verifier bytes to `sha256:e73b9c195363c521d423f0702d2dc7d0be66933b26d6494b834bc821dd4662f2`.

The unique actual attempt started and the baseline setup preview produced the exact apply digest `sha256:48388698a454f21e5e77aa2058fb47c7386c80f00fba9bf6764ef279374642c7`. Its single apply failed closed with `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED`. The immutable two-entry journal ends in that first `failure` terminal at head `sha256:5a82e22d54bb8a52f1515d54e03d0e0668efdc083637b426d5280b38ebeb8d5f`; independent read-only verification appended nothing. No `setup-applied`, `activation-applied`, Codex process start, trust/auth observation, SessionStart, lifecycle scenario, candidate, verifier preview, human decision, or live success occurred. The attempt was not retried or replaced.

The current public contract is `builder codex-uat start`, exact-head `record`, `scenario-arm`, `terminal`, `inspect`, `resume`, and the packed pre-deactivation `continue` command. The separately packed verifier exposes read-only `preview` and caller-reporting `decide approve|reject`. Run `node ./bin/agentmo.js --help` for the complete closed argument surfaces. The release producer is `node scripts/build-builder-uat-releases.js --out <new-ignored-root> --baseline-version <version> --successor-version <distinct-version> --json`; its output root must be absent, private, and excluded from release evidence.

This is a completed fail-closed plan execution, not a successful UAT or Phase 2 completion. Phase 2 remains `gaps_found` and incomplete. Cryptographic Codex origin, real-session behavior, domain quality, Agent Package quality, package or production readiness, deployment approval, and wider Codex/OpenClaw compatibility all remain false or unproven.

The 2026-07-20 and 2026-07-22 reviews remain historical findings records. After their in-scope repairs, the local release gate passed `npm run check` with 760 passing tests, 0 failures, and 1 skipped test; the fresh final review recorded Critical 0 and Warning 0, summarized in `release/2026.07.23.md`. This clears the local mechanism gate only: it does not turn the prior fail-closed host attempt into a real session, domain-quality result, production approval, or wider compatibility certification.

A future formal retry, only after the developer explicitly approves another attempt, must use a new isolated project, a new `HOME` and `CODEX_HOME`, normal Codex trust, and a freshly authenticated Codex session. It must use the projected launcher rather than a source checkout or global `agentmo` executable. The public command shapes are:

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
AGENTMO=./plugins/agentmo/runtime/agentmo/bin/agentmo.js
RECEIPT=.agentmo/builder/install-receipt.json
ATTEMPT_DIR=path/to/new-attempt-dir
JOURNAL="$ATTEMPT_DIR/attempt.journal"
START_REQUEST=path/to/attempt-started.record.json
RECORD_REQUEST=path/to/next-transition.record.json
CHECKPOINT=path/to/challenge-bearing-checkpoint.json
OBSERVATION=path/to/immutable-observation-leaf.json
TERMINAL_EVIDENCE=path/to/value-blind-terminal.evidence

node "$AGENTMO" builder codex-uat start \
  --journal "$JOURNAL" --attempt-id <bounded-attempt-id> \
  --request "$START_REQUEST" \
  --digest "builder-codex-uat-record-request=$(digest_file "$START_REQUEST")" --json

node "$AGENTMO" builder codex-uat inspect --journal "$JOURNAL" --json
node "$AGENTMO" builder codex-uat resume --journal "$JOURNAL" \
  --expected-head-sha256 <exact-current-head-sha256> --json

node "$AGENTMO" builder codex-uat record \
  --journal "$JOURNAL" --expected-head-sha256 <exact-current-head-sha256> \
  --request "$RECORD_REQUEST" \
  --digest "builder-codex-uat-record-request=$(digest_file "$RECORD_REQUEST")" --json

# For an installed-hook scenario, arm the exact checkpoint first, deliver the
# hook, then record the exact successor checkpoint and immutable observation.
node "$AGENTMO" builder codex-uat scenario-arm \
  --journal "$JOURNAL" --expected-head-sha256 <exact-current-head-sha256> \
  --checkpoint "$CHECKPOINT" \
  --digest "builder-checkpoint=$(digest_file "$CHECKPOINT")" --json
node "$AGENTMO" builder codex-uat record \
  --journal "$JOURNAL" --expected-head-sha256 <exact-current-head-sha256> \
  --request "$RECORD_REQUEST" \
  --digest "builder-codex-uat-record-request=$(digest_file "$RECORD_REQUEST")" \
  --checkpoint "$CHECKPOINT" \
  --digest "builder-checkpoint=$(digest_file "$CHECKPOINT")" \
  --observation "$OBSERVATION" \
  --digest "builder-codex-uat-observation=$(digest_file "$OBSERVATION")" --json

# Failure/interruption is a bounded terminal, not a success substitute.
node "$AGENTMO" builder codex-uat terminal failure \
  --journal "$JOURNAL" --expected-head-sha256 <exact-current-head-sha256> \
  --code <bounded-code> --evidence "$TERMINAL_EVIDENCE" \
  --evidence-sha256 "$(digest_file "$TERMINAL_EVIDENCE")" --json

# The packed continuation runs before deactivation with an already approved
# deactivation plan and exact successor release identities.
node "$AGENTMO" builder codex-uat continue \
  --attempt-dir "$ATTEMPT_DIR" --expected-head-sha256 <exact-current-head-sha256> \
  --approved-deactivation-plan-sha256 sha256:<64hex> \
  --successor-tarball <successor.tgz> --expected-successor-version <version> \
  --expected-release-sha256 sha256:<64hex> --expected-tarball-sha256 sha256:<64hex> \
  --expected-verifier-sha256 sha256:<64hex>

# Candidate admission binds the full journal head and immutable candidate leaf.
node "$AGENTMO" builder behavior --project . \
  --digest "builder-install-receipt=$(digest_file "$RECEIPT")" \
  --uat-journal "$JOURNAL" --uat-candidate <candidate.json> \
  --digest "builder-codex-uat-head=<exact-current-head-sha256>" \
  --digest "builder-codex-uat-candidate=<exact-candidate-sha256>" --json

# Run this exact script from the freshly extracted successor package.
node scripts/verify-codex-uat-candidate.js preview \
  --attempt-dir "$ATTEMPT_DIR" --successor-tarball <successor.tgz> \
  --expected-head-sha256 sha256:<64hex> --expected-candidate-sha256 sha256:<64hex> \
  --expected-successor-version <version> --expected-release-sha256 sha256:<64hex> \
  --expected-tarball-sha256 sha256:<64hex>
node scripts/verify-codex-uat-candidate.js decide approve \
  --attempt-dir "$ATTEMPT_DIR" --successor-tarball <successor.tgz> \
  --expected-head-sha256 sha256:<64hex> --expected-candidate-sha256 sha256:<64hex> \
  --expected-successor-version <version> --expected-release-sha256 sha256:<64hex> \
  --expected-tarball-sha256 sha256:<64hex>
```

The fixed order is `session-start`, `skill-discovery`, `user-prompt-non-trigger`, `manual-pause`, `pre-compact`, `post-compact`, `restart-resume`, `duplicate-replay`, `second-compaction`, `upgrade-visibility`, and `deactivation-tombstone-visibility`. Challenge-bound steps require the exact successor checkpoint and immutable observation leaf selected by the current journal state; other transitions use their exact bounded request/evidence files. Do not substitute raw prompts, hook payloads, transcripts, stdout/stderr, host paths, environment values, credentials, or an informal success message.

`preview` is read-only. `decide approve|reject` reports only `caller-reported-approval` or `caller-reported-rejection`; it leaves the journal byte-identical and nonterminal, sets `humanAuthorityVerified: false`, and keeps `externalDecisionAuthorityRequired: true`. AgentMo does not currently implement an independent external human decision authority. Neither command is an approval gate, and no 11/11 scenario run, candidate, caller report, bounded host run, or synthetic test can certify Agent Package quality, domain quality, production readiness, deployment approval, or wider Codex compatibility.

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js artifact-contract discovery-manifest --json
./bin/agentmo.js artifact-contract agent-idea-candidate --json
./bin/agentmo.js artifact-contract user-need --json
./bin/agentmo.js artifact-contract decision-entry --json
./bin/agentmo.js validate examples/win9.agentmo.json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js report examples/win9.agentmo.json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js report examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js discover-report examples/win9.discovery.json --json --digest "discovery-manifest=$(digest_file "examples/win9.discovery.json")"
./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out /tmp/support-triage-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out /tmp/support-triage-workspace-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
PREVIEW_DIGEST=$(./bin/agentmo.js discovery-approve examples/support-triage.discovery.json --discovery-db /tmp/support-triage-discovery/agentmo-discovery-db.json --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).previewDigest));')
./bin/agentmo.js discovery-approve examples/support-triage.discovery.json --discovery-db /tmp/support-triage-discovery/agentmo-discovery-db.json --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")"
./bin/agentmo.js discovery-approve examples/support-triage.discovery.json --discovery-db /tmp/support-triage-discovery/agentmo-discovery-db.json --approve --preview-digest "$PREVIEW_DIGEST" --out /tmp/support-triage-discovery-approval.json --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")"
./bin/agentmo.js decision-ledger append --journal /tmp/support-triage-decision-ledger.json --entry examples/support-triage.decision-entry.json --digest "decision-entry=$(digest_file "examples/support-triage.decision-entry.json")" --json
./bin/agentmo.js design-plan /tmp/support-triage-discovery/agentmo-discovery-db.json --manifest examples/support-triage.discovery.json --discovery-approval /tmp/support-triage-discovery-approval.json --need examples/support-triage.need.json --decision-ledger /tmp/support-triage-decision-ledger.json --out /tmp/support-triage-design-plan.json --target openclaw --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")" --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")" --digest "discovery-approval=$(digest_file "/tmp/support-triage-discovery-approval.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")" --digest "decision-ledger=$(digest_file "/tmp/support-triage-decision-ledger.json")"
./bin/agentmo.js blueprint-draft /tmp/support-triage-discovery/agentmo-discovery-db.json --need examples/support-triage.need.json --design-plan /tmp/support-triage-design-plan.json --out /tmp/support-triage.agentmo.json --target openclaw --json --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")" --digest "design-plan=$(digest_file "/tmp/support-triage-design-plan.json")"
./bin/agentmo.js handoff /tmp/support-triage.agentmo.json --target openclaw --out /tmp/support-triage-handoff --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")"
./bin/agentmo.js plan examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "build-state=$(digest_file "/tmp/win9-openclaw-scaffold/agentmo-build-state.json")"
./bin/agentmo.js observe examples/win9.observation.json --json --digest "observation=$(digest_file "examples/win9.observation.json")"
./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/workspace --agent win9 --provider deepseek --model deepseek/deepseek-v4-flash --thinking off --transport local --runtime-env-file .env --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
RUN_STATE="/tmp/support-triage-run/runs/${RUN_ID:?set RUN_ID}/agentmo-run-state.json"
./bin/agentmo.js birth-report /tmp/support-triage.agentmo.json --build-state /tmp/support-triage-scaffold/agentmo-build-state.json --run-state "$RUN_STATE" --run-eval /tmp/support-triage-run-eval.json --expect-status declared --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "build-state=$(digest_file "/tmp/support-triage-scaffold/agentmo-build-state.json")" --digest "run-state=$(digest_file "$RUN_STATE")" --digest "run-eval=$(digest_file "/tmp/support-triage-run-eval.json")" > /tmp/support-triage-birth-report.json
./bin/agentmo.js domain-eval /tmp/support-triage.agentmo.json --cases examples/support-triage.domain-cases.json --target openclaw --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" > /tmp/support-triage-domain-eval.json
./bin/agentmo.js delivery-report /tmp/support-triage.agentmo.json --build-state /tmp/support-triage-scaffold/agentmo-build-state.json --run-state "$RUN_STATE" --run-eval /tmp/support-triage-run-eval.json --birth-report /tmp/support-triage-birth-report.json --domain-eval /tmp/support-triage-domain-eval.json --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "build-state=$(digest_file "/tmp/support-triage-scaffold/agentmo-build-state.json")" --digest "run-state=$(digest_file "$RUN_STATE")" --digest "run-eval=$(digest_file "/tmp/support-triage-run-eval.json")" --digest "birth-report=$(digest_file "/tmp/support-triage-birth-report.json")" --digest "domain-eval=$(digest_file "/tmp/support-triage-domain-eval.json")"
```

Every durable file operand above carries one canonical `--digest` subject calculated from the exact file bytes at the invocation. AgentMo verifies that binding before JSON decode; a digest of parsed or reserialized JSON is not equivalent. Missing, duplicate, extra, mismatched, or stale bindings fail closed.

Operator-authored Stage 1 and Stage 2 inputs are publicly discoverable without reading source code:

- `agentmo artifact-contract discovery-manifest --json` exports the field-level JSON Schema and a validator-valid minimal `agentmo.discovery.v1` template.
- `agentmo artifact-contract agent-idea-candidate --json` exports the closed, target-neutral `agentmo.agent-idea-candidate.v1` schema and a validator-valid minimal proposal template.
- `agentmo artifact-contract user-need --json` exports the field-level JSON Schema and a validator-valid minimal `agentmo.user-need.v1` template.
- `agentmo artifact-contract decision-entry --json` exports the five closed entry kinds, a validator-valid minimal `agentmo.decision-entry.v1` template, and the byte-sorted reference-array rule. Use `agentmo decision-ledger canonicalize-entry` to create a new absent canonical artifact before calculating its digest: it fixes UTF-8-byte-sorted `sourceRefs`, `decisionRefs`, and `requirementRefs` before serializing and verifying the exact staged bytes that determine the reported digest. The public Plan stale-head spelling is `--expected-head-digest`; Builder-only `--expected-head-sha256` is rejected by `decision-ledger`. On supported Darwin/Linux POSIX no-follow platforms its output parent must be caller-owned and non-group/world-writable. The approved narrow same-UID threat model excludes a concurrent same-UID adversary that performs link, rename, unlink, or write actions against the output parent, private stage, or target namespace during the invocation; the caller must exclusively control and keep those paths stable. It is not a same-UID concurrent filesystem transaction. Observable pre-publication identity or symlink anomalies fail closed; it never rolls back a published output by pathname. Append only verifies and preserves approved bytes.
- `agentmo discover-report --help`, `discover-pack --help`, `discover-workspace --help`, `need-report --help`, and `decision-ledger --help` point to the relevant contract and example.

`agentmo agent-idea-candidate-report <candidate.json> --discovery-db <db.json> --digest agent-idea-candidate=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--json]` read-only validates one Candidate against the exact admitted Discovery DB. Every `evidenceIds` entry must resolve to exactly one DB fact; missing, duplicate, or ambiguous IDs fail closed. The report exposes only bounded counts, evidence-kind/trust composition, and warnings. An `extraction_field` citation is a planning lead only and never proves user need, value, capability, domain quality, or Plan readiness.

The Candidate contains no human decision or approval state. Its fixed `certificationBoundary` keeps proposal-only true and user-need, value, capability, domain-quality, Plan-ready, production-ready, enter-Plan, build, and runtime claims false. No Plan command consumes it. A future separately designed Decision Artifact must exact-bind Candidate bytes before any human authorization can exist.
- A digest-bound artifact with the correct registered identity but invalid fields still fails closed with `AGENTMO_UNSUPPORTED_ARTIFACT`; JSON mode additionally returns bounded `subject` and `issues` fields. These messages contain field requirements only, never submitted values, host paths, credentials, or raw payloads. Correct the artifact, recompute its exact-byte digest, and retry.

Stage 1 has two explicit paths:

- `discover-pack` is the manifest-only path. It validates an `agentmo.discovery.v1` manifest and writes `agentmo-discovery-db.json`, `facts.jsonl`, and `coverage.json` without reading the referenced local source files.
- `discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]` is the approved local source-intake path. It reads only allowed local source files referenced by the manifest under the repo-bound `--source-root`.

`discover-workspace` writes five Stage 1 artifacts:

```text
agentmo-discovery-db.json
facts.jsonl
coverage.json
source-cards.json
source-chunks.jsonl
```

Source-derived evidence enters `agentmo-discovery-db.json.facts` and `facts.jsonl` as `kind:"source_chunk"` records. `source-cards.json` and `source-chunks.jsonl` are supplemental sidecars; Stage 2 uses the discovery DB as its durable input. Unsafe workspace DBs fail closed through DB-visible validation/safety state and must not enter `design-plan` or `blueprint-draft`.

Neither Stage 1 path performs web crawling, live search, or search API collection. `artifact-contract` improves contract authoring only; it is not a collector and does not upgrade manifest metadata into retrieved evidence. Do not point `--source-root` at secrets, `.env` files, parent directories, or sibling projects. Stage 1 stays decoupled: it does not call Stage 2/3 and does not write blueprint, handoff, build, run, birth, or delivery artifacts.

`plan` is a dry run: it emits deterministic managed write operations without
touching the output directory. `scaffold` applies the same domain operations and
then writes `agentmo-build-state.json` as a managed sidecar in the output root.
The sidecar records the request, target/profile resolution, source blueprint
hash, operation summaries, warnings, and generation timestamp; it is not counted
as a domain scaffold operation.

## Session recovery and current handoff

AgentMo carries repo-local current-status and workflow pages for restarting a
coding session without relying on old chat context:

```text
AGENTS.md
docs/SUPERPOWERS_WORKFLOW.md
docs/CURRENT_STATUS.md
release/README.md
docs/MVP_RUNBOOK.md
```

Use it when starting a fresh session or when work becomes mixed with sibling projects:

```bash
export AGENTMO_REPO="<path-to-AgentMo>"
cd "$AGENTMO_REPO"
git status --short
git branch --show-current
git rev-parse --short HEAD
```

Then tell the new session to read `AGENTS.md`,
`docs/SUPERPOWERS_WORKFLOW.md`, `docs/CURRENT_STATUS.md`, `release/README.md`,
and `docs/MVP_RUNBOOK.md` in that order. Together they record the active
objective, dirty-tree expectations, verification commands, secret-handling
rules, and the boundary that AgentMo work must not touch `pi`, `AgentHarness`,
or `openclaw` unless explicitly requested. The archived
`docs/OMX_SESSION_MIGRATION.md` is historical and non-executable.

Local agent instructions live in:

```text
AGENTS.md
```

Those instructions are the project-specific contract for future coding agents working in this repository.

## Why this exists

The Win9-on-Pi work showed a new development mode: use Codex to build another agent system on top of Pi. AgentMo captures that mode as a reusable three-stage agent-building mechanism.

- Stage 1 discovery materializes approved source inputs into structured databases or retrieval corpora. `discover-pack` remains manifest-only, `discover-workspace` remains approved local intake, and `discover-live` performs only exact-admitted, allowlist-bound HTTPS retrieval through the closed Web, GitHub REST, and arXiv metadata adapters.
- Discovery can be recorded as an external `agentmo.discovery.v1` manifest. `discover-report` validates it, `discover-pack` materializes the manifest-only Discovery Contract, `discover-workspace` reads approved local sources, and `discover-live` retrieves only exact allowlisted HTTPS sources through closed Web, GitHub REST, or arXiv metadata policies. A live source may explicitly declare `evidence_class` as `primary`, `first-party`, `context`, or `community`; Web and GitHub preserve that independent classification, arXiv accepts only `primary`, and approved local intake remains `approved-local`. The classification never upgrades declared trust or runtime confidence. Network and local records share provider/evidence/confidence/original-location fields plus deterministic dedup, freshness, conflict-candidate, and coverage-gap observations. Those observations are mechanical and do not certify truth, semantic quality, domain quality, runtime readiness, or production readiness.
- Multiple arXiv sources are serialized with an enforced 3000 ms minimum request-start interval. Pacing consumes the same aggregate deadline and fails closed instead of silently exceeding the declared collection budget.
- Stage 2 planning requires exact manifest/database approval, `agentmo.user-need.v1`, and the exact current decision-ledger head. It turns those inputs into an auditable `agentmo.design-plan.v1` with closed forward/reverse source, decision, requirement, capability, and eval edges; generated blueprint state remains draft until a later explicit plan approval.
- Stage 2 closes Plan with `agentmo.build-contract.v1` and a separate `agentmo.plan-approval.v1` preview/apply decision over the exact blueprint/build-contract bytes. The approval authorizes entry to Produce only; it is local operator intent, not authenticated organizational identity, installation authority, runtime proof, or quality certification.
- Stage 3 production accepts a valid blueprint/design contract by artifact validity, not command ancestry. It may start from AgentMo Stage 2 output or from an externally reviewed/business-provided contract with bounded provenance.
- Stage 3 then uses Codex and other coding-agent runtimes to finish handoff, scaffold, runtime evidence, domain eval, and delivery reporting.
- Codex acts as the builder: reads, edits, tests, verifies, documents.
- Pi can act as the active runtime: local agents, tools, sessions, extension surface.
- OpenClaw can be recorded as an active alternate architecture profile: Gateway, channel delivery, isolated agents, session trajectories, and plugin/runtime ownership boundaries.
- AgentHarness-style control-plane ideas act as governance: policy, gates, audit, manifests.
- AgentMo ties them together through its blueprint and three-stage lifecycle.

## Quality rule

AgentMo follows one strict idea. Read these as artifact-contract rules, not as mandatory command ancestry:

```text
No valid Discovery Contract, no AgentMo-generated plan.
No valid Agent Design / Blueprint Contract, no production.
No eval, no birth.
No evidence, no release.
No tool contract, no runtime.
No governance, no production.
No version ledger, no reproduction.
```

For Stage 3, an externally reviewed or business-provided valid blueprint/design contract can satisfy the plan contract when it carries bounded provenance. That admission does not certify runtime behavior, domain-wide quality, or production approval.

## Project layout

```text
bin/agentmo.js              CLI entrypoint
src/blueprint.js            Blueprint validation and quality gates
src/report.js               AgentMo readiness report
src/build-plan.js           Deterministic dry-run operation planner
src/build-state.js          Managed scaffold sidecar state writer
src/discovery.js            Discovery manifest validation and report builder
src/collectors/              Closed Web, GitHub REST, and arXiv metadata adapters
src/discovery-db.js         Sanitized discovery pack / facts / coverage materializer
src/user-need.js            User-need brief validation and report builder
src/source-refs.js          Shared bounded source_refs validation
src/design-plan.js          Stage 2 design-plan contract builder and validator
src/agent-idea-candidate.js Discover proposal validator and bounded read-only report
src/decision-entry-canonicalizer.js  Pre-digest canonical writer for new Plan entries
src/decision-ledger.js      Typed predecessor-bound durable planning decisions
src/discovery-approval.js   Exact manifest/database approval preview and apply boundary
src/blueprint-draft.js      Blueprint drafting from discovery DB plus user need/design-plan
src/build-contract.js       Complete exact-bound OpenClaw Agent Package resource graph
src/plan-approval.js        Exact blueprint/build-contract Produce-entry approval boundary
src/package-produce.js      Exact inputs -> canonical directory and deterministic D-42 archive
src/package-inspect.js      Offline directory/archive closure verification
src/openclaw-probe.js       Exact-target read-only synthetic-HOME capability fingerprint
src/openclaw-install-plan.js  Four-action archive-only lifecycle proposal contract
src/openclaw-install-approval.js  Ordinary/sensitive/conflict authority families
src/openclaw-install-evidence.js  Producer-authenticated post-state/result/finalization evidence
src/openclaw-install-transaction.js  Preservation-first receipt-last lifecycle seam
src/handoff.js              Coding/runtime handoff package writer
src/birth-report.js         Fail-closed birth gate over build/run/eval evidence
src/domain-eval.js          Independent bounded domain-quality evidence report
src/delivery-report.js      Delivery evidence aggregation and revalidation report
src/scaffold.js             Domain-agent scaffold generator
AGENTS.md                   Local instructions for Codex/OMX agents working on AgentMo
CONTRIBUTING.md              Alex/Echo/Codex collaboration protocol, PR workflow, boundaries, and validation commands
examples/win9.agentmo.json  Reference blueprint based on Win9-on-Pi
examples/win9.discovery.json  Reference discovery/input manifest
examples/support-triage.*   MVP birth-loop fixture inputs, domain cases, and generated draft blueprint
docs/                       Concept, lifecycle, schema, quality gates
docs/OMX_SESSION_MIGRATION.md  Archived, non-executable former session handoff
docs/AGENT_BIRTH_GATE.md    Birth-report evidence levels and fail-closed gate
docs/MVP_RUNBOOK.md         End-to-end MVP birth-loop runbook
docs/AGENTMO_MVP_LEDGER.md  MVP evidence ledger and non-certification disclosure
docs/OBSERVE_EVOLVE.md      Evidence-first observe/evolve record rules
docs/OPENCLAW_RUNTIME_NOTES.md  OpenClaw source-derived runtime notes
docs/STAGE_CONTRACTS.md     Stage artifact contracts and independent verification commands
release/                    Date-based release records and evidence summaries
test/                       Node test suite
```


## Build plans

`agentmo plan` compiles a valid blueprint into deterministic dry-run operations without writing files. The plan is the shared source of truth for scaffold apply, so dry-run and generated domain files stay in parity.

Plan JSON includes:

- `selectedTargetId`: explicit `--target` or the default `agentmo`.
- `selectedProfileId`: the matching runtime profile, primary fallback, or `null` with a stable warning.
- `selectedModuleIds`: currently always `["default"]`.
- `warnings`: sorted machine-readable warnings.
- `domainOperationCount` and `operations[]`: managed `write-file` operations keyed by `relativePath`.

## Control status snapshots

`agentmo status` emits `agentmo.control.v1`: a stable control snapshot for a future UI/control pane. It includes agent status, Produce maturity, runtime profiles, certification metadata when present, pipeline completeness, quality gates, eval/evidence/release summaries, risks, and next actions.

Pass `--build-state <path>` after scaffold to attach the latest managed sidecar summary:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "build-state=$(digest_file "/tmp/win9-openclaw-scaffold/agentmo-build-state.json")"
```

If build state is absent or unreadable, status remains available and reports the build-state section as unavailable.

## MVP birth loop

The first executable AgentMo loop is a composed vertical demo of the three artifact contracts:

```text
discover-pack | discover-workspace | discover-live
  -> discovery-approve preview/apply
  -> need-report + decision-ledger
  -> design-plan
  -> blueprint-draft
  -> build-contract
  -> plan-approve preview/apply
  -> Produce
```

The Phase 3 lane reconstructs authority from exact artifacts in fresh processes; no command history or session ancestry is authority. The decision ledger accepts only the closed kinds `fact`, `inference`, `unknown`, `rejected-option`, and `human-decision`. Its trace and the build contract close source, decision, requirement, capability, permission, acceptance-case, and evidence-obligation relationships in both directions.

The OpenClaw build contract binds an exact `agentmo.openclaw-target-descriptor.v1` rather than source constants. The descriptor is derived from retained no-follow reads of the target executable, first-party `package.json`, and first-party build-info bytes; it records the exact version, full/display revision, Node range, member digests, retained identity basis, target-root closure, provenance, and non-certification boundary. A newly observed target requires a new descriptor and exact approval, not a source edit. The contract projects 22 resource families: prompt, workspace context, skills, tools, tool policy, plugins, memory, RAG, storage, schedules, harness, agent loop, runtime binding, permissions, trust boundaries, secrets, install/load/execute transitions, recovery, acceptance cases, and evidence obligations. Phase 3 specifies and approves this graph; roadmap Phase 4 generates and performs separately authorized install/load mutation; roadmap Phase 5 executes and proves isolated runtime, schedule, memory/RAG, recovery, and eval behavior.

This sequence proves only bounded mechanism composition. Manifest `extraction_field` entries are declaration-only. Deduplication, freshness, conflict candidates, coverage, `declared-ready`, bounded live collection, and explicit local approvals do not prove semantic correctness, source quality, authenticated organizational identity, Agent Package quality, domain quality, runtime readiness, production readiness, or deployment approval. The lane also does not make Produce depend on prior command ancestry when a separately valid externally reviewed contract is admitted under its own bounded provenance.

`birth-report` is fail-closed. It requires a valid blueprint, `agentmo-build-state.json`, `agentmo-run-state.json`, and a passing `agentmo.run-eval.v1` report. Declared evidence proves wiring only; `live-success` evidence from isolated live execution is required before runtime promotion. The birth report never certifies runtime parity, domain quality, or production deployment.

`domain-eval` is independent bounded case-suite evidence over supplied domain cases. When it passes, `domainCertifiedByDomainEval` means the supplied deterministic suite passed; it is not production, customer-support-wide, or domain-wide certification.

`delivery-report` revalidates and aggregates blueprint, build-state, run-state, run-eval, birth-report, and optional domain-eval artifacts. It can carry the bounded domain-eval result, but it does not create runtime certification, domain-wide quality certification, OpenClaw production readiness, or production deployment approval by itself.

See `docs/MVP_RUNBOOK.md` and `docs/AGENT_BIRTH_GATE.md`.

## Observe / evolve records

`agentmo observe` validates `agentmo.observation.v1` records. Observation records capture failure evidence, a proposed regression, and an optional blueprint-change proposal. They do not automatically mutate blueprints, tools, evals, or generated scaffolds.

`agentmo observe-run <run-state.json> --out <observation.json>` derives the same proposal-only observation shape from managed runtime evidence. It is a bridge from failed or declared run-state sidecars into reviewed observe/evolve work, not an automatic blueprint or scaffold mutation path.

## OpenClaw target

`--target openclaw` generates an OpenClaw-oriented runtime package:

AgentMo core remains Node.js `>=20`, while OpenClaw target mutation requires `>=22.19.0 <23 || >=23.11.0`. Run `node ./bin/agentmo.js runtime-check --target openclaw` before any direct OpenClaw mutation; this CLI check is authoritative and is not runtime, domain, or production certification.

`--runtime-env-file` is AgentMo's sole public runtime environment-file option. The collision-prone former spelling is intentionally not an alias because a Node launcher can consume it before AgentMo receives argv; the Bash live-smoke helper keeps its own local option. Phase 01.2 binds actual Node 20 execution to a [repository-owned distribution trust anchor](scripts/node20-distribution-trust.json), the [current exact published receipt](release/evidence/2026.08.19-node20-core-receipt.json), and a [post-publication compatibility matrix](docs/RUNTIME_COMPATIBILITY.md). Its current receipt records the 43-file core manifest (including the Plan canonical writer), not the Builder hook/snapshot fd3/fd4 protocol sources; those have separate shipped-package and host-test evidence. The [2026.07.13 receipt](release/evidence/2026.07.13-node20-core-receipt.json) and [2026.08.14 receipt](release/evidence/2026.08.14-node20-core-receipt.json) remain historical evidence for their older command manifests. These are bounded mechanism records, not domain-quality or production certification.

```text
openclaw/
  workspace/
    AGENTS.md
    SOUL.md
    USER.md
    TOOLS.md
    IDENTITY.md
    skills/<agent_id>/SKILL.md
    memory/README.md
  config/openclaw.agent.patch.json
  RUNBOOK.md
  runtime_contract.md
```

The generated target is not automatically certified. Run evals and record evidence before changing the blueprint's primary runtime to `openclaw`.

## Release records

AgentMo keeps project-level release records under:

```text
release/YYYY.MM.DD.md
```

These files record milestones, design decisions, verification evidence, non-certification boundaries, and remaining risks. They are not a substitute for git tags or npm releases.

Update `release/` when AgentMo changes any durable mechanism:

- discovery, planning, or production loop behavior;
- blueprint/schema/runtime semantics;
- birth-gate or certification rules;
- runtime promotion evidence;
- session migration or handoff rules;
- major integration direction with Codex, Pi, OpenClaw, or AgentHarness.

Do not place secrets, raw transcripts, raw provider payloads, or credential-bearing runtime state in release records.

## Runtime certification and discovery

Runtime profiles can include optional certification metadata:

- `supported_assets`
- `unsupported_surfaces`
- `install_or_onramp`
- `verification_commands`
- `risk_notes`
- `owner`
- `last_verified_at`

Active runtime profiles without verification commands or unsupported-surface disclosure remain valid but produce warnings. The reference OpenClaw profile is an active alternate architecture reference, not a certified Win9 runtime.

Blueprints can also set `discovery_manifest_path`; `agentmo report` loads the manifest and includes a bounded discovery summary when available. Use `agentmo discover-report <discovery.json> --json` to validate a manifest directly.

## Scripts

```bash
npm run check &&
node ./bin/agentmo.js runtime-check --target openclaw &&
cp .env.example .env &&
# fill DEEPSEEK_API_KEY in .env; .env is gitignored and value-blind in AgentMo evidence
OPENCLAW_SOURCE_ROOT="<openclaw-source-root>" &&
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok" --openclaw-source-root "$OPENCLAW_SOURCE_ROOT"
```

`check` runs syntax checks and the Node test suite. The OpenClaw live smoke script is optional, defaults to DeepSeek flash with `--thinking off`, uses temporary `OPENCLAW_STATE_DIR`, scaffold workspace, and run-output paths by default, refuses non-gitignored env files, reads only supported env keys, passes proxy env keys through when present without persisting their values, requires live execution success by default, and scrubs credential-bearing OpenClaw state unless `--keep-state` is explicit.
