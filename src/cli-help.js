import { AGENT_IDEA_CANDIDATE_REPORT_HELP } from "./agent-idea-candidate-cli.js";

export function helpText() {
  return `AgentMo CLI

Builder platform: POSIX only (darwin, linux). Windows is unsupported.

Usage:
  agentmo pi-target-describe --sdk-root <private-sdk-root> --node-executable <node> --lock-file <package-lock.json> --out <absent-descriptor.json> [--json]
  agentmo pi-target-admit [exact Pi planning sources and digests] [fixed target paths] --out <absent-admission.json> [--json]
  agentmo pi-install-preview --lifecycle install|activate [exact Pi source paths and digests] --target-root <private-root> --authority-root <authority> --authority-binding <file> --digest native-authority-binding=sha256:<64hex> --budget-root <existing-project-budget> --chat-port <port> --proxy-port <port> --out <absent-plan.json> [--cases <digest-bound-cases.json> --restart-allowance 0|1] [--json]
  agentmo pi-install-approve --install-plan <file> --digest pi-install-plan=sha256:<64hex> --family ordinary|sensitive|conflicts [--action-id <plan-action>] --issued-at <ISO> --expires-at <ISO> --nonce <unique> --approve --out <absent-decision.json> [--json]
  agentmo pi-install-apply [exact Pi sources and approvals] --apply [--json]
  agentmo pi-native-serve [exact Pi sources and activation approvals] [--runtime-env-file <approved-file>] [--json]
  agentmo pi-native-stop --install-plan <activate-plan.json> --digest pi-install-plan=sha256:<64hex> --target-root <private-root> [--json]

Pi SDK uses an independently approved toolchain with Node >=22.19.0. Core import/help does not load the SDK.
Pi installation, activation and model acceptance require separate exact previews. A read-only activation cannot send.
Pi source flags are --blueprint, --build-contract, --plan-approval, --target-descriptor, --target-carrier-admission, --archive;
activation adds --installed-plan, --install-receipt and --install-plan. Each has its exact Pi subject --digest binding.
Serving requires the plan's two (read-only) or three (model cases) --sensitive-decision files with indexed pi-sensitive-action-decision-N digests, plus ordinary and conflict approvals.

  agentmo builder [start] [--host codex] [--json]
  agentmo builder probe [--host codex] [--json]
  agentmo builder setup [--project <dir>] [--digest builder-install-receipt=sha256:<64hex>] [--host-scope user] [--host codex] [--json]
  agentmo builder setup [--project <dir>] [--digest builder-install-receipt=sha256:<64hex>] [--host-scope user] --apply --plan-digest sha256:<64hex> [--host codex] [--json]
  agentmo builder recover inspect [--project <dir>] [--json]
  agentmo builder recover preview [--project <dir>] [--json]
  agentmo builder recover apply [--project <dir>] --plan-digest sha256:<64hex> [--json]
  agentmo builder recover upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--host codex] [--json]
  agentmo builder upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--host codex] [--json]
  agentmo builder deactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder deactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder reactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder reactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder doctor [--project <dir>] [--host codex] [--json]
  agentmo builder behavior [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--uat-journal <journal-file> --uat-candidate <candidate.json> --uat-baseline-package <dir> --uat-baseline-tarball <baseline.tgz> --uat-successor-package <dir> --uat-successor-tarball <successor.tgz> --digest builder-codex-uat-head=sha256:<64hex> --digest builder-codex-uat-candidate=sha256:<64hex>] [--json]
  agentmo builder behavior-eval [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder codex-uat start --journal <journal-file> --attempt-id <id> --request <record.json> --digest builder-codex-uat-record-request=sha256:<64hex> [--json]
  agentmo builder codex-uat scenario-arm --journal <journal-file> --expected-head-sha256 sha256:<64hex> --checkpoint <checkpoint> --digest builder-checkpoint=sha256:<64hex> [--json]
  agentmo builder codex-uat record --journal <journal-file> --expected-head-sha256 sha256:<64hex> --request <record.json> --digest builder-codex-uat-record-request=sha256:<64hex> [--checkpoint <checkpoint> --digest builder-checkpoint=sha256:<64hex> --observation <leaf.json> --digest builder-codex-uat-observation=sha256:<64hex>] [--json]
  agentmo builder codex-uat terminal failure|interruption --journal <journal-file> --expected-head-sha256 sha256:<64hex> --code <bounded-code> --evidence <evidence-file> --evidence-sha256 sha256:<64hex> [--json]
  agentmo builder codex-uat inspect --journal <journal-file> [--json]
  agentmo builder codex-uat resume --journal <journal-file> --expected-head-sha256 sha256:<64hex> [--json]
  agentmo builder codex-uat continue --attempt-dir <attempt-dir> --expected-head-sha256 sha256:<64hex> --approved-deactivation-plan-sha256 sha256:<64hex> --successor-tarball <successor.tgz> --expected-successor-version <version> --expected-release-sha256 sha256:<64hex> --expected-tarball-sha256 sha256:<64hex> --expected-verifier-sha256 sha256:<64hex>
  agentmo builder discover [--host codex] [--json]
  agentmo builder plan|produce --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> [--host codex] [--json]
  agentmo builder resume --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> [--host codex] [--json]
  agentmo builder pause --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> --event-id <id> --out <checkpoint.json> [--json]
  agentmo builder hook --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> --event <event.json> --digest builder-event=sha256:<64hex> --out <checkpoint.json> [--json]
  agentmo migrate <input-0.json> [input-N.json ...] --digest migration-input-0=sha256:<64hex> [--digest migration-input-N=sha256:<64hex> ...] [--out <new-dir>] [--json]
  agentmo runtime-check --target openclaw [--json]
  agentmo artifact-contract agent-idea-candidate|decision-entry|discovery-manifest|openclaw-probe|openclaw-target-carrier-admission|openclaw-target-descriptor|package-manifest|user-need [--json]
  agentmo poc build --seed <poc-seed.json> --out <absent-dir> [--json]
  agentmo poc check <workspace-dir> [--json]
  agentmo poc collect <workspace-dir> --sources <research-sources.json> [--network-mode public-only|synthetic-dns-proxy] [--json]
  agentmo poc brief <workspace-dir> --date YYYY-MM-DD [--json]
  agentmo poc schedule-preview <workspace-dir> [--json]
  agentmo poc run <workspace-dir> --profile <isolated-profile> --model deepseek/<model> --runtime-env-file <path> --message <text> [--json]
  agentmo poc dashboard <workspace-dir> --profile <isolated-profile> --model deepseek/<model> --runtime-env-file <path> [--port <port>] [--json]
  agentmo validate <blueprint.json> --digest blueprint=sha256:<64hex>
  agentmo report <blueprint.json> --digest blueprint=sha256:<64hex> [--discovery-manifest <discovery.json> --digest discovery-manifest=sha256:<64hex>] [--json]
  agentmo discover-report <discovery.json> --digest discovery-manifest=sha256:<64hex> [--json]
  agentmo discover-pack <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <dir> [--json]
  agentmo discover-live <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <absent-dir> [--json]
  agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
  agentmo agent-idea-candidate-report <candidate.json> --discovery-db <db.json> --digest agent-idea-candidate=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--json]
  agentmo discovery-approve <discovery.json> --discovery-db <agentmo-discovery-db.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <approval.json>] [--json]
  agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
  agentmo decision-ledger canonicalize-entry --entry <draft-entry.json> --out <absent-canonical-entry.json> [--json]
  agentmo decision-ledger append --journal <ledger.json> --entry <decision-entry.json> --digest decision-entry=sha256:<64hex> [--expected-head-digest sha256:<64hex>] [--json]
  agentmo decision-ledger inspect --journal <ledger.json> --digest decision-ledger=sha256:<64hex> [--json]
  agentmo design-plan <agentmo-discovery-db.json> --manifest <discovery.json> --discovery-approval <approval.json> --need <need.json> --decision-ledger <ledger.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest user-need=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]
  agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --digest discovery-db=sha256:<64hex> --digest user-need=sha256:<64hex> [--design-plan <agentmo-design-plan.json> --digest design-plan=sha256:<64hex>] --out <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo build-contract <blueprint.json> --design-plan <agentmo-design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --target-descriptor <descriptor.json> [--native-plugin-recipe <recipe.json> --digest native-plugin-recipe=sha256:<64hex>] --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --out <build-contract.json> --target openclaw [--json]
  agentmo plan-approve <blueprint.json> --build-contract <build-contract.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <plan-approval.json>] [--json]
  agentmo openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <descriptor.json> [--json]
  agentmo openclaw-target-admit <blueprint.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <admission.json> [--json]
  agentmo package-produce <blueprint.json> --design-plan <design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-carrier-admission <admission.json> --digest <subject=sha256:...>... --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent-dir> --archive <absent.d42> [--json]
  Native-chat publication: omit all --fs-helper* flags; describe requires --blueprint <file> --digest blueprint=sha256:<64hex>. Admit/Produce require matching admitted native-chat authority.
  Legacy publication: all three --fs-helper* flags above remain required.
  agentmo package-inspect <directory> --manifest-sha256 sha256:<64hex> [--json]
  agentmo package-inspect <archive.d42> --archive-sha256 sha256:<64hex> [--json]
  agentmo openclaw-probe --archive <archive.d42> --archive-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-root <dir> --out <absent.json> [--json]
  agentmo openclaw-install-genesis --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <genesis-request.json> --request-sha256 sha256:<64hex> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent.json> [--json]
  agentmo openclaw-install-preview --lifecycle install|upgrade|rollback|uninstall --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <preview-request.json> --request-sha256 sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> <exact lifecycle basis> --out <absent.json> [--json]
  agentmo openclaw-install-approve --plan <install-plan.json> --plan-sha256 sha256:<64hex> --request <approval-request.json> --request-sha256 sha256:<64hex> --ordinary-out <absent.json> --sensitive-out <absent.json>... --conflict-out <absent.json> [--json]
  agentmo openclaw-fs-kernel-build --binary-out <absent-private-path> --receipt-out <absent-private-path> [--json]
  agentmo openclaw-install-apply --lifecycle install|upgrade|rollback|uninstall --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --archive <archive.d42> --archive-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --install-plan <plan.json> --install-plan-sha256 sha256:<64hex> --ordinary-approval <approval.json> --ordinary-approval-sha256 sha256:<64hex> --sensitive-decision <decision.json> --sensitive-decision-sha256 sha256:<64hex> [--conflict-approval <approval.json> --conflict-approval-sha256 sha256:<64hex>] [--absent-genesis <genesis.json> --absent-genesis-sha256 sha256:<64hex> | --current-receipt <receipt.json> --current-receipt-sha256 sha256:<64hex> [--predecessor-receipt <receipt.json> --predecessor-receipt-sha256 sha256:<64hex> --predecessor-archive <archive.d42> --predecessor-archive-sha256 sha256:<64hex>]] --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-project-root> --out <absent-receipt.json> [--json]
  agentmo handoff <blueprint.json> --digest blueprint=sha256:<64hex> --target agentmo|openclaw --out <dir> [--json]
  agentmo status <blueprint.json> --digest blueprint=sha256:<64hex> [--build-state <path> --digest build-state=sha256:<64hex>] [--run-state <path> --digest run-state=sha256:<64hex>|--run-dir <dir> --digest run-index=sha256:<64hex> --digest run-state=sha256:<64hex>] [--json]
  agentmo plan <blueprint.json> --digest blueprint=sha256:<64hex> [--target agentmo|openclaw] [--json]
  agentmo openclaw-native serve|stop --help
  agentmo run-plan <blueprint.json> --digest blueprint=sha256:<64hex> --target openclaw --workspace <dir> [--agent <id>] [--session-key <key>|--session-id <id>|--to <dest>] (--message <text>|--message-file <path>) [--runtime-env-file <path>] [--provider <name>] [--model <name>] [--thinking off|minimal|low|medium|high|adaptive|xhigh|max] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--json]
  agentmo run <runtime-plan.json> --digest runtime-plan=sha256:<64hex> [--digest run-index=sha256:<64hex>] --workspace <dir> (--message <text>|--message-file <path>) --out <dir> [--runtime-env-file <path>] [--openclaw-source-root <dir>] [--openclaw-state-dir <dir>] [--live] [--json]
  agentmo run-report <run-state.json> --digest run-state=sha256:<64hex> [--json]
  agentmo replay-run <run-state.json> --digest run-state=sha256:<64hex> [--digest run-index=sha256:<64hex>] --out <dir> [--message <text>|--message-file <path>] [--workspace <dir>] [--openclaw-source-root <dir>] [--openclaw-state-dir <dir>] [--runtime-env-file <path>] [--require-exact-replay] [--resume-session] [--live] [--json]
  agentmo run-eval <run-state.json> --digest run-state=sha256:<64hex> [--message <text>|--message-file <path>] [--expect-status success|failure|declared] [--require-exact-replay] [--json]
  agentmo birth-report <blueprint.json> --digest blueprint=sha256:<64hex> --build-state <agentmo-build-state.json> --digest build-state=sha256:<64hex> --run-state <agentmo-run-state.json> --digest run-state=sha256:<64hex> --run-eval <run-eval.json> --digest run-eval=sha256:<64hex> --expect-status success|declared|failure [--json]
  agentmo domain-eval <blueprint.json> --digest blueprint=sha256:<64hex> --cases <cases.json> --digest domain-cases=sha256:<64hex> [--target agentmo|openclaw] [--json]
  agentmo delivery-report <blueprint.json> --digest blueprint=sha256:<64hex> --build-state <agentmo-build-state.json> --digest build-state=sha256:<64hex> --run-state <agentmo-run-state.json> --digest run-state=sha256:<64hex> --run-eval <run-eval.json> --digest run-eval=sha256:<64hex> --birth-report <birth-report.json> --digest birth-report=sha256:<64hex> [--domain-eval <domain-eval.json> --digest domain-eval=sha256:<64hex>] [--json]
  agentmo observe-run <run-state.json> --digest run-state=sha256:<64hex> --out <observation.json> [--json]
  agentmo scaffold <blueprint.json> --digest blueprint=sha256:<64hex> --out <dir> [--target agentmo|openclaw] [--force]
  agentmo observe <observation.json> --digest observation=sha256:<64hex> [--json]

Concepts:
  builder          Start or inspect the single Discover -> Plan -> Produce Builder lifecycle.
  migrate          Preview or explicitly apply a value-blind legacy artifact migration.
  runtime-check    Inspect the current process against the OpenClaw target runtime contract.
  artifact-contract  Export a field-level JSON Schema and valid minimal template for an operator-authored artifact.
  poc              Build, explicitly collect into, or brief an isolated local OpenClaw POC workspace. Schedule activation is not included.
  validate         Check an AgentMo blueprint and its quality gates.
  report           Build a human or JSON AgentMo readiness report.
  discover-report  Validate and summarize a discovery/input manifest.
  discover-pack    Materialize a sanitized discovery database, facts JSONL, and coverage report.
  discover-live    Fetch exact allowlisted HTTPS sources into bounded, provenance-bearing Stage 1 artifacts.
  discover-workspace  Read approved repo-bound local sources into sanitized Stage 1 discovery artifacts.
  agent-idea-candidate-report  Validate one proposal-only Candidate against exact Discovery DB facts; does not authorize Plan.
  discovery-approve  Preview or explicitly approve one exact manifest plus one exact discovery DB for Plan entry.
  need-report      Validate and summarize a concrete user-need brief.
  decision-ledger  Canonicalize unapproved drafts, then append or inspect typed predecessor-bound Plan decisions without transcript authority.
  design-plan      Produce a Stage 2 planning contract from discovery DB plus user need.
  blueprint-draft  Draft a valid AgentMo blueprint from discovery data plus user need, optionally gated by design-plan.
  build-contract   Specify the complete traceable OpenClaw Agent Package resource graph without materializing it.
  plan-approve     Preview or record exact local intent to enter Produce without certifying package or runtime.
  openclaw-target-admit  Bind one exact OpenClaw target to one approved native-plugin recipe.
  package-produce  Materialize one exact canonical Agent Package and its deterministic D-42 transport archive.
  package-inspect  Verify one complete Agent Package closure offline without installing or invoking OpenClaw.
  openclaw-probe  Fingerprint bounded read-only OpenClaw capability surfaces in a disposable synthetic HOME.
  openclaw-install-genesis  Publish verified absence authority from one exact probe and request.
  openclaw-install-preview  Publish an archive-only lifecycle proposal after exact predecessor admission.
  openclaw-install-approve  Publish independent ordinary, per-action, and exact-conflict authorities.
  openclaw-install-apply  Re-admit exact lifecycle authorities and publish one receipt-last bounded mechanism result.
  openclaw-fs-kernel-build  Build the auditable retained-dirfd helper and durable closed receipt.
  openclaw-target-describe Derive one exact target descriptor from retained first-party bytes.
  handoff          Write a coding/runtime handoff package for the generated blueprint.
  status           Build an auditable control snapshot from blueprint plus optional build/run state.
  plan             Dry-run deterministic scaffold operations without writing files.
  run-plan         Dry-run OpenClaw runtime command/evidence planning without executing OpenClaw.
  run              Write bounded OpenClaw run-state evidence; an existing output index requires its exact run-index digest.
  run-report       Summarize run-state evidence without changing blueprint status.
  replay-run       Reconstruct a prior run; an existing output index requires its exact run-index digest.
  run-eval         Evaluate evidence completeness without certifying runtime/domain behavior.
  birth-report     Fail-closed birth gate over blueprint, build-state, run-state, and run-eval evidence.
  domain-eval      Evaluate deterministic domain cases with bounded evidence refs; certifies only supplied cases.
  delivery-report  Re-validate and aggregate delivery closure evidence; does not itself certify runtime/domain-wide/production.
  observe-run      Convert run-state evidence into a proposal-only observation record.
  scaffold         Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.
  observe          Validate and summarize an observe/evolve record without applying changes.
`;
}

const OPENCLAW_RECEIPT_COMPANION_NAMES = [
  "install-plan",
  "ordinary-approval",
  "sensitive-decision",
  "conflict-approval",
  "journal",
  "probe",
  "target-descriptor",
  "package-manifest",
  "target-carrier-admission",
  "blueprint",
  "build-contract",
  "plan-approval",
];
const OPENCLAW_RECEIPT_COMPANION_HELP = [
  "For a non-install receipt chain, use one exact recursive bundle instead of flat flags:",
  "--current-receipt-companion-bundle <file> --current-receipt-companion-bundle-sha256 sha256:<64hex>",
  "--predecessor-receipt-companion-bundle <file> --predecessor-receipt-companion-bundle-sha256 sha256:<64hex>",
  "Current receipt companion flags:",
  ...OPENCLAW_RECEIPT_COMPANION_NAMES.flatMap((name) => [
    `--current-receipt-companion-${name} <file>`,
    `--current-receipt-companion-${name}-sha256 sha256:<64hex>`,
  ]),
  "Rollback predecessor companion flags:",
  ...OPENCLAW_RECEIPT_COMPANION_NAMES.flatMap((name) => [
    `--predecessor-receipt-companion-${name} <file>`,
    `--predecessor-receipt-companion-${name}-sha256 sha256:<64hex>`,
  ]),
].join("\n");

export function commandHelpText(command) {
  if (["pi-target-describe", "pi-target-admit", "pi-install-preview", "pi-install-approve", "pi-install-apply", "pi-native-serve", "pi-native-stop"].includes(command)) {
    return `AgentMo ${command}\nPi SDK requires an independently approved toolchain and Node >=22.19.0.\nUse agentmo --help for fixed source flags and Pi digest subjects. Installation, activation and model acceptance each require their own exact approved preview.\n`;
  }
  const entries = {
    "artifact-contract": `AgentMo artifact-contract
Usage: agentmo artifact-contract agent-idea-candidate|decision-entry|discovery-manifest|openclaw-probe|openclaw-target-carrier-admission|openclaw-target-descriptor|package-manifest|user-need [--json]
Exports the complete field-level JSON Schema and a valid minimal template.
`,
    poc: `AgentMo POC
Usage:
  agentmo poc build --seed <poc-seed.json> --out <absent-dir> [--json]
  agentmo poc check <workspace-dir> [--json]
  agentmo poc collect <workspace-dir> --sources <research-sources.json> [--network-mode public-only|synthetic-dns-proxy] [--json]
  agentmo poc brief <workspace-dir> --date YYYY-MM-DD [--json]
  agentmo poc schedule-preview <workspace-dir> [--json]
  agentmo poc run <workspace-dir> --profile <isolated-profile> --model deepseek/<model> --runtime-env-file <path> --message <text> [--json]
  agentmo poc dashboard <workspace-dir> --profile <isolated-profile> --model deepseek/<model> --runtime-env-file <path> [--port <port>] [--json]
Build writes an isolated local OpenClaw workspace from externally curated seed records. Collect only requests closed research sources and persists bounded metadata. The default network mode remains public-only; synthetic-dns-proxy is an explicit opt-in for the fixed source hostnames and still requires hostname-authenticated TLS with no redirects. Brief writes local evidence projection only. Schedule preview is inert. Run creates a profile HOME inside that workspace, uses the named profile, and invokes only one local agent turn. Dashboard starts a loopback-only isolated OpenClaw Dashboard, safely loads the runtime allowlist, and opens the exact generated Agent; it does not install into the default profile. None of these commands delivers a reply or activates a schedule.
`,
    "discover-report": `AgentMo discover-report
Usage: agentmo discover-report <discovery.json> --digest discovery-manifest=sha256:<64hex> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Valid example: examples/support-triage.discovery.json
`,
    "discover-pack": `AgentMo discover-pack
Usage: agentmo discover-pack <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
This is manifest materialization only; it does not crawl or fetch source locations.
`,
    "discover-live": `AgentMo discover-live
Usage: agentmo discover-live <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <absent-dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Fetches only exact allowlisted HTTPS URLs under explicit size, timeout, redirect, address, and content-type bounds.
The resulting provenance proves bounded retrieval mechanics only; it does not certify semantic, domain, runtime, or production quality.
`,
    "discover-workspace": `AgentMo discover-workspace
Usage: agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Only approved repo-bound local files are read.
`,
    "agent-idea-candidate-report": AGENT_IDEA_CANDIDATE_REPORT_HELP,
    "discovery-approve": `AgentMo discovery-approve
Usage: agentmo discovery-approve <discovery.json> --discovery-db <agentmo-discovery-db.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <approval.json>] [--json]
Preview is write-free. Apply records local operator intent for enter-Plan only; it does not certify organizational authority, source quality, runtime, domain, package, or production readiness.
`,
    "need-report": `AgentMo need-report
Usage: agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
Contract: agentmo artifact-contract user-need --json
Valid example: examples/support-triage.need.json
`,
    "decision-ledger": `AgentMo decision-ledger
Usage:
  agentmo decision-ledger canonicalize-entry --entry <draft-entry.json> --out <absent-canonical-entry.json> [--json]
  agentmo decision-ledger append --journal <ledger.json> --entry <decision-entry.json> --digest decision-entry=sha256:<64hex> [--expected-head-digest sha256:<64hex>] [--json]
  agentmo decision-ledger inspect --journal <ledger.json> --digest decision-ledger=sha256:<64hex> [--json]
Contract: agentmo artifact-contract decision-entry --json
Canonicalize-entry creates a new absent canonical artifact and reports its exact digest before approval. It requires a caller-owned, non-group/world-writable output parent on the supported Darwin/Linux POSIX no-follow platforms. Append only verifies canonical bytes; it never sorts or rewrites an approved artifact. Successors require the exact current head digest. The Plan ledger accepts --expected-head-digest; --expected-head-sha256 is a Builder-only flag and is rejected here.
Canonicalize-entry is not a same-UID concurrent filesystem transaction: the caller must keep the output parent, private stage, and target namespace exclusively controlled and path-stable while it runs. Observable identity or symlink anomalies fail closed; it never rolls back a published output by pathname.
`,
    "design-plan": `AgentMo design-plan
Usage: agentmo design-plan <agentmo-discovery-db.json> --manifest <discovery.json> --discovery-approval <approval.json> --need <need.json> --decision-ledger <ledger.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest user-need=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]
The four file artifacts and exact current decision-ledger head are independently admitted. The approval proves local enter-Plan intent only.
`,
    "build-contract": `AgentMo build-contract
Usage: agentmo build-contract <blueprint.json> --design-plan <agentmo-design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --target-descriptor <descriptor.json> [--native-plugin-recipe <recipe.json> --digest native-plugin-recipe=sha256:<64hex>] --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --out <build-contract.json> --target openclaw [--json]
Creates construction intent only. It does not generate, install, load, execute, schedule, or certify an Agent Package.
`,
    "plan-approve": `AgentMo plan-approve
Usage: agentmo plan-approve <blueprint.json> --build-contract <build-contract.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <plan-approval.json>] [--json]
Preview is write-free. Apply records exact local enter-Produce intent only and does not certify package, runtime, domain, or production readiness.
`,
    "openclaw-target-describe": `AgentMo openclaw-target-describe
Usage: agentmo openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <descriptor.json> [--json]
Derives version, full revision, bounded display revision, Node range, member digests, retained identity basis, and target-root identity from exact first-party bytes. It does not certify source quality, installation, runtime, domain, or production readiness.
`,
    "openclaw-target-admit": `AgentMo openclaw-target-admit
Usage: agentmo openclaw-target-admit <blueprint.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <admission.json> [--json]
The command accepts no plugin implementation path, plugin bytes, MCP route, or activation authority.
`,
    "package-produce": `AgentMo package-produce
Usage: agentmo package-produce <blueprint.json> --design-plan <design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-carrier-admission <admission.json> --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest openclaw-target-carrier-admission=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent-dir> --archive <absent.d42> [--json]
The command re-admits every authority, writes only absent phase-local outputs, and does not install, activate, execute, schedule, or write credential values.
`,
    "package-inspect": `AgentMo package-inspect
Usage:
  agentmo package-inspect <directory> --manifest-sha256 sha256:<64hex> [--json]
  agentmo package-inspect <archive.d42> --archive-sha256 sha256:<64hex> [--json]
Contract: agentmo artifact-contract package-manifest --json
Inspection is offline and read-only. It verifies the complete manifest/inventory/member closure and does not install, activate, run OpenClaw, write credentials, register schedules, or certify runtime, domain, Birth, Delivery, or production behavior.
`,
    "openclaw-probe": `AgentMo openclaw-probe
Usage: agentmo openclaw-probe --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-root <dir> --out <probe.json> [--json]
Contract: agentmo artifact-contract openclaw-probe --json
The probe binds exact package and target authorities, invokes only fixed read-only capability surfaces with shell:false in a disposable synthetic HOME, and does not install, activate, connect MCP, invoke an agent, schedule work, use credentials, or certify runtime, domain, Birth, Delivery, or production readiness.
`,
    "openclaw-install-genesis": `AgentMo openclaw-install-genesis
Usage: agentmo openclaw-install-genesis --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <genesis-request.json> --request-sha256 sha256:<64hex> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent.json> [--json]
Publishes one create-only verified-absence authority. It performs no install, target mutation, OpenClaw process, credential, MCP, or runtime action.
`,
    "openclaw-install-preview": `AgentMo openclaw-install-preview
Usage: agentmo openclaw-install-preview --lifecycle install|upgrade|rollback|uninstall --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <preview-request.json> --request-sha256 sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> <exact lifecycle basis> --out <absent.json> [--json]
Install requires --absent-genesis plus its external digest. Upgrade/uninstall require --current-receipt plus its external digest. Rollback additionally requires exact predecessor receipt/archive pairs. No target mutation occurs.
Native branch: add --execution-profile native-chat --lifecycle install|activate --budget-root <canonical-budget-root>. Keep archive/source/probe/request digest pairs and target roots; omit fs-helper and legacy lifecycle basis flags. Request contains exactly target, nativeBinding and authorityRootBinding. Activation additionally requires --install-receipt <file> --install-receipt-sha256 sha256:<64hex> --native-authority-root <approved-independent-root> and re-admits exact installed files. Only publishes a preview; does not initialize authority or budget.
${OPENCLAW_RECEIPT_COMPANION_HELP}
`,
    "delivery-report": `AgentMo delivery-report
Native usage: agentmo delivery-report --execution-profile native-chat --blueprint <file> --blueprint-sha256 sha256:<64hex> --archive <archive.d42> --archive-sha256 sha256:<64hex> --install-plan <activate-plan.json> --install-plan-sha256 sha256:<64hex> --install-receipt <file> --install-receipt-sha256 sha256:<64hex> [--acceptance <native-chat-acceptance.json> --acceptance-sha256 sha256:<64hex>] [--json]
Exact native source companions replace legacy build/run/birth inputs. Missing or incomplete acceptance remains partial (exit 1). All fixed native observations must match the exact package, receipt, activation, Agent, model and session bindings; complete observations yield entry-verified. Global delivery/domain/production promotion remains false. Attestations do not authenticate reviewers or infer semantic correctness from hashes.
Legacy usage: agentmo delivery-report <blueprint.json> --digest blueprint=sha256:<64hex> --build-state <file> --digest build-state=sha256:<64hex> --run-state <file> --digest run-state=sha256:<64hex> --run-eval <file> --digest run-eval=sha256:<64hex> --birth-report <file> --digest birth-report=sha256:<64hex> [--domain-eval <file> --digest domain-eval=sha256:<64hex>] [--json]
`,
    "openclaw-native": `AgentMo openclaw-native
Usage:
  agentmo openclaw-native serve --execution-profile native-chat --lifecycle activate <exact native source/archive/probe/plan/approval digest pairs and roots> --install-receipt <file> --install-receipt-sha256 sha256:<64hex> --runtime-env-file <private-file> [--json]
  agentmo openclaw-native stop --install-plan <activate-plan.json> --install-plan-sha256 sha256:<64hex> --target-root <isolated-root> [--json]
Serve uses the same source/archive/probe/approval flags and roots as native install-apply, with an activate plan, three exact sensitive decisions, and no --out. It re-admits the installed package, receipt, root, workspace, independent authority and shared budget. The foreground supervisor owns its loopback gateway and budget proxy; it prints only agent/session/entry metadata. Credentials and the private gateway token never enter the URL or output. Use the private token file to authenticate in the native UI.
Stop authenticates to the live supervisor; it never kills a PID or takes over occupied ports. Restart requires fresh activation decisions for the same exact installation and preserves sessions and the budget ledger. Unknown supervisor remnants are rejected. This operation does not certify domain quality or production readiness.
`,
    "openclaw-install-approve": `AgentMo openclaw-install-approve
Usage: agentmo openclaw-install-approve --plan <install-plan.json> --plan-sha256 sha256:<64hex> --request <approval-request.json> --request-sha256 sha256:<64hex> --ordinary-out <absent.json> --sensitive-out <absent.json>... --conflict-out <absent.json> [--json]
Publishes independent create-only ordinary, per-sensitive-action, and exact-conflict authority files from one frozen plan. It performs no lifecycle effect.
`,
    "openclaw-fs-kernel-build": `AgentMo openclaw-fs-kernel-build
Usage: agentmo openclaw-fs-kernel-build --binary-out <absent-private-path> --receipt-out <absent-private-path> [--json]
Builds the repository-owned retained-dirfd helper with the fixed system compiler, fixed argv, shell:false, and a closed environment. Both outputs must be absent. It performs no OpenClaw target mutation and does not use executable lookup, downloads, package lifecycle hooks, or apply-time autobuild.
`,
    "openclaw-install-apply": `AgentMo openclaw-install-apply
Usage: agentmo openclaw-install-apply --lifecycle install|upgrade|rollback|uninstall --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --archive <archive.d42> --archive-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --install-plan <plan.json> --install-plan-sha256 sha256:<64hex> --ordinary-approval <approval.json> --ordinary-approval-sha256 sha256:<64hex> --sensitive-decision <decision.json> --sensitive-decision-sha256 sha256:<64hex> [--conflict-approval <approval.json> --conflict-approval-sha256 sha256:<64hex>] [--absent-genesis <genesis.json> --absent-genesis-sha256 sha256:<64hex> | --current-receipt <receipt.json> --current-receipt-sha256 sha256:<64hex> [--predecessor-receipt <receipt.json> --predecessor-receipt-sha256 sha256:<64hex> --predecessor-archive <archive.d42> --predecessor-archive-sha256 sha256:<64hex>]] --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-project-root> --out <absent-receipt.json> [--json]
Authority reservation requires --attempt-id <bounded-id>. The authority ledger path is derived from the exact target descriptor and reopened canonically; callers cannot select an authority or evidence root.
An exact --conflict-approval pair is required even when the approved conflict set is empty.
Native branch: add --execution-profile native-chat --lifecycle install --budget-root <canonical-budget-root> --native-authority-root <approved-independent-root>. Keep archive/source/probe/plan/approval digest pairs and target roots; provide exactly three sensitive decisions in plan order. Omit fs-helper, attempt-id and legacy predecessor/genesis flags. Consumes exact approvals, creates only an absent root, runs official setup --baseline --json, then verifies the sole agent and unchanged config/workspace. Never activates a gateway or invokes a model; incomplete results cannot retry with consumed authority.
${OPENCLAW_RECEIPT_COMPANION_HELP}
Every authority is re-read from exact published bytes with its caller-supplied SHA-256 before the private journal or target effect. The command accepts no package root, manifest-only, force, purge, blanket-overwrite, credential-value, raw-output, or MCP option. Receipt evidence is bounded lifecycle mechanism evidence only and does not certify runtime, domain, Birth, Delivery, production, or wider OpenClaw compatibility.
`,
  };
  return Object.hasOwn(entries, command) ? entries[command] : null;
}
