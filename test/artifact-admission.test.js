import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ArtifactAdmissionError,
  admittedArtifactProvenance,
  digestRawBytes,
  loadAdmittedArtifact,
  parseDigestBindings,
} from "../src/artifact-admission.js";
import { getArtifactContract } from "../src/artifact-contract.js";
import {
  DURABLE_ARTIFACT_REGISTRY,
  listDurableArtifactDescriptors,
} from "../src/artifact-registry.js";
import {
  OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
  validateOpenClawInstallReceipt,
} from "../src/openclaw-install-receipt.js";
import {
  probeOpenClawTarget,
} from "../src/openclaw-probe.js";
import { produceAgentPackage } from "../src/package-produce.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";
import {
  buildAndAdmitRuntimePlan as createAdmittedRuntimePlan,
  executeAdmittedRuntimeRun,
} from "./helpers/admitted-runtime.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const SUPPORT_DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const DISCOVERY_DB = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const USER_NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const DECISION_ENTRY = fileURLToPath(new URL("../examples/support-triage.decision-entry.json", import.meta.url));
const SUPPORT_BLUEPRINT = fileURLToPath(new URL("../examples/support-triage.agentmo.json", import.meta.url));
const PACKAGE_MANIFEST = fileURLToPath(new URL(
  "../.planning/phases/04-package/04-03-agent-package/agentmo.package.json",
  import.meta.url,
));

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function openClawInstallReceipt(overrides = {}) {
  const receipt = structuredClone(
    getArtifactContract("openclaw-install-receipt").minimalTemplate,
  );
  return Object.assign(receipt, overrides);
}

async function createDiscoveryApproval(root) {
  const out = path.join(root, "agentmo-discovery-approval.json");
  const manifestDigest = sha256(await readFile(SUPPORT_DISCOVERY));
  const dbDigest = sha256(await readFile(DISCOVERY_DB));
  const base = [
    "discovery-approve",
    SUPPORT_DISCOVERY,
    "--discovery-db",
    DISCOVERY_DB,
    "--digest",
    `discovery-manifest=${manifestDigest}`,
    "--digest",
    `discovery-db=${dbDigest}`,
    "--json",
  ];
  const preview = await runCli(base);
  assert.equal(preview.code, 0, preview.stderr);
  const apply = await runCli([
    ...base,
    "--approve",
    "--preview-digest",
    JSON.parse(preview.stdout).previewDigest,
    "--out",
    out,
  ]);
  assert.equal(apply.code, 0, apply.stderr);
  return out;
}

async function createDecisionLedger(root) {
  const journal = path.join(root, "decision-ledger.json");
  const result = await runCli([
    "decision-ledger",
    "append",
    "--journal",
    journal,
    "--entry",
    DECISION_ENTRY,
    "--digest",
    `decision-entry=${sha256(await readFile(DECISION_ENTRY))}`,
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  return {
    journal,
    headDigest: JSON.parse(result.stdout).head.digest,
  };
}

function redactedSummary(text) {
  return {
    kind: "RedactedSummary",
    summaryKind: text.length === 0 ? "empty" : "structured-json-summary",
    sha256: createHash("sha256").update(text).digest("hex"),
    length: Buffer.byteLength(text),
    redactedLength: Buffer.byteLength(text),
    text,
    redacted: true,
  };
}

async function rejectsWithCode(operation, code, forbidden = []) {
  await assert.rejects(operation, (error) => {
    if (code.startsWith("AGENTMO_ARTIFACT_")) {
      assert.equal(error instanceof ArtifactAdmissionError, true);
    }
    assert.equal(error.code, code);
    const serialized = JSON.stringify(error);
    for (const value of forbidden) {
      assert.equal(error.message.includes(value), false);
      assert.equal(serialized.includes(value), false);
    }
    return true;
  });
}

describe("artifact admission", () => {
  it("rejects self-auth probe bytes unless the registry receives real companion admissions", async () => {
    const fixture = await buildApprovedPackageFixture();
    const archivePath = path.join(fixture.root, "artifact-probe.d42");
    const produced = await produceAgentPackage(packageProduceOptions(
      fixture,
      path.join(fixture.root, "artifact-probe-package"),
      archivePath,
    ));
    const probe = await probeOpenClawTarget({
      archivePath,
      expectedArchiveDigest: produced.archiveDigest,
      blueprintPath: fixture.paths.blueprint,
      expectedBlueprintDigest: fixture.digests.blueprint,
      buildContractPath: fixture.paths["build-contract"],
      expectedBuildContractDigest: fixture.digests["build-contract"],
      planApprovalPath: fixture.paths["plan-approval"],
      expectedPlanApprovalDigest: fixture.digests["plan-approval"],
      targetCarrierAdmissionPath:
        fixture.paths["openclaw-target-carrier-admission"],
      expectedTargetCarrierAdmissionDigest:
        fixture.digests["openclaw-target-carrier-admission"],
      targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
      expectedTargetDescriptorDigest:
        fixture.digests["openclaw-target-descriptor"],
      targetRoot: path.dirname(fixture.inputs.targetFiles.packageJsonPath),
    });
    const descriptor = DURABLE_ARTIFACT_REGISTRY.find(
      ({ subject }) => subject === "openclaw-probe",
    );

    assert.equal(descriptor.validate_canonical_input(structuredClone(probe)), false);
  });

  it("keeps the registry closed to the canonical stage and runtime artifact descriptors", () => {
    assert.equal(Object.isFrozen(DURABLE_ARTIFACT_REGISTRY), true);
    assert.deepEqual(
      DURABLE_ARTIFACT_REGISTRY.map((descriptor) => descriptor.subject),
      [
        "discovery-manifest",
        "discovery-db",
        "discovery-approval",
        "user-need",
        "decision-entry",
        "decision-ledger",
        "design-plan",
        "blueprint",
        "openclaw-target-descriptor",
        "build-contract",
        "native-plugin-recipe",
        "plan-approval",
        "openclaw-target-carrier-admission",
        "package-manifest",
        "openclaw-probe",
        "openclaw-install-private-journal",
        "openclaw-install-post-state",
        "openclaw-official-action-result",
        "openclaw-install-finalization",
        "openclaw-install-receipt",
        "openclaw-absent-genesis",
        "openclaw-install-plan",
        "openclaw-install-approval",
        "openclaw-sensitive-action-decision",
        "openclaw-conflict-approval",
        "handoff",
        "build-state",
        "runtime-plan",
        "run-state",
        "run-index",
        "observation",
        "report",
        "run-eval",
        "birth-report",
        "domain-cases",
        "domain-eval",
        "delivery-report",
      ],
    );
    assert.equal(DURABLE_ARTIFACT_REGISTRY.every(Object.isFrozen), true);
    const receiptDescriptor = DURABLE_ARTIFACT_REGISTRY.find(
      ({ subject }) => subject === "openclaw-install-receipt",
    );
    assert.deepEqual(receiptDescriptor.required_companion_subjects, [
      "openclaw-install-plan",
      "openclaw-install-approval",
      "openclaw-sensitive-action-decision",
      "openclaw-conflict-approval",
      "openclaw-install-private-journal",
      "openclaw-probe",
      "openclaw-target-descriptor",
      "openclaw-install-post-state",
      "openclaw-official-action-result",
      "openclaw-install-finalization",
    ]);
    assert.deepEqual(receiptDescriptor.repeatable_companion_subjects, {
      "openclaw-sensitive-action-decision": {
        semanticOrder: "install-plan-sensitive-actions",
      },
      "openclaw-official-action-result": {
        semanticOrder: "install-plan-sensitive-actions",
      },
    });
    assert.deepEqual(
      listDurableArtifactDescriptors().map((descriptor) => descriptor.identity),
      [
        "agentmo.discovery.v1",
        "agentmo.discovery-db.v1",
        "agentmo.discovery-approval.v1",
        "agentmo.user-need.v1",
        "agentmo.decision-entry.v1",
        "agentmo.decision-ledger.v1",
        "agentmo.design-plan.v1",
        "0.1",
        "agentmo.openclaw-target-descriptor.v1",
        "agentmo.build-contract.v1",
        "agentmo.native-plugin-recipe.v1",
        "agentmo.plan-approval.v1",
        "agentmo.openclaw-target-carrier-admission.v1",
        "agentmo.package-manifest.v1",
        "agentmo.openclaw-probe.v1",
        "agentmo.openclaw-install-private-journal.v1",
        "agentmo.openclaw-install-post-state.v1",
        "agentmo.openclaw-official-action-result.v1",
        "agentmo.openclaw-install-finalization.v1",
        "agentmo.openclaw-install-receipt.v1",
        "agentmo.openclaw-absent-genesis.v1",
        "agentmo.openclaw-install-plan.v1",
        "agentmo.openclaw-install-approval.v1",
        "agentmo.openclaw-sensitive-action-decision.v1",
        "agentmo.openclaw-conflict-approval.v1",
        "agentmo.handoff.v1",
        "agentmo.build-state.v1",
        "agentmo.runtime-plan.v1",
        "agentmo.run.v1",
        "agentmo.run-index.v1",
        "agentmo.observation.v1",
        "agentmo_report",
        "agentmo.run-eval.v1",
        "agentmo.birth-report.v1",
        "agentmo.domain-cases.v1",
        "agentmo.domain-eval.v1",
        "agentmo.delivery.v1",
      ],
    );
  });

  it("does not let generic JSON plus an external digest mint post-effect producer authority", async () => {
    const root = await mkdtemp(path.join(
      tmpdir(),
      "agentmo-post-effect-generic-admission-",
    ));
    for (const subject of [
      "openclaw-install-post-state",
      "openclaw-official-action-result",
      "openclaw-install-finalization",
    ]) {
      const value = getArtifactContract(subject).minimalTemplate;
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      const filePath = path.join(root, `${subject}.json`);
      await writeFile(filePath, bytes);
      await rejectsWithCode(
        () => loadAdmittedArtifact({
          filePath,
          subject,
          expectedDigest: sha256(bytes),
        }),
        "AGENTMO_ARTIFACT_PRODUCER_AUTHORITY_REQUIRED",
      );
    }
  });

  it("validates complete and incomplete receipt closure without self-certification", () => {
    const complete = openClawInstallReceipt();
    assert.equal(
      OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
      "agentmo.openclaw-install-receipt.v1",
    );
    assert.equal(validateOpenClawInstallReceipt(complete).ok, true);
    const contract = getArtifactContract("openclaw-install-receipt");
    assert.equal(contract.identity, OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION);
    assert.equal(
      validateOpenClawInstallReceipt(contract.minimalTemplate).ok,
      true,
    );
    assert.equal(Object.hasOwn(contract.minimalTemplate, "receiptDigest"), false);

    const incomplete = openClawInstallReceipt({
      status: "incomplete",
      managedResults: [{
        ...openClawInstallReceipt().managedResults[0],
        afterDigest: null,
        afterFileIdentity: null,
        disposition: "failed",
        postStateMatches: false,
        rollbackDisposition: "recovery-required",
        reasonCode: "publication-not-observed",
      }],
      preservedAssets: [{
        path: ".openclaw/projects/replace-with-project/AGENTS.md",
        observedDigest: null,
        reasonCode: "publication-not-observed",
      }],
      recovery: {
        required: true,
        disposition: "preserved",
        removedAssets: [],
        preservedAssets: [{
          path: ".openclaw/projects/replace-with-project/AGENTS.md",
          digest: null,
        }],
        reasons: ["publication-not-observed"],
      },
      incompleteReasons: ["publication-not-observed"],
    });
    assert.equal(validateOpenClawInstallReceipt(incomplete).ok, true);

    for (const mutate of [
      (value) => { value.unknown = true; },
      (value) => { value.schemaVersion = "agentmo.openclaw-install-receipt.v2"; },
      (value) => { value.receiptDigest = sha256(Buffer.from("self", "utf8")); },
      (value) => { value.authorityLedger.archive.members.pop(); },
      (value) => {
        value.authorityLedger.archive.inventoryDigest =
          sha256(Buffer.from("drift", "utf8"));
      },
      (value) => { value.predecessor = {}; },
      (value) => { value.lineage.predecessorReceiptDigest = sha256(Buffer.from("unexpected", "utf8")); },
      (value) => { value.approvals.ordinary = null; },
      (value) => { value.nonceConsumption.markers[0].consumed = false; },
      (value) => { value.managedResults[0].postStateMatches = false; },
      (value) => { value.recovery.required = true; },
      (value) => { value.certificationBoundary.runtime = true; },
      (value) => { value.certificationBoundary.domain = true; },
      (value) => { value.rawStdout = "must-not-persist"; },
    ]) {
      const candidate = structuredClone(complete);
      mutate(candidate);
      assert.equal(validateOpenClawInstallReceipt(candidate).ok, false);
    }
  });

  it("binds upgrade, uninstall and rollback receipts to exact predecessor authority", () => {
    const current = {
      identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
      subject: "openclaw-install-receipt",
      digest: sha256(Buffer.from("current-receipt", "utf8")),
    };
    const selected = {
      identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
      subject: "openclaw-install-receipt",
      digest: sha256(Buffer.from("selected-receipt", "utf8")),
    };
    for (const lifecycle of ["upgrade", "uninstall"]) {
      const candidate = openClawInstallReceipt({
        lifecycle,
        predecessor: { kind: "current-receipt", currentReceipt: current },
        lineage: {
          sequence: 1,
          predecessorReceiptDigest: current.digest,
          selectedPredecessorReceiptDigest: null,
        },
      });
      assert.equal(validateOpenClawInstallReceipt(candidate).ok, true);
    }
    const rollback = openClawInstallReceipt({
      lifecycle: "rollback",
      authorityLedger: {
        ...openClawInstallReceipt().authorityLedger,
        archive: structuredClone(
          openClawInstallReceipt().authorityLedger.archive,
        ),
      },
      predecessor: {
        kind: "rollback-receipts",
        currentReceipt: current,
        selectedPredecessorReceipt: selected,
        selectedPredecessorArchiveBinding: structuredClone(
          openClawInstallReceipt().authorityLedger.archive,
        ),
      },
      lineage: {
        sequence: 2,
        predecessorReceiptDigest: current.digest,
        selectedPredecessorReceiptDigest: selected.digest,
      },
    });
    assert.equal(validateOpenClawInstallReceipt(rollback).ok, true);
    const drifted = structuredClone(rollback);
    drifted.predecessor.selectedPredecessorArchiveBinding.archiveSha256 =
      sha256(Buffer.from("other-archive", "utf8"));
    assert.equal(validateOpenClawInstallReceipt(drifted).ok, false);
  });

  it("requires external companions even when receipt bytes and digest are exact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-receipt-admission-"));
    const file = path.join(root, "receipt.json");
    const otherFile = path.join(root, "other-receipt.json");
    const value = openClawInstallReceipt();
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    const otherBytes = Buffer.from(`${JSON.stringify({
      ...value,
      authorityLedger: {
        ...value.authorityLedger,
        target: {
          ...value.authorityLedger.target,
          projectId: "other-project",
        },
      },
    }, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);
    await writeFile(otherFile, otherBytes);

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
      }),
      "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
    );
    const fakeAdmission = {
      identity: "agentmo.openclaw-install-plan.v1",
      subject: "openclaw-install-plan",
      digest: sha256(Buffer.from("fake-admission", "utf8")),
      value: {},
    };
    const forgedCompanions = {
      "openclaw-install-plan": fakeAdmission,
      "openclaw-install-approval": fakeAdmission,
      "openclaw-sensitive-action-decision": [],
      "openclaw-conflict-approval": fakeAdmission,
      "openclaw-install-private-journal": fakeAdmission,
      "openclaw-probe": fakeAdmission,
      "openclaw-target-descriptor": fakeAdmission,
      "openclaw-install-post-state": fakeAdmission,
      "openclaw-official-action-result": [],
      "openclaw-install-finalization": fakeAdmission,
    };
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
        companions: forgedCompanions,
      }),
      "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
        companions: {
          ...forgedCompanions,
          "openclaw-install-plan": [fakeAdmission],
        },
      }),
      "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
        companions: {
          ...forgedCompanions,
          extra: fakeAdmission,
        },
      }),
      "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
    );

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "package-manifest",
        expectedDigest: sha256(bytes),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: otherFile,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(Buffer.from("stale", "utf8")),
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );

    await writeFile(file, Buffer.concat([bytes, Buffer.from(" ")]));
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(bytes),
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );

    const duplicate = Buffer.from(bytes.toString("utf8").replace(
      `"schemaVersion": "${OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION}",`,
      `"schemaVersion": "${OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION}",\n  "schemaVersion": "${OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION}",`,
    ), "utf8");
    await writeFile(file, duplicate);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "openclaw-install-receipt",
        expectedDigest: sha256(duplicate),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
  });

  it("fresh processes expose all five lifecycle authority contracts after receipt registration", async () => {
    const expected = new Map([
      ["openclaw-absent-genesis", "agentmo.openclaw-absent-genesis.v1"],
      ["openclaw-install-plan", "agentmo.openclaw-install-plan.v1"],
      ["openclaw-install-approval", "agentmo.openclaw-install-approval.v1"],
      [
        "openclaw-sensitive-action-decision",
        "agentmo.openclaw-sensitive-action-decision.v1",
      ],
      ["openclaw-conflict-approval", "agentmo.openclaw-conflict-approval.v1"],
    ]);
    for (const [subject, identity] of expected) {
      const result = await runCli(["artifact-contract", subject, "--json"]);
      assert.equal(result.code, 0, result.stderr);
      const contract = JSON.parse(result.stdout);
      assert.equal(contract.subject, subject);
      assert.equal(contract.identity, identity);
      assert.equal(Object.values(contract.certificationBoundary).includes(true), false);
    }
  });

  it("exact-admits package-manifest bytes and rejects digest, subject, duplicate identity, or forged result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-package-manifest-admission-"));
    const bytes = await readFile(PACKAGE_MANIFEST);
    const file = path.join(root, "agentmo.package.json");
    await writeFile(file, bytes);
    const admission = await loadAdmittedArtifact({
      filePath: file,
      subject: "package-manifest",
      expectedDigest: sha256(bytes),
    });
    assert.equal(admission.identity, "agentmo.package-manifest.v1");
    assert.equal(admission.subject, "package-manifest");

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "package-manifest",
        expectedDigest: sha256("wrong"),
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [root],
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "build-contract",
        expectedDigest: sha256(bytes),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root],
    );

    const duplicate = Buffer.from(bytes.toString("utf8").replace(
      '"schemaVersion": "agentmo.package-manifest.v1",',
      '"schemaVersion": "agentmo.package-manifest.v1",\n  "schemaVersion": "agentmo.package-manifest.v1",',
    ), "utf8");
    await writeFile(file, duplicate);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "package-manifest",
        expectedDigest: sha256(duplicate),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root],
    );

    const forged = Object.freeze({ ...admission });
    assert.throws(
      () => admittedArtifactProvenance(forged, {
        subject: "package-manifest",
        value: admission.value,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("keeps report and evidence descriptors strict instead of accepting identity-only objects", () => {
    const descriptors = new Map(DURABLE_ARTIFACT_REGISTRY.map((descriptor) => [descriptor.subject, descriptor]));
    const identityOnly = {
      report: { kind: "agentmo_report" },
      "run-eval": { schemaVersion: "agentmo.run-eval.v1" },
      "birth-report": { schemaVersion: "agentmo.birth-report.v1" },
      "domain-cases": { schemaVersion: "agentmo.domain-cases.v1" },
      "domain-eval": { schemaVersion: "agentmo.domain-eval.v1" },
      "delivery-report": { schemaVersion: "agentmo.delivery.v1" },
    };
    for (const [subject, candidate] of Object.entries(identityOnly)) {
      assert.equal(descriptors.get(subject).validate_canonical_input(candidate), false);
    }
  });

  it("admits exact runtime-plan bytes and rejects byte mutation or a run-state subject swap", async () => {
    const blueprintAdmission = await admitBlueprint(SUPPORT_BLUEPRINT);
    const fixture = await createAdmittedRuntimePlan(blueprintAdmission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-runtime-workspace",
      message: "ping",
    });

    assert.equal(fixture.runtimePlanAdmission.identity, "agentmo.runtime-plan.v1");
    assert.equal(fixture.runtimePlanAdmission.subject, "runtime-plan");
    const mutatedBytes = Buffer.concat([fixture.runtimePlanBytes, Buffer.from(" ")]);
    await writeFile(fixture.runtimePlanFile, mutatedBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: fixture.runtimePlanFile,
        subject: "runtime-plan",
        expectedDigest: fixture.runtimePlanAdmission.digest,
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [fixture.runtimePlanFile],
    );

    await writeFile(fixture.runtimePlanFile, fixture.runtimePlanBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: fixture.runtimePlanFile,
        subject: "run-state",
        expectedDigest: fixture.runtimePlanAdmission.digest,
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [fixture.runtimePlanFile],
    );
  });

  it("admits exact observation bytes and rejects mutation, family swap, or unknown identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-observation-admission-"));
    const file = path.join(root, "observation.json");
    const observation = {
      schemaVersion: "agentmo.observation.v1",
      agentId: "support-triage",
      source: {
        identity: "agentmo.run.v1",
        subject: "run-state",
        digest: `sha256:${"a".repeat(64)}`,
      },
      failureMode: "declared evidence only",
      proposedRegression: {
        id: "support-triage-observation-fixture",
        description: "Preserve declared runtime evidence coverage.",
        expectedEvidence: "A bounded reviewed runtime evidence result.",
      },
      recommendedBlueprintChange: {
        section: "runtime_profiles",
        proposal: "Review the evidence before proposing any governed change.",
      },
      status: "proposed",
      runEvidence: {
        runId: "observation-fixture",
        parentRunId: null,
        targetId: "openclaw",
        runtime: "openclaw",
        provider: null,
        model: null,
        channel: "local-cli",
        transport: "local",
        fallbackFrom: null,
        executionStatus: "declared",
        exitCode: null,
        timedOut: false,
        replayFidelity: "unavailable",
        stdoutSummary: redactedSummary(""),
        stderrSummary: redactedSummary(""),
        certificationBoundary: {
          runtimeCertifiedByRun: false,
          domainCertifiedByRun: false,
        },
      },
      mutation: {
        autoApplied: false,
        blueprintMutated: false,
        scaffoldMutated: false,
        runtimeMutated: false,
        evalsMutated: false,
        reason: "Observation evidence is proposal-only.",
      },
    };
    const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);

    const admission = await loadAdmittedArtifact({
      filePath: file,
      subject: "observation",
      expectedDigest: sha256(bytes),
    });
    assert.equal(admission.identity, "agentmo.observation.v1");
    assert.equal(admission.subject, "observation");

    await writeFile(file, Buffer.concat([bytes, Buffer.from(" ")]));
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "observation", expectedDigest: admission.digest }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [file],
    );

    await writeFile(file, bytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "run-state", expectedDigest: admission.digest }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );

    const unknownBytes = Buffer.from(`${JSON.stringify({ ...observation, schemaVersion: "agentmo.observation.unknown" }, null, 2)}\n`, "utf8");
    await writeFile(file, unknownBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "observation", expectedDigest: sha256(unknownBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );
  });

  it("rejects nested provenance duplicate members before JSON last-wins parsing", async () => {
    const blueprintAdmission = await admitBlueprint(SUPPORT_BLUEPRINT);
    const { runState } = await executeAdmittedRuntimeRun(blueprintAdmission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-runtime-workspace",
      message: "ping",
      runId: "duplicate-provenance-run",
      now: "2026-07-12T00:00:00.000Z",
    });
    const original = `"identity": "agentmo.runtime-plan.v1"`;
    const duplicate = `${original},\n      ${original}`;
    const raw = `${JSON.stringify(runState, null, 2).replace(original, duplicate)}\n`;
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-run-duplicate-provenance-"));
    const file = path.join(directory, "run-state.json");
    const bytes = Buffer.from(raw, "utf8");
    await writeFile(file, bytes);

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "run-state",
        expectedDigest: digestRawBytes(bytes),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );
  });

  it("hashes only exact Buffer bytes using the canonical digest syntax", () => {
    const bytes = Buffer.from("{\"schemaVersion\":\"agentmo.discovery-db.v1\"}\n", "utf8");
    assert.equal(digestRawBytes(bytes), sha256(bytes));
    assert.throws(
      () => digestRawBytes({ schemaVersion: "agentmo.discovery-db.v1" }),
      (error) => error.code === "AGENTMO_ARTIFACT_BYTES_REQUIRED",
    );
  });

  it("parses an exact, frozen, one-to-one binding map", () => {
    const first = `sha256:${"a".repeat(64)}`;
    const second = `sha256:${"b".repeat(64)}`;
    const bindings = parseDigestBindings(
      [`discovery-db=${first}`, `user-need=${second}`],
      ["discovery-db", "user-need"],
    );
    assert.equal(Object.getPrototypeOf(bindings), null);
    assert.equal(Object.isFrozen(bindings), true);
    assert.deepEqual({ ...bindings }, {
      "discovery-db": first,
      "user-need": second,
    });

    const cases = [
      { values: [`discovery-db=${first}`], code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED" },
      { values: [`discovery-db=${first}`, `discovery-db=${first}`, `user-need=${second}`], code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE" },
      { values: [`discovery-db=${first}`, `user-need=${second}`, `private-subject-canary=${first}`], code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT" },
      { values: ["discovery-db=not-a-digest", `user-need=${second}`], code: "AGENTMO_ARTIFACT_DIGEST_INVALID" },
      { values: [`discovery-db=${first}`, `user-need=${second}=trailing`], code: "AGENTMO_ARTIFACT_DIGEST_INVALID" },
    ];
    for (const testCase of cases) {
      assert.throws(
        () => parseDigestBindings(testCase.values, ["discovery-db", "user-need"]),
        (error) => {
          assert.equal(error.code, testCase.code);
          assert.equal(error.message.includes("private-subject-canary"), false);
          return true;
        },
      );
    }
  });

  it("admits canonical discovery-db and user-need bytes only after exact digest proof", async () => {
    const dbBytes = await readFile(DISCOVERY_DB);
    const needBytes = await readFile(USER_NEED);
    const db = await loadAdmittedArtifact({
      filePath: DISCOVERY_DB,
      subject: "discovery-db",
      expectedDigest: sha256(dbBytes),
    });
    const need = await loadAdmittedArtifact({
      filePath: USER_NEED,
      subject: "user-need",
      expectedDigest: sha256(needBytes),
    });
    assert.equal(db.subject, "discovery-db");
    assert.equal(db.identity, "agentmo.discovery-db.v1");
    assert.equal(db.digest, sha256(dbBytes));
    assert.equal(db.value.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(need.subject, "user-need");
    assert.equal(need.identity, "agentmo.user-need.v1");
    assert.equal(need.value.schemaVersion, "agentmo.user-need.v1");
    assert.equal(Object.isFrozen(db.value), true);
    assert.deepEqual(admittedArtifactProvenance(db, {
      subject: "discovery-db",
      value: db.value,
    }), {
      identity: "agentmo.discovery-db.v1",
      subject: "discovery-db",
      digest: sha256(dbBytes),
    });
    const forged = Object.freeze({ ...db });
    assert.throws(
      () => admittedArtifactProvenance(forged, { subject: "discovery-db", value: db.value }),
      (error) => error.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("rejects host absolute paths centrally across durable families while preserving portable references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-host-path-"));
    const hostPath = "/Users/private-agentmo/should-not-persist.txt";
    const cases = [
      {
        subject: "discovery-manifest",
        source: SUPPORT_DISCOVERY,
        mutate: (value) => { value.source_inventory[0].description = hostPath; },
      },
      {
        subject: "discovery-db",
        source: DISCOVERY_DB,
        mutate: (value) => { value.facts[0].text = hostPath; },
      },
      {
        subject: "user-need",
        source: USER_NEED,
        mutate: (value) => { value.problem = hostPath; },
      },
      {
        subject: "blueprint",
        source: SUPPORT_BLUEPRINT,
        mutate: (value) => { value.runtime_profiles[0].purpose = hostPath; },
      },
    ];
    const descriptors = new Map(DURABLE_ARTIFACT_REGISTRY.map((descriptor) => [descriptor.subject, descriptor]));

    for (const [index, testCase] of cases.entries()) {
      const value = JSON.parse(await readFile(testCase.source, "utf8"));
      testCase.mutate(value);
      assert.equal(
        descriptors.get(testCase.subject).validate_canonical_input(value),
        true,
        `${testCase.subject} probe must remain schema-permitted so admission owns the boundary`,
      );
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      const file = path.join(root, `candidate-${index}.json`);
      await writeFile(file, bytes);
      await rejectsWithCode(
        () => loadAdmittedArtifact({ filePath: file, subject: testCase.subject, expectedDigest: sha256(bytes) }),
        "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
        [root, hostPath, "private-agentmo"],
      );
    }

    const portable = JSON.parse(await readFile(SUPPORT_DISCOVERY, "utf8"));
    portable.source_inventory[0].location = "https://example.com/support/policy";
    portable.source_inventory[0].extraction_fields.push("managed/reference.md");
    portable.source_inventory[0].extraction_fields.push("./bin/agentmo.js");
    portable.source_inventory[0].extraction_fields.push("../pi/reference.md");
    const portableBytes = Buffer.from(`${JSON.stringify(portable, null, 2)}\n`, "utf8");
    const portableFile = path.join(root, "portable.json");
    await writeFile(portableFile, portableBytes);
    const admitted = await loadAdmittedArtifact({
      filePath: portableFile,
      subject: "discovery-manifest",
      expectedDigest: sha256(portableBytes),
    });
    assert.equal(admitted.value.source_inventory[0].location, "https://example.com/support/policy");
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("managed/reference.md"), true);
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("./bin/agentmo.js"), true);
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("../pi/reference.md"), true);
  });

  it("rejects byte replacement before decode, identity inspection, parse, or validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-order-"));
    const invalidUtf8 = path.join(root, "private-invalid-canary.json");
    const invalidBytes = Buffer.from([0xff, 0xfe, 0xfd]);
    await writeFile(invalidUtf8, invalidBytes);
    const wrong = `sha256:${"0".repeat(64)}`;
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: invalidUtf8, subject: "discovery-db", expectedDigest: wrong }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [root, "private-invalid-canary"],
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: invalidUtf8, subject: "discovery-db", expectedDigest: sha256(invalidBytes) }),
      "AGENTMO_ARTIFACT_INVALID_UTF8",
      [root, "private-invalid-canary"],
    );

    const duplicatePath = path.join(root, "private-duplicate-canary.json");
    const duplicateBytes = Buffer.from(
      '{"schemaVersion":"agentmo.user-need.v1","schemaVersion":"agentmo.user-need.v1"}',
      "utf8",
    );
    await writeFile(duplicatePath, duplicateBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: duplicatePath, subject: "user-need", expectedDigest: sha256(duplicateBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root, "private-duplicate-canary"],
    );

    const canonicalBytes = await readFile(USER_NEED);
    const canonical = JSON.parse(canonicalBytes.toString("utf8"));
    const variants = [
      Buffer.from(`${JSON.stringify(canonical)}\n`, "utf8"),
      Buffer.from(`${JSON.stringify({ ...canonical, schemaVersion: canonical.schemaVersion }, null, 4)}\n`, "utf8"),
      Buffer.from(`${canonicalBytes.toString("utf8")} `, "utf8"),
    ];
    for (const [index, variant] of variants.entries()) {
      const file = path.join(root, `variant-${index}.json`);
      await writeFile(file, variant);
      await rejectsWithCode(
        () => loadAdmittedArtifact({ filePath: file, subject: "user-need", expectedDigest: sha256(canonicalBytes) }),
        "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
        [root],
      );
    }
  });

  it("fails closed for unknown, swapped, and supported legacy identities without disclosure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-identity-"));
    const canary = "fixture-only-admission-canary";
    const unknownPath = path.join(root, "private-unknown-canary.json");
    const unknownBytes = Buffer.from(JSON.stringify({ schemaVersion: "agentmo.unknown.v1", note: canary }), "utf8");
    await writeFile(unknownPath, unknownBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: unknownPath, subject: "discovery-db", expectedDigest: sha256(unknownBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root, "private-unknown-canary", canary],
    );

    const needBytes = await readFile(USER_NEED);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: USER_NEED, subject: "discovery-db", expectedDigest: sha256(needBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [USER_NEED],
    );

    const legacyPath = fileURLToPath(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url));
    const legacyBytes = await readFile(legacyPath);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: legacyPath, subject: "discovery-db", expectedDigest: sha256(legacyBytes) }),
      "AGENTMO_MIGRATION_REQUIRED",
      [legacyPath],
    );

    const unsafePath = path.join(root, "private-unsafe-canary.json");
    const unsafe = JSON.parse(await readFile(USER_NEED, "utf8"));
    unsafe.rawTranscript = canary;
    const unsafeBytes = Buffer.from(JSON.stringify(unsafe), "utf8");
    await writeFile(unsafePath, unsafeBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: unsafePath, subject: "user-need", expectedDigest: sha256(unsafeBytes) }),
      "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
      [root, "private-unsafe-canary", canary],
    );

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: USER_NEED,
        subject: "user-need",
        expectedDigest: sha256(needBytes),
        maxBytes: 8,
      }),
      "AGENTMO_ARTIFACT_INPUT_TOO_LARGE",
      [USER_NEED],
    );
  });

  it("runs design-plan in a fresh process from exact file bindings plus ledger head", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-fresh-process-"));
    const out = path.join(root, "agentmo-design-plan.json");
    const approval = await createDiscoveryApproval(root);
    const manifestDigest = sha256(await readFile(SUPPORT_DISCOVERY));
    const dbDigest = sha256(await readFile(DISCOVERY_DB));
    const approvalDigest = sha256(await readFile(approval));
    const needDigest = sha256(await readFile(USER_NEED));
    const decisionLedger = await createDecisionLedger(root);
    const args = [
      "design-plan",
      DISCOVERY_DB,
      "--manifest",
      SUPPORT_DISCOVERY,
      "--discovery-approval",
      approval,
      "--need",
      USER_NEED,
      "--decision-ledger",
      decisionLedger.journal,
      "--digest",
      `discovery-manifest=${manifestDigest}`,
      "--digest",
      `discovery-db=${dbDigest}`,
      "--digest",
      `discovery-approval=${approvalDigest}`,
      "--digest",
      `user-need=${needDigest}`,
      "--digest",
      `decision-ledger=${decisionLedger.headDigest}`,
      "--out",
      out,
      "--target",
      "openclaw",
      "--json",
    ];
    const success = await runCli(args);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).designPlan.schemaVersion, "agentmo.design-plan.v1");

    const badOut = path.join(root, "must-not-exist.json");
    const mismatch = await runCli(args.map((value) => value === out ? badOut : value).map((value) =>
      value === `user-need=${needDigest}` ? `user-need=${dbDigest}` : value));
    assert.equal(mismatch.code, 1);
    await assert.rejects(() => access(badOut));
    for (const forbidden of [root, path.basename(USER_NEED), path.basename(DISCOVERY_DB)]) {
      assert.equal(mismatch.stdout.includes(forbidden), false);
      assert.equal(mismatch.stderr.includes(forbidden), false);
    }

    const blueprintDigest = sha256(await readFile(SUPPORT_BLUEPRINT));
    const plan = await runCli([
      "plan",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(plan.code, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).target.id, "openclaw");
  });

  it("returns bounded human and JSON errors for every binding-map failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-binding-errors-"));
    const approval = await createDiscoveryApproval(root);
    const manifestDigest = sha256(await readFile(SUPPORT_DISCOVERY));
    const dbDigest = sha256(await readFile(DISCOVERY_DB));
    const approvalDigest = sha256(await readFile(approval));
    const needDigest = sha256(await readFile(USER_NEED));
    const decisionLedger = await createDecisionLedger(root);
    const prefix = [
      "design-plan",
      DISCOVERY_DB,
      "--manifest",
      SUPPORT_DISCOVERY,
      "--discovery-approval",
      approval,
      "--need",
      USER_NEED,
      "--decision-ledger",
      decisionLedger.journal,
    ];
    const suffix = ["--out", path.join(root, "must-not-exist.json"), "--target", "openclaw", "--json"];
    const cases = [
      {
        bindings: ["--digest", `discovery-db=${dbDigest}`],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        bindings: [
          "--digest", `discovery-manifest=${manifestDigest}`,
          "--digest", `discovery-db=${dbDigest}`,
          "--digest", `discovery-db=${dbDigest}`,
          "--digest", `discovery-approval=${approvalDigest}`,
          "--digest", `user-need=${needDigest}`,
          "--digest", `decision-ledger=${decisionLedger.headDigest}`,
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE",
      },
      {
        bindings: [
          "--digest", `discovery-manifest=${manifestDigest}`,
          "--digest", `discovery-db=${dbDigest}`,
          "--digest", `discovery-approval=${approvalDigest}`,
          "--digest", `user-need=${needDigest}`,
          "--digest", `decision-ledger=${decisionLedger.headDigest}`,
          "--digest", `private-subject-canary=${dbDigest}`,
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
      {
        bindings: [
          "--digest", `discovery-manifest=${manifestDigest}`,
          "--digest", "discovery-db=private-digest-canary",
          "--digest", `discovery-approval=${approvalDigest}`,
          "--digest", `user-need=${needDigest}`,
          "--digest", `decision-ledger=${decisionLedger.headDigest}`,
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_INVALID",
      },
    ];

    for (const testCase of cases) {
      const result = await runCli([...prefix, ...testCase.bindings, ...suffix]);
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      const error = JSON.parse(result.stdout);
      assert.equal(error.code, testCase.code);
      assert.equal(error.ok, false);
      for (const forbidden of [root, "private-subject-canary", "private-digest-canary"]) {
        assert.equal(result.stdout.includes(forbidden), false);
        assert.equal(result.stderr.includes(forbidden), false);
      }
    }
    await assert.rejects(() => access(path.join(root, "must-not-exist.json")));

    const human = await runCli([
      ...prefix,
      "--digest",
      `discovery-manifest=${manifestDigest}`,
      "--digest",
      `discovery-db=${dbDigest}`,
      "--digest",
      `discovery-approval=${approvalDigest}`,
      "--digest",
      `user-need=${dbDigest}`,
      "--digest",
      `decision-ledger=${decisionLedger.headDigest}`,
      "--out",
      path.join(root, "human-must-not-exist.json"),
    ]);
    assert.equal(human.code, 1);
    assert.equal(human.stdout, "");
    assert.match(human.stderr, /AGENTMO_ARTIFACT_DIGEST_MISMATCH/u);
    assert.equal(human.stderr.includes(root), false);
  });
});
