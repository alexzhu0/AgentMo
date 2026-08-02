import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildDiscoveryLive,
  prepareDiscoveryLive,
  writeDiscoveryLive,
} from "../src/discovery-live.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function manifest(location = "https://example.com/research", collectorOverrides = {}) {
  return {
    schemaVersion: "agentmo.discovery.v1",
    agent_id: "live-security",
    source_inventory: [{
      id: "approved-source",
      type: "retrieval_corpus",
      trust_level: "verified",
      description: "Approved public source.",
      location,
      extraction_fields: ["title"],
    }],
    database_outputs: ["bounded evidence"],
    retrieval_outputs: ["cited answer"],
    user_need_inputs: ["question"],
    refresh_policy: { cadence: "daily", owner: "human", stale_after: "P2D" },
    forbidden_data_handling: ["Do not persist credentials or full response bodies."],
    collector: {
      schemaVersion: "agentmo.discovery-live-policy.v1",
      adapter: "web",
      allowlist: ["https://example.com/research"],
      maxSources: 1,
      maxBytesPerSource: 64,
      perSourceTimeoutMs: 100,
      aggregateTimeoutMs: 500,
      maxRedirects: 1,
      allowedContentTypes: ["text/plain"],
      ...collectorOverrides,
    },
  };
}

function streamResponse({
  body = "bounded evidence",
  status = 200,
  url = "https://example.com/research",
  remoteAddress = "93.184.216.34",
  headers = {},
} = {}) {
  const chunks = Array.isArray(body) ? body : [body];
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    status,
    url,
    remoteAddress,
    headers: {
      "content-type": "text/plain",
      "content-length": String(bytes.length),
      ...headers,
    },
    body: (async function* bodyStream() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    })(),
  };
}

function transportFrom(handler) {
  return {
    calls: [],
    async request(request) {
      this.calls.push(request.url);
      return handler(request, this.calls.length);
    },
  };
}

async function rejectsLive(manifestValue, transport, expectedCode) {
  await assert.rejects(
    () => buildDiscoveryLive(manifestValue, {
      transport,
      now: () => new Date("2026-07-28T01:02:03.000Z"),
    }),
    (error) => error?.code === expectedCode,
  );
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("live discovery fail-closed boundaries", () => {
  it("rejects unsafe source URLs before transport", async () => {
    const cases = [
      ["http://example.com/research", "AGENTMO_DISCOVERY_LIVE_HTTPS_REQUIRED"],
      ["https://user:pass@example.com/research", "AGENTMO_DISCOVERY_LIVE_URL_CREDENTIALS"],
      ["https://127.0.0.1/research", "AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION"],
      ["https://example.com/not-approved", "AGENTMO_DISCOVERY_LIVE_DESTINATION_NOT_ALLOWED"],
    ];

    for (const [location, code] of cases) {
      const transport = transportFrom(() => {
        throw new Error("transport must not run");
      });
      await rejectsLive(manifest(location), transport, code);
      assert.deepEqual(transport.calls, []);
    }
  });

  it("rejects redirects outside the exact allowlist", async () => {
    const transport = transportFrom(() => streamResponse({
      status: 302,
      headers: { location: "https://unapproved.example/next", "content-length": "0" },
      body: "",
    }));
    await rejectsLive(
      manifest(),
      transport,
      "AGENTMO_DISCOVERY_LIVE_DESTINATION_NOT_ALLOWED",
    );
    assert.deepEqual(transport.calls, ["https://example.com/research"]);
  });

  it("rejects private connected addresses and rebinding-like outcomes", async () => {
    const transport = transportFrom(() => streamResponse({ remoteAddress: "127.0.0.1" }));
    await rejectsLive(
      manifest(),
      transport,
      "AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION",
    );
  });

  it("enforces status, type, declared length, streamed length, and deadline bounds", async () => {
    const cases = [
      [
        streamResponse({ status: 429 }),
        "AGENTMO_DISCOVERY_LIVE_HTTP_STATUS",
      ],
      [
        streamResponse({ headers: { "content-type": "application/octet-stream" } }),
        "AGENTMO_DISCOVERY_LIVE_CONTENT_TYPE",
      ],
      [
        streamResponse({ headers: { "content-length": "65" } }),
        "AGENTMO_DISCOVERY_LIVE_RESPONSE_TOO_LARGE",
      ],
      [
        streamResponse({
          body: [Buffer.alloc(40, 0x61), Buffer.alloc(25, 0x62)],
          headers: { "content-length": "" },
        }),
        "AGENTMO_DISCOVERY_LIVE_RESPONSE_TOO_LARGE",
      ],
    ];

    for (const [response, code] of cases) {
      await rejectsLive(manifest(), transportFrom(() => response), code);
    }

    const hanging = transportFrom(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    await rejectsLive(
      manifest("https://example.com/research", { perSourceTimeoutMs: 10 }),
      hanging,
      "AGENTMO_DISCOVERY_LIVE_TIMEOUT",
    );

    const slowBody = transportFrom(async () => ({
      status: 200,
      url: "https://example.com/research",
      remoteAddress: "93.184.216.34",
      headers: { "content-type": "text/plain" },
      body: (async function* bodyStream() {
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield Buffer.from("late body", "utf8");
      })(),
    }));
    await rejectsLive(
      manifest("https://example.com/research", { perSourceTimeoutMs: 10 }),
      slowBody,
      "AGENTMO_DISCOVERY_LIVE_TIMEOUT",
    );
  });

  it("rejects secret-shaped response text without exposing it", async () => {
    const sentinel = "api_key=sk-proj-secret-sentinel";
    const transport = transportFrom(() => streamResponse({ body: sentinel }));
    try {
      await buildDiscoveryLive(manifest(), { transport });
      assert.fail("secret-shaped body must fail");
    } catch (error) {
      assert.equal(error?.code, "AGENTMO_DISCOVERY_LIVE_SENSITIVE_CONTENT");
      assert.equal(String(error?.message).includes(sentinel), false);
      assert.equal(JSON.stringify(error).includes(sentinel), false);
    }
  });

  it("preflights candidate consistency before creating an output root", async () => {
    const live = await buildDiscoveryLive(manifest(), {
      transport: transportFrom(() => streamResponse()),
      now: () => new Date("2026-07-28T01:02:03.000Z"),
    });
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-live-preflight-"));
    const out = path.join(root, "must-not-exist");
    const forged = { ...live, factsJsonl: `${live.factsJsonl}{}\n` };

    assert.throws(
      () => prepareDiscoveryLive(forged),
      (error) => error?.code === "AGENTMO_PERSISTABILITY_CANDIDATE_MISMATCH",
    );
    await assert.rejects(() => writeDiscoveryLive(out, forged));
    await assert.rejects(() => access(out));
  });

  it("keeps the requested output absent when a late staging write fails", async () => {
    const live = await buildDiscoveryLive(manifest(), {
      transport: transportFrom(() => streamResponse()),
      now: () => new Date("2026-07-28T01:02:03.000Z"),
    });
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-live-write-"));
    const out = path.join(root, "must-remain-absent");
    let writes = 0;
    const publicationIo = {
      mkdir,
      rename,
      async writeFile(file, bytes, options) {
        writes += 1;
        if (writes === 3) {
          const error = new Error("bounded injected failure");
          error.code = "EIO";
          throw error;
        }
        return writeFile(file, bytes, options);
      },
    };

    await assert.rejects(
      () => writeDiscoveryLive(out, live, { publicationIo }),
      (error) => error?.code === "AGENTMO_DISCOVERY_LIVE_PUBLICATION_FAILED",
    );
    await assert.rejects(() => access(out));
  });

  it("keeps public CLI admission closed and offers no transport override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-live-cli-"));
    const file = path.join(root, "manifest.json");
    const out = path.join(root, "must-remain-absent");
    const bytes = Buffer.from(`${JSON.stringify(manifest(), null, 2)}\n`, "utf8");
    await writeFile(file, bytes);
    const exactDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const cases = [
      [[], "AGENTMO_ARTIFACT_DIGEST_REQUIRED"],
      [["--digest", `discovery-manifest=${exactDigest}`, "--transport", "fake"], "AGENTMO_CLI_REQUEST_REJECTED"],
      [["--digest", `discovery-manifest=sha256:${"0".repeat(64)}`], "AGENTMO_ARTIFACT_DIGEST_MISMATCH"],
      [[
        "--digest",
        `discovery-manifest=${exactDigest}`,
        "--digest",
        `discovery-manifest=${exactDigest}`,
      ], "AGENTMO_ARTIFACT_DIGEST_DUPLICATE"],
    ];

    for (const [extra, expected] of cases) {
      const result = await runCli(["discover-live", file, "--out", out, "--json", ...extra]);
      assert.equal(result.code, 1);
      assert.match(`${result.stdout}${result.stderr}`, new RegExp(expected, "u"));
      await assert.rejects(() => access(out), (error) => error?.code === "ENOENT");
    }
  });
});
