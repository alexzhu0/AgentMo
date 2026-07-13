import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlan } from "../src/build-plan.js";
import { createBuildState, serializeBuildState } from "../src/build-state.js";
import { buildControlSnapshot, formatControlSnapshot, loadBuildState } from "../src/control-snapshot.js";
import { admitBlueprint, digestBytes } from "./helpers/admitted-blueprint.js";
import { executeAdmittedRuntimeRun } from "./helpers/admitted-runtime.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

async function loadExampleAdmission() {
  return admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
}

describe("control snapshot", () => {
  it("builds a stable JSON-serializable status snapshot", async () => {
    const blueprint = await loadExample();
    const snapshot = buildControlSnapshot(blueprint);
    const reparsed = JSON.parse(JSON.stringify(snapshot));

    assert.equal(reparsed.schemaVersion, "agentmo.control.v1");
    assert.equal(reparsed.agentId, "win9");
    assert.equal(reparsed.status, "certified");
    assert.equal(reparsed.produce_maturity.stage, "certify");
    assert.equal("lifecycle" in reparsed, false);
    assert.equal(reparsed.pipeline.completed, 3);
    assert.equal(reparsed.pipeline.total, 3);
    assert.equal(reparsed.qualityGates.failed, 0);
    assert.equal(reparsed.runtime.primary, "pi");
    assert.deepEqual(
      reparsed.runtime.profiles.map((profile) => profile.id),
      ["pi", "openclaw"],
    );
    assert.equal(reparsed.latestBuildState.available, false);
    assert.equal(reparsed.latestBuildState.reason, "not_supplied");
    assert.equal(reparsed.latestRunState.available, false);
    assert.equal(reparsed.latestRunState.reason, "not_supplied");
    assert.match(formatControlSnapshot(reparsed), /Produce maturity: certify/u);
    assert.doesNotMatch(formatControlSnapshot(reparsed), /Lifecycle:/u);
  });

  it("summarizes supplied build-state target and operation counts", async () => {
    const admission = await loadExampleAdmission();
    const blueprint = admission.value;
    const plan = buildPlan(blueprint, { target: "openclaw" });
    const buildState = await createBuildState(blueprint, plan, {
      admission,
      generatedAt: "2026-01-01T00:00:00.000Z",
      target: "openclaw",
    });

    const snapshot = buildControlSnapshot(blueprint, { buildState, buildStatePath: "/tmp/win9-openclaw/agentmo-build-state.json" });

    assert.equal(snapshot.latestBuildState.available, true);
    assert.equal(snapshot.latestBuildState.path, "/tmp/win9-openclaw/agentmo-build-state.json");
    assert.equal(snapshot.latestBuildState.target.id, "openclaw");
    assert.equal(snapshot.latestBuildState.operations.domainOperationCount, plan.operations.length);
    assert.equal(snapshot.latestBuildState.operations.recordedOperationCount, plan.operations.length);
    assert.equal(snapshot.latestBuildState.resolution.selectedTargetId, "openclaw");
  });

  it("loads build-state only from exact build-state bytes and subject", async () => {
    const admission = await loadExampleAdmission();
    const plan = buildPlan(admission.value, { target: "openclaw" });
    const state = await createBuildState(admission.value, plan, { admission, target: "openclaw" });
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-control-admission-"));
    const file = path.join(root, "agentmo-build-state.json");
    const bytes = Buffer.from(serializeBuildState(state), "utf8");
    await writeFile(file, bytes);

    assert.deepEqual(
      await loadBuildState(file, {
        subject: "build-state",
        expectedDigest: digestBytes(bytes),
        blueprintAdmission: admission,
      }),
      state,
    );
    await assert.rejects(
      () => loadBuildState(file, { subject: "blueprint", expectedDigest: digestBytes(bytes), blueprintAdmission: admission }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await assert.rejects(
      () => loadBuildState(file, {
        subject: "build-state",
        expectedDigest: `sha256:${"0".repeat(64)}`,
        blueprintAdmission: admission,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
  });

  it("rejects source mismatch, family swaps, unknown identity, and duplicate provenance members", async () => {
    const admission = await loadExampleAdmission();
    const otherAdmission = await admitBlueprint(new URL("../examples/support-triage.agentmo.json", import.meta.url));
    const plan = buildPlan(admission.value, { target: "openclaw" });
    const state = await createBuildState(admission.value, plan, { admission, target: "openclaw" });
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-control-cross-product-"));
    const stateFile = path.join(root, "state.json");
    const stateBytes = Buffer.from(serializeBuildState(state));
    await writeFile(stateFile, stateBytes);

    await assert.rejects(
      () => loadBuildState(stateFile, {
        subject: "build-state",
        expectedDigest: digestBytes(stateBytes),
        blueprintAdmission: otherAdmission,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );

    const blueprintBytes = await readFile(new URL("../examples/win9.agentmo.json", import.meta.url));
    await assert.rejects(
      () => loadBuildState(new URL("../examples/win9.agentmo.json", import.meta.url), {
        subject: "build-state",
        expectedDigest: digestBytes(blueprintBytes),
        blueprintAdmission: admission,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    const unknown = Buffer.from(`${JSON.stringify({ ...state, schemaVersion: "agentmo.build-state.unknown" }, null, 2)}\n`);
    const unknownFile = path.join(root, "unknown.json");
    await writeFile(unknownFile, unknown);
    await assert.rejects(
      () => loadBuildState(unknownFile, {
        subject: "build-state",
        expectedDigest: digestBytes(unknown),
        blueprintAdmission: admission,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    const serialized = serializeBuildState(state);
    const duplicateText = serialized.replace(
      `"digest": "${state.source.digest}"`,
      `"digest": "${state.source.digest}",\n    "digest": "${state.source.digest}"`,
    );
    const duplicateFile = path.join(root, "duplicate.json");
    const duplicateBytes = Buffer.from(duplicateText);
    await writeFile(duplicateFile, duplicateBytes);
    await assert.rejects(
      () => loadBuildState(duplicateFile, {
        subject: "build-state",
        expectedDigest: digestBytes(duplicateBytes),
        blueprintAdmission: admission,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT" && error?.reason === "duplicate_identity_member",
    );
  });

  it("represents unreadable build-state as unavailable instead of throwing", async () => {
    const blueprint = await loadExample();
    const snapshot = buildControlSnapshot(blueprint, {
      buildStatePath: "/tmp/missing-agentmo-build-state.json",
      buildStateError: "ENOENT",
    });

    assert.equal(snapshot.latestBuildState.available, false);
    assert.match(snapshot.latestBuildState.reason, /unreadable: ENOENT/u);
    assert.match(formatControlSnapshot(snapshot), /Build state: unavailable/u);
  });

  it("summarizes supplied run-state without changing runtime certification", async () => {
    const blueprint = await loadExample();
    const { runState, blueprintAdmission } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      message: "Say exactly: ok",
      runId: "status-run",
      now: "2026-07-03T00:00:00.000Z",
    });

    const snapshot = buildControlSnapshot(blueprintAdmission.value, {
      blueprintAdmission,
      runState,
      runStatePath: "/tmp/agentmo-runs/runs/status-run/agentmo-run-state.json",
    });

    assert.equal(snapshot.latestRunState.available, true);
    assert.equal(snapshot.latestRunState.usable, true);
    assert.equal(snapshot.latestRunState.path, "/tmp/agentmo-runs/runs/status-run/agentmo-run-state.json");
    assert.equal(snapshot.latestRunState.target.id, "openclaw");
    assert.equal(snapshot.latestRunState.execution.status, "declared");
    assert.equal(snapshot.latestRunState.runtimeIdentity.transport, "unknown");
    assert.equal(snapshot.latestRunState.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(snapshot.latestRunState.freshness, "current");
    assert.equal(snapshot.latestRunState.message.sourceDigest, runState.message.sourceDigest);
    assert.equal(snapshot.latestRunState.message.byteLength, runState.message.byteLength);
    assert.deepEqual(snapshot.latestRunState.message.summary, runState.message.summary);
    assert.equal("hash" in snapshot.latestRunState.message, false);
    assert.equal("preview" in snapshot.latestRunState.message, false);
    assert.equal(snapshot.runtimeCertification.profiles.find((profile) => profile.id === "openclaw").certificationStatus, "verification_declared");
    assert.match(formatControlSnapshot(snapshot), /Run state: openclaw declared \(current\)/u);
  });

  it("reports stale run-state evidence as unusable and non-authoritative", async () => {
    const blueprint = await loadExample();
    const { runState, blueprintAdmission } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      message: "Say exactly: ok",
      runId: "stale-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const stale = JSON.parse(JSON.stringify(runState));
    stale.source.blueprint.digest = `sha256:${"0".repeat(64)}`;

    const snapshot = buildControlSnapshot(blueprintAdmission.value, { blueprintAdmission, runState: stale });

    assert.equal(snapshot.latestRunState.available, true);
    assert.equal(snapshot.latestRunState.usable, false);
    assert.equal(snapshot.latestRunState.freshness, "stale");
    assert.equal(snapshot.risks.includes("Latest run-state blueprint provenance is stale."), true);
    assert.equal(snapshot.nextActions.includes("Refresh runtime evidence because the run-state blueprint provenance is stale."), true);

    const unverifiable = buildControlSnapshot(blueprintAdmission.value, { runState });
    assert.equal(unverifiable.latestRunState.usable, false);
    assert.equal(unverifiable.latestRunState.freshness, "unverifiable");
    assert.equal(unverifiable.risks.includes("Latest run-state blueprint provenance cannot be verified."), true);

    const missingStoredProvenance = JSON.parse(JSON.stringify(runState));
    delete missingStoredProvenance.source.blueprint;
    const missing = buildControlSnapshot(blueprintAdmission.value, {
      blueprintAdmission,
      runState: missingStoredProvenance,
    });
    assert.equal(missing.latestRunState.usable, false);
    assert.equal(missing.latestRunState.freshness, "unverifiable");
  });

  it("keeps corrupt or risky run evidence fail-closed in risks and next actions", async () => {
    const blueprint = await loadExample();
    const unreadable = buildControlSnapshot(blueprint, {
      runStatePath: "/tmp/bad-run-state.json",
      runStateError: "Invalid run-state JSON /tmp/bad-run-state.json",
    });
    assert.equal(unreadable.latestRunState.available, false);
    assert.match(unreadable.latestRunState.reason, /unreadable/u);
    assert.equal(unreadable.risks.some((risk) => risk.includes("Latest run-state is unavailable")), true);

    const { runState, blueprintAdmission } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "Say exactly: ok",
      live: true,
      runId: "failed-run",
      now: "2026-07-03T00:00:00.000Z",
    }, async () => ({ exitCode: 1, stdout: "", stderr: "failed", timedOut: false, durationMs: 2 }));
    runState.runtimeIdentity.sandboxScope.usesProductionState = true;

    const risky = buildControlSnapshot(blueprintAdmission.value, { blueprintAdmission, runState });
    assert.equal(risky.latestRunState.usable, false);
    assert.equal(risky.latestRunState.execution.status, "failure");
    assert.equal(risky.risks.includes("Latest run-state failed-run recorded execution failure."), true);
    assert.equal(risky.risks.includes("Latest run-state used production OpenClaw state."), true);
    assert.equal(
      risky.nextActions.includes("Inspect failed runtime evidence and create an observe proposal if it indicates a blueprint/scaffold change."),
      true,
    );
    assert.equal(risky.nextActions.includes("Review production OpenClaw state usage before treating run evidence as safe."), true);
  });
});
