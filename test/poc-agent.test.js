import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  checkPocWorkspace,
  validatePocSeed,
  writePocWorkspace,
} from "../src/poc-agent.js";

function validSeed() {
  return {
    schemaVersion: "agentmo.poc-seed.v1",
    agentId: "ai-frontier-poc",
    records: [
      {
        id: "paper-agent-memory",
        title: "Agent Memory Paper",
        url: "https://example.com/papers/agent-memory",
        publishedAt: "2026-05-06T00:00:00.000Z",
        collectedAt: "2026-08-05T00:00:00.000Z",
        category: "agent-memory",
        sourceType: "paper",
        trustTier: "primary",
        summary: "A bounded paper summary.",
      },
      {
        id: "openclaw-release",
        title: "OpenClaw Release",
        url: "https://example.com/releases/openclaw",
        publishedAt: "2026-06-06T00:00:00.000Z",
        collectedAt: "2026-08-05T00:00:00.000Z",
        category: "openclaw",
        sourceType: "official-release",
        trustTier: "first-party",
        summary: "A bounded official release summary.",
      },
      {
        id: "duplicate-paper",
        title: "Duplicate Agent Memory Paper",
        url: "https://example.com/papers/agent-memory#overview",
        publishedAt: "2026-05-07T00:00:00.000Z",
        collectedAt: "2026-08-05T00:00:00.000Z",
        category: "agent-memory",
        sourceType: "paper",
        trustTier: "primary",
        summary: "A duplicate that must not enter the Wiki.",
      },
    ],
  };
}

describe("AI frontier POC workspace", () => {
  it("persists one first record per canonical URL and validates the resulting Wiki", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-agent-"));
    const output = path.join(root, "workspace");

    const result = await writePocWorkspace(validSeed(), output);
    const wiki = JSON.parse(await readFile(path.join(output, "knowledge/wiki.json"), "utf8"));

    assert.equal(result.manifest.schemaVersion, "agentmo.poc-workspace.v3");
    assert.equal(wiki.records.length, 2);
    assert.equal(wiki.records[0].id, "paper-agent-memory");
    assert.equal(wiki.records[0].url, "https://example.com/papers/agent-memory");
    assert.deepEqual(await checkPocWorkspace(output), {
      ok: true,
      recordCount: 2,
      researchRecordCount: 0,
      agentId: "ai-frontier-poc",
    });
  });

  it("rejects unsafe seed records before creating a workspace", () => {
    const invalid = validSeed();
    invalid.records[0].url = "http://example.com/not-https";
    invalid.records[1].summary = "DEEPSEEK_API_KEY=must-not-persist";

    const validation = validatePocSeed(invalid);

    assert.equal(validation.ok, false);
    assert.equal(validation.errors.includes("records[0].url must be an HTTPS URL without credentials."), true);
    assert.equal(validation.errors.includes("records[1].summary contains a prohibited secret-shaped value."), true);
  });

  it("materializes the complete agent surface, indexed knowledge, and inert cron proposals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-v2-"));
    const output = path.join(root, "workspace");
    await writePocWorkspace(validSeed(), output);
    const expectedFiles = [
      "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "MEMORY.md",
      "skills/source-intake/SKILL.md", "skills/paper-analysis/SKILL.md", "skills/github-release-tracking/SKILL.md",
      "skills/normalize-deduplicate/SKILL.md", "skills/ai-frontier-wiki/SKILL.md", "skills/citation-answering/SKILL.md",
      "skills/quality-review/SKILL.md", "knowledge/source-index.json", "knowledge/entity-index.json",
      "skills/aihot-source-intake/SKILL.md", "skills/white-collar-need-signals/SKILL.md",
      "skills/device-software-watch/SKILL.md", "skills/skill-scout/SKILL.md", "skills/research-db/SKILL.md",
      "skills/daily-brief/SKILL.md", "NOTICE.md", "research/research-db.json", "research/collection-state.json",
      "cron/daily-collect.json", "cron/daily-curate.json", "cron/weekly-review.json", "scripts/cron.mjs", "scripts/research.mjs",
    ];
    const sourceIndex = JSON.parse(await readFile(path.join(output, "knowledge/source-index.json"), "utf8"));
    const cronScript = await readFile(path.join(output, "scripts/cron.mjs"), "utf8");
    const dailyCollect = JSON.parse(await readFile(path.join(output, "cron/daily-collect.json"), "utf8"));
    const aihotSkill = await readFile(path.join(output, "skills/aihot-source-intake/SKILL.md"), "utf8");

    await Promise.all(expectedFiles.map((file) => readFile(path.join(output, file), "utf8")));
    assert.deepEqual(sourceIndex.entries.map((entry) => entry.id), ["paper-agent-memory", "openclaw-release"]);
    assert.match(cronScript, /action === "dry-run"/u);
    assert.doesNotMatch(cronScript, /fetch\(|spawn\(|crontab|scheduler\.add/u);
    assert.equal(dailyCollect.timezone, "Asia/Shanghai");
    assert.match(aihotSkill, /aihot\.virxact\.com\/api\/v1/u);
    assert.match(await readFile(path.join(output, "skills/skill-scout/SKILL.md"), "utf8"), /must not install/u);
    assert.match(await readFile(path.join(output, "AGENTS.md"), "utf8"), /research\/research-db\.json/u);
  });

  it("permits valid dynamic research-state serialization while static skill tampering fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-v3-dynamic-"));
    const output = path.join(root, "workspace");
    await writePocWorkspace(validSeed(), output);
    const statePath = path.join(output, "research/collection-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
    assert.equal((await checkPocWorkspace(output)).ok, true);
    await writeFile(path.join(output, "skills/aihot-source-intake/SKILL.md"), "tampered\n", "utf8");
    await assert.rejects(() => checkPocWorkspace(output), { code: "AGENTMO_POC_WORKSPACE_INVALID" });
  });

  it("fails closed when a v2 workspace member is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-v2-integrity-"));
    const output = path.join(root, "workspace");
    await writePocWorkspace(validSeed(), output);
    await unlink(path.join(output, "knowledge/source-index.json"));

    await assert.rejects(() => checkPocWorkspace(output), { code: "AGENTMO_POC_WORKSPACE_INVALID" });
  });
});
