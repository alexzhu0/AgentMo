import { mkdtemp, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MARKETPLACE = "agentmo-spike";
const PLUGIN = "agentmo-spike";

function runCodex(args, { cwd, env, root }) {
  const result = spawnSync("codex", args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  const stdout = (result.stdout ?? "").replaceAll(root, "<spike-root>");
  const stderr = (result.stderr ?? "").replaceAll(root, "<spike-root>");
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    // A non-JSON failure remains observable through exitCode and bounded stderr.
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    json,
    stdoutIncludesPlugin: stdout.includes(PLUGIN),
    stderrCode: stderr.split("\n").find((line) => /error|already|missing|not found/i.test(line))?.slice(0, 240) ?? null,
  };
}

async function createMarketplace(root, marker) {
  await mkdir(path.join(root, ".agents", "plugins"), { recursive: true });
  await mkdir(path.join(root, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(root, "skills", "hello"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify({
      name: MARKETPLACE,
      interface: { displayName: `AgentMo Spike ${marker}` },
      plugins: [{
        name: PLUGIN,
        source: { source: "url", url: "./" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      }],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({
      name: PLUGIN,
      version: marker === "A" ? "1.0.0" : "2.0.0",
      description: `AgentMo marketplace ownership spike ${marker}`,
      hooks: {},
      skills: "./skills/",
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "skills", "hello", "SKILL.md"),
    `---\nname: hello\ndescription: Marketplace ownership spike ${marker}.\n---\n\nReturn ${marker}.\n`,
  );
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    ["-c", "user.name=AgentMo Spike", "-c", "user.email=spike@example.invalid", "commit", "--quiet", "-m", `fixture ${marker}`],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed`);
  }
}

const root = await mkdtemp(path.join(tmpdir(), "agentmo-marketplace-spike-"));
const home = path.join(root, "home");
const codexHome = path.join(root, "codex-home");
const projectA = path.join(root, "project-a");
const projectB = path.join(root, "project-b");
const marketplaceA = path.join(root, "marketplace-a");
const marketplaceB = path.join(root, "marketplace-b");
await Promise.all([
  mkdir(home, { recursive: true }),
  mkdir(codexHome, { recursive: true }),
  mkdir(projectA, { recursive: true }),
  mkdir(projectB, { recursive: true }),
  createMarketplace(marketplaceA, "A"),
  createMarketplace(marketplaceB, "B"),
]);

const env = {
  PATH: process.env.PATH,
  HOME: home,
  CODEX_HOME: codexHome,
  NO_COLOR: "1",
};
const invoke = (args, cwd = projectA) => runCodex(args, { cwd, env, root });

const observations = {};
observations.addMarketplaceA = invoke(["plugin", "marketplace", "add", marketplaceA, "--json"]);
observations.listMarketplaceFromB = invoke(["plugin", "marketplace", "list", "--json"], projectB);
observations.addPluginFromA = invoke(["plugin", "add", `${PLUGIN}@${MARKETPLACE}`, "--json"], projectA);
observations.listInstalledFromA = invoke(["plugin", "list", "--json"], projectA);
observations.listInstalledFromB = invoke(["plugin", "list", "--json"], projectB);
observations.addSameNameMarketplaceB = invoke(["plugin", "marketplace", "add", marketplaceB, "--json"], projectB);

await rename(marketplaceA, `${marketplaceA}.offline`);
observations.listMarketplaceAfterSourceRemoved = invoke(["plugin", "marketplace", "list", "--json"], projectB);
observations.listPluginAfterSourceRemoved = invoke(["plugin", "list", "--json"], projectB);
observations.removePluginFromA = invoke(["plugin", "remove", `${PLUGIN}@${MARKETPLACE}`, "--json"], projectA);
observations.listInstalledFromBAfterRemove = invoke(["plugin", "list", "--json"], projectB);
observations.removeMarketplaceFromB = invoke(["plugin", "marketplace", "remove", MARKETPLACE, "--json"], projectB);
observations.listMarketplaceAfterRemove = invoke(["plugin", "marketplace", "list", "--json"], projectA);

const stableMarketplace = path.join(codexHome, "agentmo-owned-marketplace");
await createMarketplace(stableMarketplace, "S");
observations.addStableUserOwnedMarketplace = invoke(["plugin", "marketplace", "add", stableMarketplace, "--json"], projectB);
observations.addStablePlugin = invoke(["plugin", "add", `${PLUGIN}@${MARKETPLACE}`, "--json"], projectB);
await rename(projectA, `${projectA}.offline`);
observations.listStablePluginAfterProjectARemoved = invoke(["plugin", "list", "--json"], projectB);
observations.removeStablePlugin = invoke(["plugin", "remove", `${PLUGIN}@${MARKETPLACE}`, "--json"], projectB);
observations.removeStableMarketplace = invoke(["plugin", "marketplace", "remove", MARKETPLACE, "--json"], projectB);

const result = {
  schemaVersion: "agentmo.spike.codex-marketplace-ownership.v1",
  codexVersion: spawnSync("codex", ["--version"], { encoding: "utf8", env }).stdout.trim(),
  observations,
  conclusions: {
    experimentPreconditionsPassed:
      observations.addMarketplaceA.exitCode === 0
      && observations.addPluginFromA.exitCode === 0,
    marketplaceAndInstallAreUserHostScoped:
      observations.listMarketplaceFromB.stdoutIncludesPlugin
      && observations.listInstalledFromB.stdoutIncludesPlugin,
    secondSameNameSourceAccepted: observations.addSameNameMarketplaceB.exitCode === 0,
    installedPluginSurvivesLocalSourceRemoval:
      observations.listPluginAfterSourceRemoved.exitCode === 0
      && observations.listPluginAfterSourceRemoved.stdoutIncludesPlugin,
    removalFromOneProjectIsVisibleToOther:
      observations.removePluginFromA.exitCode === 0
      && !observations.listInstalledFromBAfterRemove.stdoutIncludesPlugin,
    marketplaceRemovalFromOneProjectIsGlobal:
      observations.removeMarketplaceFromB.exitCode === 0
      && !observations.listMarketplaceAfterRemove.stdoutIncludesPlugin,
    stableUserOwnedSourceSurvivesConsumerRemoval:
      observations.addStableUserOwnedMarketplace.exitCode === 0
      && observations.addStablePlugin.exitCode === 0
      && observations.listStablePluginAfterProjectARemoved.exitCode === 0
      && observations.listStablePluginAfterProjectARemoved.stdoutIncludesPlugin,
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
const expected = {
  experimentPreconditionsPassed: true,
  marketplaceAndInstallAreUserHostScoped: true,
  secondSameNameSourceAccepted: false,
  installedPluginSurvivesLocalSourceRemoval: false,
  removalFromOneProjectIsVisibleToOther: true,
  marketplaceRemovalFromOneProjectIsGlobal: true,
  stableUserOwnedSourceSurvivesConsumerRemoval: true,
};
if (JSON.stringify(result.conclusions) !== JSON.stringify(expected)) process.exitCode = 1;
