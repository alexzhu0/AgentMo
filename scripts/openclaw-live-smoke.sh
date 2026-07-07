#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/openclaw-live-smoke.sh [--blueprint examples/win9.agentmo.json] [--agent win9] [--message "Say exactly: ok"] [--provider deepseek] [--model deepseek/deepseek-v4-flash] [--thinking off] [--transport local|gateway] [--env-file .env] [--openclaw-source-root /path/to/openclaw] [--timeout-ms 120000] [--keep-state]

Runs an optional AgentMo/OpenClaw live smoke with isolated temporary state, workspace, and run output.
The helper sources only operator-provided env files that are ignored by git, records bounded AgentMo evidence, and scrubs credential-bearing OpenClaw state by default.
USAGE
}

BLUEPRINT="examples/win9.agentmo.json"
AGENT="win9"
MESSAGE="Say exactly: ok"
PROVIDER="deepseek"
MODEL="deepseek/deepseek-v4-flash"
THINKING="off"
TRANSPORT="local"
ENV_FILE=""
OPENCLAW_SOURCE_ROOT=""
TIMEOUT_MS=120000
KEEP_STATE=0
GATEWAY_PORT=""
GATEWAY_PID=""
OPENCLAW_STATE_DIR=""
GENERATED_RUNTIME_ENV_FILE=""
GENERATED_RUNTIME_ENV_ACTION="not-created"
GATEWAY_PROCESS_ACTION="not-started"
OPENCLAW_STATE_ACTION="not-created"
DEEPSEEK_API_KEY=""
DEEPSEEK_BASE_URL=""
OPENCLAW_GATEWAY_TOKEN=""
OPENCLAW_GATEWAY_PASSWORD=""
OPENCLAW_GATEWAY_URL=""
OPENCLAW_GATEWAY_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --blueprint)
      BLUEPRINT="${2:-}"
      shift 2
      ;;
    --agent)
      AGENT="${2:-}"
      shift 2
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --thinking)
      THINKING="${2:-}"
      shift 2
      ;;
    --transport)
      TRANSPORT="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --openclaw-source-root)
      OPENCLAW_SOURCE_ROOT="${2:-}"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="${2:-}"
      shift 2
      ;;
    --keep-state)
      KEEP_STATE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cleanup_runtime_artifacts() {
  if [[ -n "$GATEWAY_PID" ]]; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
    wait "$GATEWAY_PID" >/dev/null 2>&1 || true
    GATEWAY_PID=""
    GATEWAY_PROCESS_ACTION="stopped"
  fi
  if [[ -n "$GENERATED_RUNTIME_ENV_FILE" ]]; then
    rm -f "$GENERATED_RUNTIME_ENV_FILE"
    GENERATED_RUNTIME_ENV_ACTION="deleted"
    GENERATED_RUNTIME_ENV_FILE=""
  fi
  if [[ -n "$OPENCLAW_STATE_DIR" && -d "$OPENCLAW_STATE_DIR" ]]; then
    if [[ "$KEEP_STATE" -eq 1 ]]; then
      OPENCLAW_STATE_ACTION="retained-by-explicit-keep-state"
    else
      rm -rf "$OPENCLAW_STATE_DIR"
      OPENCLAW_STATE_ACTION="deleted"
    fi
  fi
}
trap cleanup_runtime_artifacts EXIT

if [[ -z "$BLUEPRINT" || -z "$AGENT" || -z "$MESSAGE" || -z "$PROVIDER" || -z "$MODEL" || -z "$THINKING" || -z "$TRANSPORT" || -z "$TIMEOUT_MS" ]]; then
  echo "Missing required value for --blueprint, --agent, --message, --provider, --model, --thinking, --transport, or --timeout-ms." >&2
  usage >&2
  exit 2
fi

if [[ ! "$TIMEOUT_MS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid --timeout-ms $TIMEOUT_MS. Expected a positive integer." >&2
  exit 2
fi

if [[ "$TRANSPORT" != "local" && "$TRANSPORT" != "gateway" ]]; then
  echo "Unsupported --transport $TRANSPORT. Expected local or gateway." >&2
  exit 2
fi

if [[ -z "$ENV_FILE" && -f .env ]]; then
  ENV_FILE=".env"
fi

if [[ "$PROVIDER" == "deepseek" && -z "$ENV_FILE" ]]; then
  echo "DeepSeek live smoke requires --env-file; the env file must be gitignored." >&2
  exit 2
fi

read_env_key() {
  local wanted="$1"
  local file="$2"
  local line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
    fi
    if [[ "$line" == "$wanted="* ]]; then
      value="${line#*=}"
      if [[ "$value" == *" #"* ]]; then
        value="${value%% #*}"
      fi
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      printf '%s' "$value"
      return 0
    fi
  done <"$file"
}

if [[ -n "$ENV_FILE" ]]; then
  if ! git check-ignore -q -- "$ENV_FILE"; then
    echo "Refusing to use env file that is not ignored by git: $ENV_FILE" >&2
    exit 2
  fi
  DEEPSEEK_API_KEY="$(read_env_key DEEPSEEK_API_KEY "$ENV_FILE")"
  DEEPSEEK_BASE_URL="$(read_env_key DEEPSEEK_BASE_URL "$ENV_FILE")"
  OPENCLAW_GATEWAY_TOKEN="$(read_env_key OPENCLAW_GATEWAY_TOKEN "$ENV_FILE")"
  OPENCLAW_GATEWAY_PASSWORD="$(read_env_key OPENCLAW_GATEWAY_PASSWORD "$ENV_FILE")"
  OPENCLAW_GATEWAY_URL="$(read_env_key OPENCLAW_GATEWAY_URL "$ENV_FILE")"
  OPENCLAW_GATEWAY_PORT="$(read_env_key OPENCLAW_GATEWAY_PORT "$ENV_FILE")"
fi

if [[ "$PROVIDER" == "deepseek" && -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "Missing required runtime env key: DEEPSEEK_API_KEY" >&2
  exit 2
fi

RUN_ID="$(date +%Y%m%dT%H%M%S)-${AGENT}-live"
export OPENCLAW_STATE_DIR
OPENCLAW_STATE_DIR="$(mktemp -d "/tmp/agentmo-openclaw-state-${RUN_ID}.XXXXXX")"
OPENCLAW_STATE_ACTION="pending-delete"
SCAFFOLD_ROOT="$(mktemp -d "/tmp/agentmo-openclaw-workspace-${RUN_ID}.XXXXXX")"
WORKSPACE="$SCAFFOLD_ROOT/openclaw/workspace"
RUN_OUT="$(mktemp -d "/tmp/agentmo-openclaw-runs-${RUN_ID}.XXXXXX")"
SUMMARY_FILE="$RUN_OUT/agentmo-live-smoke-summary.json"
SCRUB_REPORT="$RUN_OUT/agentmo-live-smoke-scrub.json"
RUN_REPORT="$RUN_OUT/agentmo-run-report.json"
RUN_EVAL="$RUN_OUT/agentmo-run-eval.json"
RUN_STATUS="$RUN_OUT/agentmo-status.json"
GATEWAY_LOG="$RUN_OUT/openclaw-gateway.log"
GATEWAY_URL=""
GATEWAY_STARTED=false
GATEWAY_TOKEN_GENERATED=false

node ./bin/agentmo.js scaffold "$BLUEPRINT" --target openclaw --out "$SCAFFOLD_ROOT" --force >/dev/null

OPENCLAW_CMD=(openclaw)
if [[ -n "$OPENCLAW_SOURCE_ROOT" ]]; then
  OPENCLAW_CMD=(pnpm openclaw)
fi

run_openclaw() {
  local env_args=(env -i OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR")
  if [[ -n "${PATH:-}" ]]; then env_args+=(PATH="$PATH"); fi
  local proxy_key
  for proxy_key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy; do
    if [[ -n "${!proxy_key:-}" ]]; then env_args+=("$proxy_key=${!proxy_key}"); fi
  done
  if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then env_args+=(DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"); fi
  if [[ -n "${DEEPSEEK_BASE_URL:-}" ]]; then env_args+=(DEEPSEEK_BASE_URL="$DEEPSEEK_BASE_URL"); fi
  if [[ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then env_args+=(OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN"); fi
  if [[ -n "${OPENCLAW_GATEWAY_PASSWORD:-}" ]]; then env_args+=(OPENCLAW_GATEWAY_PASSWORD="$OPENCLAW_GATEWAY_PASSWORD"); fi
  if [[ -n "${OPENCLAW_GATEWAY_URL:-}" ]]; then env_args+=(OPENCLAW_GATEWAY_URL="$OPENCLAW_GATEWAY_URL"); fi
  if [[ -n "${OPENCLAW_GATEWAY_PORT:-}" ]]; then env_args+=(OPENCLAW_GATEWAY_PORT="$OPENCLAW_GATEWAY_PORT"); fi
  if [[ -n "$OPENCLAW_SOURCE_ROOT" ]]; then
    (
      cd "$OPENCLAW_SOURCE_ROOT"
      "${env_args[@]}" "${OPENCLAW_CMD[@]}" "$@"
    )
  else
    "${env_args[@]}" "${OPENCLAW_CMD[@]}" "$@"
  fi
}

run_openclaw agents add "$AGENT" --workspace "$WORKSPACE" --model "$MODEL" --non-interactive --json >"$RUN_OUT/openclaw-agent-add.json"

EFFECTIVE_ENV_FILE="$ENV_FILE"
if [[ "$TRANSPORT" == "gateway" ]]; then
  GATEWAY_PORT="$((20000 + RANDOM % 20000))"
  GATEWAY_URL="ws://127.0.0.1:${GATEWAY_PORT}"
  OPENCLAW_GATEWAY_PORT="$GATEWAY_PORT"
  OPENCLAW_GATEWAY_URL="$GATEWAY_URL"
  if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
    OPENCLAW_GATEWAY_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
    GATEWAY_TOKEN_GENERATED=true
  fi
  GENERATED_RUNTIME_ENV_FILE="$(mktemp "/tmp/agentmo-openclaw-runtime-env-${RUN_ID}.XXXXXX")"
  chmod 600 "$GENERATED_RUNTIME_ENV_FILE"
  {
    printf 'DEEPSEEK_API_KEY=%s\n' "${DEEPSEEK_API_KEY:-}"
    if [[ -n "${DEEPSEEK_BASE_URL:-}" ]]; then printf 'DEEPSEEK_BASE_URL=%s\n' "$DEEPSEEK_BASE_URL"; fi
    printf 'OPENCLAW_GATEWAY_PORT=%s\n' "$OPENCLAW_GATEWAY_PORT"
    printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "$OPENCLAW_GATEWAY_TOKEN"
    printf 'OPENCLAW_GATEWAY_URL=%s\n' "$OPENCLAW_GATEWAY_URL"
  } >"$GENERATED_RUNTIME_ENV_FILE"
  EFFECTIVE_ENV_FILE="$GENERATED_RUNTIME_ENV_FILE"
  run_openclaw gateway run --port "$GATEWAY_PORT" --bind loopback --auth token --allow-unconfigured --dev >"$GATEWAY_LOG" 2>&1 &
  GATEWAY_PID=$!
  GATEWAY_STARTED=true
  sleep 3
fi

ENV_ARGS=()
if [[ -n "$EFFECTIVE_ENV_FILE" ]]; then
  ENV_ARGS=(--env-file "$EFFECTIVE_ENV_FILE")
fi

SOURCE_ARGS=()
if [[ -n "$OPENCLAW_SOURCE_ROOT" ]]; then
  SOURCE_ARGS=(--openclaw-source-root "$OPENCLAW_SOURCE_ROOT")
fi

node ./bin/agentmo.js run "$BLUEPRINT" \
  --target openclaw \
  --workspace "$WORKSPACE" \
  --openclaw-state-dir "$OPENCLAW_STATE_DIR" \
  --agent "$AGENT" \
  --provider "$PROVIDER" \
  --model "$MODEL" \
  --thinking "$THINKING" \
  --channel local-cli \
  --transport "$TRANSPORT" \
  --timeout-ms "$TIMEOUT_MS" \
  --message "$MESSAGE" \
  --out "$RUN_OUT" \
  "${ENV_ARGS[@]}" \
  "${SOURCE_ARGS[@]}" \
  --live \
  --json >"$RUN_OUT/agentmo-run.json"

RUN_STATE="$(find "$RUN_OUT/runs" -name agentmo-run-state.json -print | sort | tail -n 1)"
RUN_EVAL_EXIT=0
RUN_STATUS_EXIT=0
node ./bin/agentmo.js run-report "$RUN_STATE" --json >"$RUN_REPORT"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status success --json >"$RUN_EVAL" || RUN_EVAL_EXIT=$?
node ./bin/agentmo.js status "$BLUEPRINT" --run-dir "$RUN_OUT" --json >"$RUN_STATUS" || RUN_STATUS_EXIT=$?

cleanup_runtime_artifacts

OUTPUT="$SCRUB_REPORT" \
OPENCLAW_STATE_ACTION="$OPENCLAW_STATE_ACTION" \
GENERATED_RUNTIME_ENV_ACTION="$GENERATED_RUNTIME_ENV_ACTION" \
GATEWAY_PROCESS_ACTION="$GATEWAY_PROCESS_ACTION" \
KEEP_STATE="$KEEP_STATE" \
node <<'NODE'
const fs = require("node:fs");

const scrubReport = {
  schemaVersion: "agentmo.live-smoke-scrub.v1",
  credentialBearingOpenClawState: process.env.OPENCLAW_STATE_ACTION,
  generatedRuntimeEnvFile: process.env.GENERATED_RUNTIME_ENV_ACTION,
  gatewayProcess: process.env.GATEWAY_PROCESS_ACTION,
  keepState: process.env.KEEP_STATE === "1",
};

fs.writeFileSync(process.env.OUTPUT, `${JSON.stringify(scrubReport, null, 2)}\n`);
NODE

OUTPUT="$SUMMARY_FILE" \
BLUEPRINT="$BLUEPRINT" \
AGENT="$AGENT" \
PROVIDER="$PROVIDER" \
MODEL="$MODEL" \
THINKING="$THINKING" \
TIMEOUT_MS="$TIMEOUT_MS" \
TRANSPORT="$TRANSPORT" \
GATEWAY_STARTED="$GATEWAY_STARTED" \
GATEWAY_TOKEN_GENERATED="$GATEWAY_TOKEN_GENERATED" \
GATEWAY_URL="$GATEWAY_URL" \
WORKSPACE="$WORKSPACE" \
RUN_OUT="$RUN_OUT" \
RUN_STATE="$RUN_STATE" \
RUN_REPORT="$RUN_REPORT" \
RUN_EVAL="$RUN_EVAL" \
RUN_STATUS="$RUN_STATUS" \
SCRUB_REPORT="$SCRUB_REPORT" \
RUN_EVAL_EXIT="$RUN_EVAL_EXIT" \
RUN_STATUS_EXIT="$RUN_STATUS_EXIT" \
node <<'NODE'
const fs = require("node:fs");

function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

const summary = {
  schemaVersion: "agentmo.live-smoke-summary.v1",
  blueprint: process.env.BLUEPRINT,
  agent: process.env.AGENT,
  provider: process.env.PROVIDER,
  model: process.env.MODEL,
  thinking: process.env.THINKING,
  timeoutMs: parseInteger(process.env.TIMEOUT_MS, "TIMEOUT_MS"),
  transportRequested: process.env.TRANSPORT,
  gatewayStarted: process.env.GATEWAY_STARTED === "true",
  gatewayTokenGenerated: process.env.GATEWAY_TOKEN_GENERATED === "true",
  gatewayUrl: process.env.GATEWAY_URL,
  workspace: process.env.WORKSPACE,
  runOut: process.env.RUN_OUT,
  runState: process.env.RUN_STATE,
  runReport: process.env.RUN_REPORT,
  runEval: process.env.RUN_EVAL,
  status: process.env.RUN_STATUS,
  scrubReport: process.env.SCRUB_REPORT,
  runEvalExitCode: parseInteger(process.env.RUN_EVAL_EXIT, "RUN_EVAL_EXIT"),
  statusExitCode: parseInteger(process.env.RUN_STATUS_EXIT, "RUN_STATUS_EXIT"),
  credentialValuesPersisted: false,
  certificationClaimed: false,
};

fs.writeFileSync(process.env.OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);
NODE

cat "$SUMMARY_FILE"
if [[ "$RUN_EVAL_EXIT" -ne 0 ]]; then
  exit "$RUN_EVAL_EXIT"
fi
if [[ "$RUN_STATUS_EXIT" -ne 0 ]]; then
  exit "$RUN_STATUS_EXIT"
fi
