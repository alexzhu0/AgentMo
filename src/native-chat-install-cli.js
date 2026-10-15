import path from "node:path";
import { createHash } from "node:crypto";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { loadAdmittedArtifact } from "./artifact-admission.js";
import { admitPackageArchiveManifest } from "./package-archive.js";
import { buildOpenClawInstallPlan, validateOpenClawInstallPlan } from "./openclaw-install-plan.js";
import { installNativeChat, preflightNativeChatInstall, preflightNativeChatActivation } from "./native-chat-runtime.js";
import { assertNativeChatAbsentRoot, writeNativeChatFile } from "./native-chat-files.js";
import { serializePersistableJson } from "./persistability.js";

const sources = { blueprint: "blueprint", "build-contract": "build-contract", "plan-approval": "plan-approval",
  "target-descriptor": "openclaw-target-descriptor", "target-carrier-admission": "openclaw-target-carrier-admission", probe: "openclaw-probe" };
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export async function runNativeInstallCommand(command, args) {
  try {
    const { inputs, out } = await loadNativeChatInputs(command, args);
    const preview = command === "openclaw-install-preview";
    if (!preview && command !== "openclaw-install-apply") reject();
    let value;
    if (preview) {
      await (inputs.plan.lifecycle === "activate" ? preflightNativeChatActivation : preflightNativeChatInstall)(inputs);
      value = inputs.plan;
    } else value = await installNativeChat(inputs);
    const bytes = Buffer.from(serializePersistableJson(value, { subject: preview ? "openclaw-install-plan" : "openclaw-install-receipt" }));
    await writeNativeChatFile({ filePath: out, bytes });
    return { [preview ? "plan" : "receipt"]: value, digest: hash(bytes) };
  } catch { reject(); }
}

export async function loadNativeChatInputs(command, args) {
  try {
    const serve = command === "serve";
    const preview = command === "openclaw-install-preview";
    if (!serve && !preview && command !== "openclaw-install-apply") reject();
    const activate = serve || args[args.indexOf("--lifecycle") + 1] === "activate";
    if (activate && !serve && !preview) reject();
    const artifacts = [...Object.keys(sources), ...preview ? ["request"] : ["install-plan", "ordinary-approval", "conflict-approval"], ...activate ? ["install-receipt"] : []];
    const required = ["execution-profile", "lifecycle", "archive", "archive-sha256", "target-root", "openclaw-target-root", "budget-root", ...serve ? ["runtime-env-file"] : ["out"],
      ...artifacts.flatMap(k => [k, `${k}-sha256`]), ...preview && !activate ? [] : ["native-authority-root"]];
    const repeated = preview ? [] : ["sensitive-decision", "sensitive-decision-sha256"], o = {};
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith("--")) reject();
      const key = args[i].slice(2);
      if (key === "json") { if (o.json) reject(); o.json = true; continue; }
      if (![...required, ...repeated].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) reject();
      const value = args[++i];
      if (repeated.includes(key)) (o[key] ??= []).push(value);
      else { if (Object.hasOwn(o, key)) reject(); o[key] = value; }
    }
    if (required.some(k => !o[k]) || o["execution-profile"] !== "native-chat" || o.lifecycle !== (activate ? "activate" : "install")) reject();
    const stateRoot = absolute(o["target-root"]), budgetRoot = absolute(o["budget-root"]), out = serve ? null : absolute(o.out);
    const authorityRoot = preview && !activate ? null : absolute(o["native-authority-root"]);
    for (const root of [stateRoot, budgetRoot, authorityRoot, absolute(o["openclaw-target-root"])].filter(Boolean)) {
      if (out && (out === root || out.startsWith(`${root}${path.sep}`))) reject();
    }
    if (out) await assertNativeChatAbsentRoot(out);
    const archivePath = absolute(o.archive), archive = await admitPackageArchiveManifest({ archivePath, expectedArchiveDigest: o["archive-sha256"] });
    const admitted = {};
    for (const key of ["blueprint", "build-contract", "plan-approval", "target-descriptor"]) {
      admitted[sources[key]] = await loadAdmittedArtifact({ subject: sources[key], filePath: absolute(o[key]), expectedDigest: o[`${key}-sha256`] });
    }
    const carrier = await loadAdmittedArtifact({ subject: "openclaw-target-carrier-admission", filePath: absolute(o["target-carrier-admission"]),
      expectedDigest: o["target-carrier-admission-sha256"], companions: admitted });
    const descriptorAdmission = admitted["openclaw-target-descriptor"];
    const probeAdmission = await loadAdmittedArtifact({ subject: "openclaw-probe", filePath: absolute(o.probe), expectedDigest: o["probe-sha256"],
      companions: { "package-manifest": archive.manifest, "openclaw-target-carrier-admission": carrier, "openclaw-target-descriptor": descriptorAdmission } });
    if (admitted.blueprint.value.execution_profile !== "native-chat" || admitted["build-contract"].value.execution_profile !== "native-chat") reject();
    const executablePath = path.join(absolute(o["openclaw-target-root"]), descriptorAdmission.value.members.find(m => m.role === "executable").relativePath);
    const installReceipt = activate ? await readNativeChatJson(o["install-receipt"], o["install-receipt-sha256"]) : null;
    let plan;
    if (preview) {
      const request = await readNativeChatJson(o.request, o["request-sha256"]);
      if (Object.keys(request).sort().join(",") !== "authorityRootBinding,nativeBinding,target") reject();
      const observation = probeAdmission.value.cli.observations.find(x => x.id === "config-validation");
      plan = buildOpenClawInstallPlan({ execution_profile: "native-chat", lifecycle: o.lifecycle, ...request,
        ...activate ? { predecessor: { kind: "installed-native-root", installPlanDigest: installReceipt.installPlanDigest, installReceiptDigest: o["install-receipt-sha256"], rootIdentity: installReceipt.rootIdentity } } : {},
        archiveBinding: { archiveSha256: o["archive-sha256"], manifestDigest: archive.manifestDigest, inventoryDigest: archive.inventoryDigest, members: archive.members },
        officialConfigDryRun: { commandDigest: hash(jsonBytes(observation.argv)), resultDigest: observation.standardOutputFacts.digest, accepted: true } });
    } else plan = await readNativeChatJson(o["install-plan"], o["install-plan-sha256"]);
    if (!validateOpenClawInstallPlan(plan).ok || plan.execution_profile !== "native-chat" || plan.lifecycle !== o.lifecycle || plan.archiveBinding.archiveSha256 !== o["archive-sha256"]
      || plan.nativeBinding.modelProfile !== admitted.blueprint.value.native_model_profile
      || plan.nativeBinding.modelProfile !== admitted["build-contract"].value.specification.runtimeBinding.modelProfile) reject();
    const shared = { plan, archivePath, executablePath, stateRoot, budgetRoot, descriptorAdmission, probeAdmission,
      blueprintAdmission: admitted.blueprint, buildContractAdmission: admitted["build-contract"], ...activate ? { installReceipt, authorityRoot } : {} };
    let decisions = {};
    if (!preview) {
      if (repeated.some(k => o[k]?.length !== 3) || new Set(o["sensitive-decision"]).size !== 3) reject();
      const ordinaryApproval = await readNativeChatJson(o["ordinary-approval"], o["ordinary-approval-sha256"]);
      const conflictApproval = await readNativeChatJson(o["conflict-approval"], o["conflict-approval-sha256"]);
      const sensitiveDecisions = await Promise.all(o["sensitive-decision"].map((p, i) => readNativeChatJson(p, o["sensitive-decision-sha256"][i])));
      decisions = { authorityRoot, ordinaryApproval, sensitiveDecisions, conflictApproval };
    }
    return { inputs: { ...shared, ...decisions }, out, runtimeEnvFile: serve ? absolute(o["runtime-env-file"]) : null, json: o.json === true };
  } catch { reject(); }
}

export async function readNativeChatJson(file, expected) {
  const bytes = await readBoundedNoFollowFile(absolute(file), 4 * 1024 * 1024);
  if (!/^sha256:[a-f0-9]{64}$/u.test(expected ?? "") || hash(bytes) !== expected) reject();
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!jsonBytes(value).equals(bytes)) reject();
  return value;
}
function absolute(value) { if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes("\0")) reject(); return value; }
function reject() { throw Object.assign(new Error("Native installation request was rejected."), { code: "AGENTMO_NATIVE_INSTALL_REJECTED" }); }
