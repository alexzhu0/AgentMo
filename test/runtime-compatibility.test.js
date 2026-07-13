import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLI_OUTPUT_OWNERS } from "../src/cli.js";
import { DURABLE_COMMAND_SUBJECTS } from "../src/artifact-subjects.js";
import * as runtimeCompatibility from "../src/runtime-compatibility.js";

const {
  AGENTMO_CORE_NODE_RANGE,
  OPENCLAW_TARGET_NODE_RANGE,
  assertCurrentOpenClawTargetRuntime,
  isOpenClawTargetNodeSupported,
  observeCurrentRuntime,
} = runtimeCompatibility;

const RUNTIME_REPORT_KEYS = [
  "component",
  "target",
  "observedVersion",
  "range",
  "supported",
  "evidenceClass",
];

describe("runtime compatibility policy", () => {
  it("exports only the immutable core and OpenClaw target runtime contract", () => {
    assert.deepEqual(Object.keys(runtimeCompatibility).sort(), [
      "AGENTMO_CORE_NODE_RANGE",
      "OPENCLAW_TARGET_NODE_RANGE",
      "assertCurrentOpenClawTargetRuntime",
      "isOpenClawTargetNodeSupported",
      "observeCurrentRuntime",
    ].sort());
    assert.equal(AGENTMO_CORE_NODE_RANGE, ">=20");
    assert.equal(OPENCLAW_TARGET_NODE_RANGE, ">=22.19.0 <23 || >=23.11.0");
    assert.equal(Object.isFrozen(AGENTMO_CORE_NODE_RANGE), true);
    assert.equal(Object.isFrozen(OPENCLAW_TARGET_NODE_RANGE), true);
    assert.equal(Object.isExtensible(runtimeCompatibility), false);
  });

  it("implements the exact disjoint OpenClaw Node boundary", () => {
    const cases = [
      ["20.0.0", false],
      ["20.19.0", false],
      ["21.99.99", false],
      ["22.0.0", false],
      ["22.18.99", false],
      ["22.19.0", true],
      ["22.19.1", true],
      ["22.99.0", true],
      ["23.0.0", false],
      ["23.10.99", false],
      ["23.11.0", true],
      ["23.11.1", true],
      ["24.0.0", true],
      ["25.0.0", true],
    ];

    for (const [version, expected] of cases) {
      assert.equal(isOpenClawTargetNodeSupported(version), expected, version);
    }
  });

  it("fails closed for malformed, non-triplet, and prerelease-shaped versions", () => {
    const malformed = [
      undefined,
      null,
      221900,
      "",
      " ",
      "v22.19.0",
      "22",
      "22.19",
      "22.19.0.0",
      "22.019.0",
      "022.19.0",
      "22.19.00",
      "22.19.0 ",
      " 22.19.0",
      "22.19.0-rc.1",
      "23.11.0+build.1",
      "Infinity.0.0",
      "9007199254740992.0.0",
    ];

    for (const version of malformed) {
      assert.equal(isOpenClawTargetNodeSupported(version), false, String(version));
    }
  });

  it("keeps the pure predicate separate from the zero-argument production authority", () => {
    assert.equal(isOpenClawTargetNodeSupported.length, 1);
    assert.equal(observeCurrentRuntime.length, 0);
    assert.equal(assertCurrentOpenClawTargetRuntime.length, 0);

    const source = Function.prototype.toString.call(assertCurrentOpenClawTargetRuntime);
    assert.match(source, /^function assertCurrentOpenClawTargetRuntime\(\)/u);
    assert.match(source, /process\.versions\.node/u);
    assert.doesNotMatch(source, /\b(?:options|provider|callback|override|bypass)\b/iu);

    if (isOpenClawTargetNodeSupported(process.versions.node)) {
      assert.doesNotThrow(() => assertCurrentOpenClawTargetRuntime());
    } else {
      assert.throws(
        () => assertCurrentOpenClawTargetRuntime(),
        (error) => error?.code === "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED",
      );
    }
    assert.throws(
      () => assertCurrentOpenClawTargetRuntime(
        "0.0.0",
        { provider: () => "0.0.0", bypass: true },
      ),
      (error) => {
        assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_INPUT_REJECTED");
        assert.equal(error?.message, "Runtime authorization accepts no caller-supplied inputs.");
        return true;
      },
    );
  });

  it("reports only bounded current-process facts through one frozen shape", () => {
    const report = observeCurrentRuntime();
    assert.deepEqual(Object.keys(report), RUNTIME_REPORT_KEYS);
    assert.deepEqual(report, {
      component: "openclaw-target",
      target: "openclaw",
      observedVersion: process.versions.node,
      range: OPENCLAW_TARGET_NODE_RANGE,
      supported: isOpenClawTargetNodeSupported(process.versions.node),
      evidenceClass: "current-process",
    });
    assert.equal(Object.isFrozen(report), true);

    const serialized = JSON.stringify(report);
    for (const forbidden of [
      process.cwd(),
      "/Users/private-runtime-canary",
      "/home/private-runtime-canary",
      "PATH=private-runtime-canary",
      "sk-private-runtime-canary123456",
      "certified",
      "production-ready",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("fails with one stable bounded code when the actual process observation is incompatible", () => {
    const original = Object.getOwnPropertyDescriptor(process.versions, "node");
    assert.equal(original?.configurable, true);
    try {
      Object.defineProperty(process.versions, "node", { ...original, value: "20.19.0" });
      assert.deepEqual(observeCurrentRuntime(), {
        component: "openclaw-target",
        target: "openclaw",
        observedVersion: "20.19.0",
        range: OPENCLAW_TARGET_NODE_RANGE,
        supported: false,
        evidenceClass: "current-process",
      });
      assert.throws(
        () => assertCurrentOpenClawTargetRuntime("24.0.0", { bypass: true }),
        (error) => {
          assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_INPUT_REJECTED");
          return true;
        },
      );
      assert.throws(
        () => assertCurrentOpenClawTargetRuntime(),
        (error) => {
          assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
          assert.equal(error?.message, "Current process does not satisfy the OpenClaw target runtime range.");
          assert.equal(String(error).includes(process.cwd()), false);
          return true;
        },
      );
    } finally {
      Object.defineProperty(process.versions, "node", original);
    }
  });

  it("registers runtime-check as non-artifact output with no durable subject", () => {
    assert.equal(CLI_OUTPUT_OWNERS["runtime-check"], "non-artifact");
    assert.equal(Object.hasOwn(DURABLE_COMMAND_SUBJECTS, "runtime-check"), false);
  });
});
