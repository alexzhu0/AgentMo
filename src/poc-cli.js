export async function runPocCommand(args, dependencies) {
  const { resolve, readFile, emitNonArtifactOutput, cliError } = dependencies;
  const options = parsePocArgs(args, { resolve, cliError });
  const { checkPocWorkspace, loadPocSeed, writePocWorkspace } = await import("./poc-agent.js");
  if (options.action === "build") {
    const result = await writePocWorkspace(await loadPocSeed(options.seed), options.out);
    await emitNonArtifactOutput({ manifest: result.manifest, files: result.files }, { json: options.json, subject: "poc-build-output", format: formatPocBuild });
    return;
  }
  if (options.action === "run") {
    const { runPocOpenClaw } = await import("./poc-openclaw-runtime.js");
    const result = await runPocOpenClaw(options);
    await emitNonArtifactOutput(result, { json: options.json, subject: "poc-run-output", format: formatPocRun });
    return;
  }
  if (options.action === "collect") {
    const workspaceCheck = await checkPocWorkspace(options.workspace);
    const [registry, workspaceModule, collector, transportModule] = await Promise.all([
      loadPocResearchSources(options.sources, readFile, cliError), import("./poc-research-workspace.js"), import("./poc-research-collector.js"), import("./discovery-live-transport.js"),
    ]);
    if (registry?.agentId !== workspaceCheck.agentId) {
      const error = cliError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
      error.pocDiagnostic = {
        operation: "collect",
        exitCode: 1,
        summary: "sources.agentId must match workspace.agentId.",
      };
      throw error;
    }
    const current = await workspaceModule.loadPocResearchWorkspace(options.workspace, workspaceCheck.agentId);
    const collection = await collector.collectResearchSources({
      registry,
      previousState: current.state,
      now: new Date().toISOString(),
      networkMode: options.networkMode,
      transport: transportModule.createDiscoveryLiveTransport({ networkMode: options.networkMode }),
    });
    const persisted = await workspaceModule.persistResearchCollection(options.workspace, collection);
    const result = summarizePocResearchCollection({
      agentId: workspaceCheck.agentId,
      networkMode: options.networkMode,
      retrievals: collection.retrievals,
      newlyAdmitted: persisted.newlyAdmitted,
      recordCount: persisted.recordCount,
    });
    await emitNonArtifactOutput(result, { json: options.json, subject: "poc-collection-output", format: formatPocCollection });
    return;
  }
  if (options.action === "brief") {
    const workspaceCheck = await checkPocWorkspace(options.workspace);
    const [workspaceModule, briefModule] = await Promise.all([import("./poc-research-workspace.js"), import("./poc-research-brief.js")]);
    const current = await workspaceModule.loadPocResearchWorkspace(options.workspace, workspaceCheck.agentId);
    const brief = briefModule.buildResearchDailyBrief({ db: current.db, date: options.date, timezone: "Asia/Shanghai" });
    await workspaceModule.persistResearchBrief(options.workspace, brief, briefModule.renderResearchDailyBriefMarkdown(brief));
    await emitNonArtifactOutput({ date: brief.date, newEvidenceCount: brief.newEvidence.length, gapCount: brief.gaps.length, deliveryExecuted: false }, { json: options.json, subject: "poc-brief-output", format: formatPocBrief });
    return;
  }
  if (options.action === "schedule-preview") {
    const workspaceCheck = await checkPocWorkspace(options.workspace);
    const proposal = await loadPocCronProposal(options.workspace, "daily-collect", resolve, readFile, cliError);
    const result = { agentId: workspaceCheck.agentId, id: proposal.id, expression: proposal.expression, timezone: proposal.timezone, mode: proposal.mode, executionAuthority: proposal.executionAuthority, activation: "not-authorized", delivery: "none" };
    await emitNonArtifactOutput(result, { json: options.json, subject: "poc-schedule-preview-output", format: formatPocSchedulePreview });
    return;
  }
  const result = await checkPocWorkspace(options.workspace);
  await emitNonArtifactOutput(result, { json: options.json, subject: "poc-check-output", format: formatPocCheck });
}

export function summarizePocResearchCollection({ agentId, networkMode, retrievals, newlyAdmitted, recordCount }) {
  return {
    agentId,
    networkMode,
    successfulSources: retrievals.filter((entry) => entry.status === "retrieved" || entry.status === "not-modified").length,
    retrievedSources: retrievals.filter((entry) => entry.status === "retrieved").length,
    failedSources: retrievals.filter((entry) => entry.status === "failed").length,
    newlyAdmitted,
    recordCount,
    scheduleExecuted: false,
    deliveryExecuted: false,
  };
}

function parsePocArgs(args, { resolve, cliError }) {
  const [action, ...rest] = args;
  if (action === "build") return parseBuild(rest, resolve, cliError);
  if (action === "check") {
    const workspace = rest[0];
    if (typeof workspace !== "string" || workspace.startsWith("--") || rest.slice(1).some((arg) => arg !== "--json")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    return { action, workspace: resolve(workspace), json: rest.includes("--json") };
  }
  if (action === "collect") return parseCollect(rest, resolve, cliError);
  if (action === "brief") return parseWorkspaceOption(rest, action, "--date", "date", resolve, cliError, (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value));
  if (action === "schedule-preview") {
    const workspace = rest[0];
    if (typeof workspace !== "string" || workspace.startsWith("--") || rest.slice(1).some((arg) => arg !== "--json")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    return { action, workspace: resolve(workspace), json: rest.includes("--json") };
  }
  if (action !== "run" || typeof rest[0] !== "string" || rest[0].startsWith("--")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  const options = parseNamed(rest.slice(1), { action, workspace: resolve(rest[0]), profile: null, model: null, runtimeEnvFile: null, message: null, json: false }, ["--profile", "--model", "--runtime-env-file", "--message"], cliError);
  if ([options.profile, options.model, options.runtimeEnvFile, options.message].some((value) => typeof value !== "string" || value.startsWith("--"))) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  options.runtimeEnvFile = resolve(options.runtimeEnvFile);
  return options;
}

function parseBuild(rest, resolve, cliError) {
  const options = parseNamed(rest, { action: "build", seed: null, out: null, json: false }, ["--seed", "--out"], cliError);
  if (typeof options.seed !== "string" || options.seed.startsWith("--") || typeof options.out !== "string" || options.out.startsWith("--")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  return { ...options, seed: resolve(options.seed), out: resolve(options.out) };
}

function parseCollect(rest, resolve, cliError) {
  const workspace = rest[0];
  if (typeof workspace !== "string" || workspace.startsWith("--")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  const options = parseNamed(rest.slice(1), {
    action: "collect",
    workspace: resolve(workspace),
    sources: null,
    networkMode: "public-only",
    json: false,
  }, ["--sources", "--network-mode"], cliError);
  if (typeof options.sources !== "string" || options.sources.startsWith("--")
    || !["public-only", "synthetic-dns-proxy"].includes(options.networkMode)) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  options.sources = resolve(options.sources);
  return options;
}

function parseWorkspaceOption(rest, action, flag, key, resolve, cliError, valid = () => true) {
  const workspace = rest[0];
  if (typeof workspace !== "string" || workspace.startsWith("--")) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  const options = parseNamed(rest.slice(1), { action, workspace: resolve(workspace), [key]: null, json: false }, [flag], cliError);
  if (typeof options[key] !== "string" || options[key].startsWith("--") || !valid(options[key])) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  if (key === "sources") options.sources = resolve(options.sources);
  return options;
}

function parseNamed(args, options, flags, cliError) {
  const names = Object.fromEntries(flags.map((flag) => [flag, flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())]));
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = true;
    else if (Object.hasOwn(names, arg)) { options[names[arg]] = args[index + 1]; index += 1; }
    else throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  return options;
}

async function loadPocResearchSources(filePath, readFile, cliError) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch { throw cliError("AGENTMO_POC_RESEARCH_SOURCES_INVALID"); }
}

async function loadPocCronProposal(workspace, id, resolve, readFile, cliError) {
  try {
    const proposal = JSON.parse(await readFile(resolve(workspace, "cron", `${id}.json`), "utf8"));
    if (proposal?.schemaVersion !== "agentmo.poc-cron-proposal.v1" || proposal.id !== id || proposal.expression !== "0 8 * * *" || proposal.timezone !== "Asia/Shanghai" || proposal.mode !== "proposal-only" || proposal.executionAuthority !== "none") throw new Error("invalid");
    return proposal;
  } catch { throw cliError("AGENTMO_POC_SCHEDULE_PROPOSAL_INVALID"); }
}

function formatPocBuild(result) { return `AgentMo POC workspace: ${result.manifest.agentId}\nRecords: ${result.manifest.recordCount}\nLive collector: not executed\nRuntime: not executed\n`; }
function formatPocCheck(result) { return `AgentMo POC workspace: ${result.agentId}\nRecords: ${result.recordCount}\nResearch records: ${result.researchRecordCount}\nStatus: valid\n`; }
function formatPocCollection(result) { return `AgentMo POC collection: ${result.agentId}\nNetwork mode: ${result.networkMode}\nSuccessful sources: ${result.successfulSources}\nRetrieved sources: ${result.retrievedSources}\nFailed sources: ${result.failedSources}\nNewly admitted records: ${result.newlyAdmitted}\nResearch records: ${result.recordCount}\nDelivery: not executed\nSchedule: not executed\n`; }
function formatPocBrief(result) { return `AgentMo POC daily brief: ${result.date}\nNew evidence: ${result.newEvidenceCount}\nEvidence gaps: ${result.gapCount}\nDelivery: not executed\n`; }
function formatPocSchedulePreview(result) { return `AgentMo POC schedule proposal: ${result.id}\nCron: ${result.expression}\nTimezone: ${result.timezone}\nActivation: not authorized\nDelivery: none\n`; }
function formatPocRun(result) { return `AgentMo POC run: ${result.agentId}\nRecords: ${result.recordCount}\nRuntime: isolated local OpenClaw\nSchedule: not executed\nDelivery: not executed\nReply:\n${result.reply}\n`; }
