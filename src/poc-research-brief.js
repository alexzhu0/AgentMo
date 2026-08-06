import { validateResearchRecord } from "./poc-research-contract.js";

export const POC_RESEARCH_DAILY_BRIEF_SCHEMA_VERSION = "agentmo.poc-research-daily-brief.v1";

const SCENARIOS = Object.freeze([
  "knowledge-documents",
  "meetings-collaboration",
  "data-analysis-decision",
]);

export function buildResearchDailyBrief({ db, date, timezone } = {}) {
  validateInput(db, date, timezone);
  const records = db.records
    .filter((record) => localDate(record.collectedAt, timezone) === date)
    .sort((left, right) => left.collectedAt.localeCompare(right.collectedAt) || left.id.localeCompare(right.id));
  const scenarioSignals = SCENARIOS
    .map((scenario) => buildScenarioSignal(scenario, records))
    .filter((signal) => signal !== null);
  const hypotheses = scenarioSignals.map(buildHypothesis);
  const gaps = SCENARIOS
    .filter((scenario) => !scenarioSignals.some((signal) => signal.scenario === scenario))
    .map((scenario) => ({
      scenario,
      code: "evidence-gap",
      message: `No collected evidence for ${scenario} on ${date}.`,
    }));

  return deepFreeze({
    schemaVersion: POC_RESEARCH_DAILY_BRIEF_SCHEMA_VERSION,
    date,
    timezone,
    newEvidence: records.slice(0, 8).map(projectEvidence),
    scenarioSignals,
    hypotheses,
    gaps,
  });
}

export function renderResearchDailyBriefMarkdown(brief) {
  if (!brief || brief.schemaVersion !== POC_RESEARCH_DAILY_BRIEF_SCHEMA_VERSION) {
    throw briefError("AGENTMO_POC_RESEARCH_BRIEF_INVALID");
  }
  const lines = [
    `# White-Collar Research Daily Brief — ${brief.date}`,
    "",
    `Timezone: ${brief.timezone}`,
    "",
    "## New evidence",
  ];
  if (brief.newEvidence.length === 0) lines.push("- No new retained evidence.");
  for (const evidence of brief.newEvidence) {
    lines.push(`- [${evidence.title}](${evidence.url}) — ${evidence.factClass}; ${evidence.trustTier}; ${evidence.id}`);
  }
  lines.push("", "## Scenario signals");
  if (brief.scenarioSignals.length === 0) lines.push("- No scenario signals.");
  for (const signal of brief.scenarioSignals) {
    lines.push(`- ${signal.scenario}: ${signal.evidenceIds.join(", ")}`);
  }
  lines.push("", "## Bounded hypotheses");
  if (brief.hypotheses.length === 0) lines.push("- No hypotheses without retained evidence.");
  for (const hypothesis of brief.hypotheses) {
    lines.push(`- ${hypothesis.scenario} (${hypothesis.confidence}): ${hypothesis.evidenceIds.join(", ")}`);
  }
  lines.push("", "## Evidence gap");
  if (brief.gaps.length === 0) lines.push("- No scenario coverage gaps.");
  for (const gap of brief.gaps) lines.push(`- ${gap.scenario}: ${gap.message}`);
  lines.push("", "Boundary: this brief is evidence inventory and bounded hypotheses, not a product recommendation or publication.", "");
  return lines.join("\n");
}

function buildScenarioSignal(scenario, records) {
  const evidence = records.filter((record) => record.scenarios.includes(scenario)).slice(0, 8);
  if (evidence.length === 0) return null;
  return {
    scenario,
    evidenceIds: evidence.map((record) => record.id),
    factClasses: [...new Set(evidence.map((record) => record.factClass))].sort(),
    trustTiers: [...new Set(evidence.map((record) => record.trustTier))].sort(),
  };
}

function buildHypothesis(signal) {
  const hasPrimaryEvidence = signal.trustTiers.some((tier) => tier === "primary" || tier === "first-party");
  return {
    id: `hypothesis-${signal.scenario}`,
    scenario: signal.scenario,
    factClass: "agent_hypothesis",
    confidence: hasPrimaryEvidence ? "medium" : "low",
    evidenceIds: [...signal.evidenceIds],
    boundary: hasPrimaryEvidence
      ? "Derived from retained first-party or primary evidence; it remains a hypothesis."
      : "Derived only from retained curated or community evidence; it remains low-confidence.",
  };
}

function projectEvidence(record) {
  return {
    id: record.id,
    title: record.title,
    url: record.url,
    publishedAt: record.publishedAt,
    collectedAt: record.collectedAt,
    sourceRole: record.sourceRole,
    trustTier: record.trustTier,
    factClass: record.factClass,
  };
}

function validateInput(db, date, timezone) {
  if (db?.schemaVersion !== "agentmo.poc-research-db.v1" || !Array.isArray(db.records)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || timezone !== "Asia/Shanghai") {
    throw briefError("AGENTMO_POC_RESEARCH_BRIEF_INVALID");
  }
  for (const record of db.records) {
    if (!validateResearchRecord(record).ok) throw briefError("AGENTMO_POC_RESEARCH_BRIEF_INVALID");
  }
}

function localDate(value, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function briefError(code) {
  const error = new Error("AgentMo POC research brief rejected the input.");
  error.code = code;
  return error;
}
