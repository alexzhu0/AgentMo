#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/openclaw-live-smoke.sh [--blueprint examples/win9.agentmo.json] [--agent win9] [--message "Say exactly: ok"] [--openclaw-source-root /path/to/openclaw]

Runs an optional AgentMo/OpenClaw live smoke with isolated temporary state.
This is not part of mandatory npm run check gates and requires a working OpenClaw CLI/source checkout plus any operator-provided auth.
USAGE
}

BLUEPRINT="examples/win9.agentmo.json"
AGENT="win9"
MESSAGE="Say exactly: ok"
OPENCLAW_SOURCE_ROOT=""

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
    --openclaw-source-root)
      OPENCLAW_SOURCE_ROOT="${2:-}"
      shift 2
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

if [[ -z "$BLUEPRINT" || -z "$AGENT" || -z "$MESSAGE" ]]; then
  echo "Missing required value for --blueprint, --agent, or --message." >&2
  usage >&2
  exit 2
fi

RUN_ID="$(date +%Y%m%dT%H%M%S)-${AGENT}-live"
export OPENCLAW_STATE_DIR
OPENCLAW_STATE_DIR="$(mktemp -d "/tmp/agentmo-openclaw-state-${RUN_ID}.XXXXXX")"
WORKSPACE="$(mktemp -d "/tmp/agentmo-openclaw-workspace-${RUN_ID}.XXXXXX")"
RUN_OUT="$(mktemp -d "/tmp/agentmo-openclaw-runs-${RUN_ID}.XXXXXX")"

cleanup_note() {
  cat <<EOF
AgentMo OpenClaw live smoke paths:
  OPENCLAW_STATE_DIR=$OPENCLAW_STATE_DIR
  WORKSPACE=$WORKSPACE
  RUN_OUT=$RUN_OUT

These directories are temporary evidence artifacts. Inspect or remove them manually after recording required evidence.
EOF
}
trap cleanup_note EXIT

SOURCE_ARGS=()
if [[ -n "$OPENCLAW_SOURCE_ROOT" ]]; then
  SOURCE_ARGS=(--openclaw-source-root "$OPENCLAW_SOURCE_ROOT")
fi

node ./bin/agentmo.js run "$BLUEPRINT" \
  --target openclaw \
  --workspace "$WORKSPACE" \
  --openclaw-state-dir "$OPENCLAW_STATE_DIR" \
  --agent "$AGENT" \
  --channel local-cli \
  --transport local \
  --message "$MESSAGE" \
  --out "$RUN_OUT" \
  "${SOURCE_ARGS[@]}" \
  --live \
  --json

node ./bin/agentmo.js status "$BLUEPRINT" --run-dir "$RUN_OUT" --json
