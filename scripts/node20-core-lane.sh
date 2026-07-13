#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' "Usage: npm run check:core:node20 -- --node-bin <canonical-node> --archive <node-archive.tar.gz> --checksums <SHASUMS256.txt> --expected-version <20.x.y> --expected-arch <arch> --receipt <receipt.json>"
}

fail_required_input() {
  printf '%s\n' "AGENTMO_NODE20_LANE_REQUIRED_INPUT" >&2
  usage >&2
  exit 2
}

NODE_BIN=""
ARCHIVE=""
CHECKSUMS=""
EXPECTED_VERSION=""
EXPECTED_ARCH=""
RECEIPT=""

while [[ $# -gt 0 ]]; do
  if [[ $# -lt 2 ]]; then
    fail_required_input
  fi
  option="$1"
  value="$2"
  shift 2
  if [[ -z "$value" ]]; then
    fail_required_input
  fi
  case "$option" in
    --node-bin)
      [[ -z "$NODE_BIN" ]] || fail_required_input
      NODE_BIN="$value"
      ;;
    --archive)
      [[ -z "$ARCHIVE" ]] || fail_required_input
      ARCHIVE="$value"
      ;;
    --checksums)
      [[ -z "$CHECKSUMS" ]] || fail_required_input
      CHECKSUMS="$value"
      ;;
    --expected-version)
      [[ -z "$EXPECTED_VERSION" ]] || fail_required_input
      EXPECTED_VERSION="$value"
      ;;
    --expected-arch)
      [[ -z "$EXPECTED_ARCH" ]] || fail_required_input
      EXPECTED_ARCH="$value"
      ;;
    --receipt)
      [[ -z "$RECEIPT" ]] || fail_required_input
      RECEIPT="$value"
      ;;
    *)
      fail_required_input
      ;;
  esac
done

if [[ -z "$NODE_BIN" || -z "$ARCHIVE" || -z "$CHECKSUMS" || -z "$EXPECTED_VERSION" || -z "$EXPECTED_ARCH" || -z "$RECEIPT" ]]; then
  fail_required_input
fi

if [[ "$NODE_BIN" != /* || ! -f "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  printf '%s\n' "AGENTMO_NODE20_LANE_NODE_BIN_INVALID" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
HELPER="$SCRIPT_DIR/node20-core-receipt.js"

if [[ ! -f "$HELPER" ]]; then
  printf '%s\n' "AGENTMO_NODE20_LANE_HELPER_MISSING" >&2
  exit 1
fi

unset NODE_OPTIONS
unset NODE_PATH

"$NODE_BIN" "$HELPER" \
  --repository-root "$REPOSITORY_ROOT" \
  --node-bin "$NODE_BIN" \
  --archive "$ARCHIVE" \
  --checksums "$CHECKSUMS" \
  --expected-version "$EXPECTED_VERSION" \
  --expected-arch "$EXPECTED_ARCH" \
  --receipt "$RECEIPT"

if [[ ! -f "$RECEIPT" ]]; then
  printf '%s\n' "AGENTMO_NODE20_LANE_RECEIPT_NOT_PUBLISHED" >&2
  exit 1
fi

# The selected helper verifies process.versions.node inside the launched process.
# Rejected legacy value: AGENTMO_NODE20_CORE_LANE="agentmo-node20-core-v1".
# Compatibility inventory tokens only; the executable command manifest lives
# exclusively in node20-core-receipt.js and binds these files by digest:
# test/artifact-admission.test.js
# test/persistability.test.js
# test/runtime-compatibility.test.js
# test/runtime-compatibility-seams.test.js
# test/node20-core-lane.test.js
# test/stage-contracts.test.js
