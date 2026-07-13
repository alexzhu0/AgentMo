const MAX_SHELL_TOKENS = 512;

export class ShellControlContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShellControlContractError";
    this.code = code;
  }
}

export function parseShellControlSegments(source, label) {
  const normalized = String(source).replace(/\\\r?\n\s*/gu, " ");
  const segments = [];
  let tokens = [];
  let token = "";
  let quote = null;
  let escaping = false;
  let incomingEdge = "start";
  let awaitingCommand = false;

  const pushToken = () => {
    if (token.length === 0) return;
    tokens.push(token);
    token = "";
    if (tokens.length > MAX_SHELL_TOKENS) {
      fail("AGENTMO_SHELL_TOKEN_LIMIT", label, "shell token limit exceeded");
    }
  };
  const pushSegment = () => {
    pushToken();
    if (tokens.length === 0) return false;
    segments.push({
      tokens,
      ordinal: segments.length,
      incomingEdge,
    });
    tokens = [];
    awaitingCommand = false;
    return true;
  };
  const separate = (edge) => {
    if (pushSegment()) {
      incomingEdge = edge;
      awaitingCommand = true;
      return;
    }
    if (edge === "newline") return;
    fail("AGENTMO_SHELL_CONTROL_EMPTY_SEGMENT", label, `empty command before ${edge}`);
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "`") {
      fail("AGENTMO_SHELL_CONTROL_UNSUPPORTED", label, "backtick command substitution is outside the bounded grammar");
    }
    if (character === "#" && token.length === 0) {
      while (index < normalized.length && normalized[index] !== "\n") index += 1;
      separate("newline");
      continue;
    }
    if (/\s/u.test(character)) {
      pushToken();
      if (character === "\n") separate("newline");
      continue;
    }
    if (character === "&") {
      if (normalized[index + 1] !== "&") {
        fail("AGENTMO_SHELL_CONTROL_UNSUPPORTED", label, "background control edge is outside the bounded grammar");
      }
      separate("&&");
      index += 1;
      continue;
    }
    if (character === "|") {
      const edge = normalized[index + 1] === "|" ? "||" : "|";
      separate(edge);
      if (edge === "||") index += 1;
      continue;
    }
    if (character === ";") {
      if (normalized[index + 1] === ";") {
        fail("AGENTMO_SHELL_CONTROL_UNSUPPORTED", label, "case terminator is outside the bounded grammar");
      }
      separate(";");
      continue;
    }
    token += character;
  }

  if (quote !== null) fail("AGENTMO_SHELL_QUOTING_AMBIGUOUS", label, "ambiguous shell quoting");
  if (escaping) fail("AGENTMO_SHELL_ESCAPE_DANGLING", label, "dangling shell escape");
  pushSegment();
  if (awaitingCommand && ["&&", "||", "|"].includes(incomingEdge)) {
    fail("AGENTMO_SHELL_CONTROL_DANGLING_EDGE", label, `dangling ${incomingEdge} control edge`);
  }
  return segments;
}

export function assertPreflightDominatesMutation(source, label, options) {
  const segments = parseShellControlSegments(source, label);
  let previousSegmentIsAuthorized = false;
  const findings = [];

  for (const segment of segments) {
    const segmentLabel = `${label}:${segment.ordinal}`;
    const isPreflight = options.isPreflight(segment.tokens);
    const inheritedAuthorization = segment.incomingEdge === "&&" && previousSegmentIsAuthorized;
    const classified = options.classifyCommand(segment.tokens, segmentLabel) ?? [];

    for (const finding of classified) {
      findings.push({ ...finding, ordinal: segment.ordinal, incomingEdge: segment.incomingEdge });
      if (finding.requiresPreflight !== true) continue;
      if (!inheritedAuthorization) {
        fail(edgeFailureCode(segment.incomingEdge), segmentLabel, `${finding.key ?? "effect"} is not dominated by successful runtime preflight`);
      }
    }

    const preflightSuccessControlsNext = isPreflight
      && segment.incomingEdge !== "||"
      && segment.incomingEdge !== "|";
    previousSegmentIsAuthorized = preflightSuccessControlsNext || inheritedAuthorization;
  }

  return { segments, findings };
}

function edgeFailureCode(edge) {
  if (edge === "||") return "AGENTMO_SHELL_PREFLIGHT_OR_EDGE";
  if (edge === ";") return "AGENTMO_SHELL_PREFLIGHT_SEQUENCE_EDGE";
  if (edge === "newline") return "AGENTMO_SHELL_PREFLIGHT_NEWLINE_EDGE";
  if (edge === "|") return "AGENTMO_SHELL_PREFLIGHT_PIPE_EDGE";
  if (edge === "&&") return "AGENTMO_SHELL_PREFLIGHT_DISCONNECTED";
  return "AGENTMO_SHELL_PREFLIGHT_MISSING";
}

function fail(code, label, message) {
  throw new ShellControlContractError(code, `${label}: ${message}`);
}
