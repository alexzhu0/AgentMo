const DISCOVERY_MANIFEST_SUBJECTS = Object.freeze(["discovery-manifest"]);
const AGENT_IDEA_CANDIDATE_REPORT_SUBJECTS = Object.freeze([
  "agent-idea-candidate",
  "discovery-db",
]);
const USER_NEED_SUBJECTS = Object.freeze(["user-need"]);
const DISCOVERY_APPROVAL_SUBJECTS = Object.freeze(["discovery-manifest", "discovery-db"]);
const DESIGN_PLAN_SUBJECTS = Object.freeze([
  "discovery-manifest",
  "discovery-db",
  "discovery-approval",
  "user-need",
  "decision-ledger",
]);
const DECISION_LEDGER_SUBJECTS = Object.freeze(["decision-entry"]);
const BLUEPRINT_DRAFT_SUBJECTS = Object.freeze(["discovery-db", "user-need"]);
const BLUEPRINT_DRAFT_OPTIONAL_SUBJECTS = Object.freeze(["design-plan"]);
const BLUEPRINT_SUBJECTS = Object.freeze(["blueprint"]);
const BUILD_CONTRACT_SUBJECTS = Object.freeze([
  "blueprint",
  "design-plan",
  "discovery-approval",
  "decision-ledger",
  "openclaw-target-descriptor",
]);
const BUILD_CONTRACT_OPTIONAL_SUBJECTS = Object.freeze(["native-plugin-recipe"]);
const PLAN_APPROVAL_SUBJECTS = Object.freeze(["blueprint", "build-contract"]);
const OPENCLAW_TARGET_ADMISSION_SUBJECTS = Object.freeze([
  "blueprint",
  "build-contract",
  "plan-approval",
  "openclaw-target-descriptor",
  "target-executable",
  "target-package-json",
  "target-build-info",
]);
const PACKAGE_PRODUCE_SUBJECTS = Object.freeze([
  "blueprint",
  "design-plan",
  "discovery-approval",
  "decision-ledger",
  "build-contract",
  "plan-approval",
  "openclaw-target-descriptor",
  "openclaw-target-carrier-admission",
]);
const PACKAGE_INSPECT_SUBJECTS = Object.freeze(["package-manifest"]);
const OPENCLAW_PROBE_SUBJECTS = Object.freeze([
  "package-manifest",
  "openclaw-target-carrier-admission",
]);
const OPENCLAW_INSTALL_GENESIS_SUBJECTS = Object.freeze(["openclaw-probe"]);
const OPENCLAW_INSTALL_APPROVE_SUBJECTS = Object.freeze([
  "openclaw-install-plan",
]);
export const OPENCLAW_INSTALL_RECEIPT_SUBJECT =
  "openclaw-install-receipt";
const OPENCLAW_TARGET_DESCRIPTOR_SUBJECTS = Object.freeze([
  "target-executable",
  "target-package-json",
  "target-build-info",
]);
const RUNTIME_PLAN_SUBJECTS = Object.freeze(["runtime-plan"]);
const RUN_STATE_SUBJECTS = Object.freeze(["run-state"]);
const OBSERVATION_SUBJECTS = Object.freeze(["observation"]);
const BIRTH_REPORT_SUBJECTS = Object.freeze(["blueprint", "build-state", "run-state", "run-eval"]);
const DOMAIN_EVAL_SUBJECTS = Object.freeze(["blueprint", "domain-cases"]);
const DELIVERY_REPORT_SUBJECTS = Object.freeze([
  "blueprint",
  "build-state",
  "run-state",
  "run-eval",
  "birth-report",
]);
const REPORT_OPTIONAL_SUBJECTS = Object.freeze(["discovery-manifest"]);
const DELIVERY_REPORT_OPTIONAL_SUBJECTS = Object.freeze(["domain-eval"]);
const STATUS_OPTIONAL_SUBJECTS = Object.freeze(["build-state", "run-state", "run-index"]);
const RUN_INDEX_OPTIONAL_SUBJECTS = Object.freeze(["run-index"]);
const MAX_MIGRATION_INPUTS = 10_000;
const SHELL_FILE_EXPRESSION_PATTERN = /^[A-Za-z0-9_./:${}<>@+-]+$/u;
const EXACT_FILE_DIGEST_NODE_SOURCE = 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));';

export const DURABLE_COMMAND_SUBJECTS = Object.freeze({
  "discover-report": DISCOVERY_MANIFEST_SUBJECTS,
  "discover-pack": DISCOVERY_MANIFEST_SUBJECTS,
  "discover-live": DISCOVERY_MANIFEST_SUBJECTS,
  "discover-workspace": DISCOVERY_MANIFEST_SUBJECTS,
  "agent-idea-candidate-report": AGENT_IDEA_CANDIDATE_REPORT_SUBJECTS,
  "discovery-approve": DISCOVERY_APPROVAL_SUBJECTS,
  "need-report": USER_NEED_SUBJECTS,
  "decision-ledger": DECISION_LEDGER_SUBJECTS,
  "design-plan": DESIGN_PLAN_SUBJECTS,
  "blueprint-draft": BLUEPRINT_DRAFT_SUBJECTS,
  "build-contract": BUILD_CONTRACT_SUBJECTS,
  "plan-approve": PLAN_APPROVAL_SUBJECTS,
  "openclaw-target-describe": OPENCLAW_TARGET_DESCRIPTOR_SUBJECTS,
  "openclaw-target-admit": OPENCLAW_TARGET_ADMISSION_SUBJECTS,
  "package-produce": PACKAGE_PRODUCE_SUBJECTS,
  "package-inspect": PACKAGE_INSPECT_SUBJECTS,
  "openclaw-probe": OPENCLAW_PROBE_SUBJECTS,
  validate: BLUEPRINT_SUBJECTS,
  report: BLUEPRINT_SUBJECTS,
  plan: BLUEPRINT_SUBJECTS,
  handoff: BLUEPRINT_SUBJECTS,
  "run-plan": BLUEPRINT_SUBJECTS,
  run: RUNTIME_PLAN_SUBJECTS,
  "run-report": RUN_STATE_SUBJECTS,
  "replay-run": RUN_STATE_SUBJECTS,
  "run-eval": RUN_STATE_SUBJECTS,
  "birth-report": BIRTH_REPORT_SUBJECTS,
  "domain-eval": DOMAIN_EVAL_SUBJECTS,
  "delivery-report": DELIVERY_REPORT_SUBJECTS,
  "observe-run": RUN_STATE_SUBJECTS,
  observe: OBSERVATION_SUBJECTS,
  status: BLUEPRINT_SUBJECTS,
  scaffold: BLUEPRINT_SUBJECTS,
});

export const OPTIONAL_DURABLE_COMMAND_SUBJECTS = Object.freeze({
  "build-contract": BUILD_CONTRACT_OPTIONAL_SUBJECTS,
  "blueprint-draft": BLUEPRINT_DRAFT_OPTIONAL_SUBJECTS,
  report: REPORT_OPTIONAL_SUBJECTS,
  run: RUN_INDEX_OPTIONAL_SUBJECTS,
  "replay-run": RUN_INDEX_OPTIONAL_SUBJECTS,
  "delivery-report": DELIVERY_REPORT_OPTIONAL_SUBJECTS,
  status: STATUS_OPTIONAL_SUBJECTS,
});

export function subjectsForCommand(command, options = {}) {
  if (command === "openclaw-install-apply") {
    const lifecycle = options.lifecycle;
    const sensitiveActionCount = options.sensitiveActionCount;
    const hasConflicts = options.hasConflicts;
    if (!["install", "upgrade", "rollback", "uninstall"].includes(lifecycle)
      || !Number.isSafeInteger(sensitiveActionCount)
      || sensitiveActionCount < 0
      || sensitiveActionCount > 128
      || typeof hasConflicts !== "boolean") {
      return unsupported();
    }
    return Object.freeze([
      "openclaw-target-carrier-admission",
      "openclaw-probe",
      "openclaw-install-plan",
      "openclaw-install-approval",
      ...Array.from(
        { length: sensitiveActionCount },
        () => "openclaw-sensitive-action-decision",
      ),
      ...(hasConflicts ? ["openclaw-conflict-approval"] : []),
      ...(lifecycle === "install"
        ? ["openclaw-absent-genesis"]
        : lifecycle === "rollback"
          ? [
            OPENCLAW_INSTALL_RECEIPT_SUBJECT,
            OPENCLAW_INSTALL_RECEIPT_SUBJECT,
          ]
          : [OPENCLAW_INSTALL_RECEIPT_SUBJECT]),
    ]);
  }
  if (command === "openclaw-install-genesis") {
    return OPENCLAW_INSTALL_GENESIS_SUBJECTS;
  }
  if (command === "openclaw-install-approve") {
    return OPENCLAW_INSTALL_APPROVE_SUBJECTS;
  }
  if (command === "openclaw-install-preview") {
    const lifecycle = options.lifecycle;
    if (lifecycle === "install") {
      return Object.freeze(["openclaw-probe", "openclaw-absent-genesis"]);
    }
    if (lifecycle === "upgrade" || lifecycle === "uninstall") {
      return Object.freeze(["openclaw-probe", OPENCLAW_INSTALL_RECEIPT_SUBJECT]);
    }
    if (lifecycle === "rollback") {
      return Object.freeze([
        "openclaw-probe",
        OPENCLAW_INSTALL_RECEIPT_SUBJECT,
        OPENCLAW_INSTALL_RECEIPT_SUBJECT,
      ]);
    }
    return unsupported();
  }
  if (command === "migrate") {
    const inputCount = options.inputCount;
    if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > MAX_MIGRATION_INPUTS) {
      return unsupported();
    }
    return Object.freeze(
      Array.from({ length: inputCount }, (_, index) => `migration-input-${index}`),
    );
  }
  const subjects = DURABLE_COMMAND_SUBJECTS[command];
  if (subjects) {
    const included = options.includeOptionalSubjects ?? [];
    if (!Array.isArray(included) || new Set(included).size !== included.length) return unsupported();
    const optional = OPTIONAL_DURABLE_COMMAND_SUBJECTS[command] ?? [];
    if (included.some((subject) => !optional.includes(subject))) return unsupported();
    if (included.length === 0) return subjects;
    return Object.freeze([...subjects, ...optional.filter((subject) => included.includes(subject))]);
  }
  return unsupported();
}

export function renderDigestBindings(command, subjectToFileExpression) {
  const entries = bindingEntries(subjectToFileExpression);
  const providedSubjects = entries.map(([subject]) => subject);
  const resolverOptions = command === "migrate"
    ? { inputCount: providedSubjects.length }
    : {
        includeOptionalSubjects: providedSubjects.filter((subject) => (
          (OPTIONAL_DURABLE_COMMAND_SUBJECTS[command] ?? []).includes(subject)
        )),
      };
  const expectedSubjects = subjectsForCommand(command, resolverOptions);
  if (providedSubjects.length !== expectedSubjects.length
    || expectedSubjects.some((subject) => !Object.hasOwn(subjectToFileExpression, subject))) {
    return unsupported();
  }

  const fileExpressions = new Map(entries);
  return expectedSubjects.map((subject) => {
    const fileExpression = fileExpressions.get(subject);
    if (typeof fileExpression !== "string"
      || fileExpression.length === 0
      || !SHELL_FILE_EXPRESSION_PATTERN.test(fileExpression)) {
      return unsupported();
    }
    return `--digest "${subject}=$(node -e '${EXACT_FILE_DIGEST_NODE_SOURCE}' "${fileExpression}")"`;
  }).join(" ");
}

function bindingEntries(value) {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return unsupported();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return unsupported();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return unsupported();
    return keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        return unsupported();
      }
      return [key, descriptor.value];
    });
  } catch (error) {
    if (error?.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED") throw error;
    return unsupported();
  }
}

function unsupported() {
  const error = new Error("Durable command subject contract is unsupported.");
  error.code = "AGENTMO_DURABLE_COMMAND_UNSUPPORTED";
  throw error;
}
