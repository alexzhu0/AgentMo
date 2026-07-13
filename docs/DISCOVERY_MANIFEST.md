# AgentMo Discovery Manifest

Discovery manifests represent AgentMo's first stage: finding bounded data and user-need inputs before planning or production. They are input manifests only; they do not select scaffold modules, invoke planning, or mutate build behavior.

## CLI

Manifest validation and reporting:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js discover-report examples/win9.discovery.json --json --digest "discovery-manifest=$(digest_file "examples/win9.discovery.json")"
./bin/agentmo.js report examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
```

Stage 1 materialization has two paths:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
DISCOVERY_MANIFEST=path/to/discovery.json
SOURCE_ROOT=path/to/source-root
OUTPUT_ROOT=path/to/discovery-output
./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out /tmp/support-triage-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
agentmo discover-workspace "$DISCOVERY_MANIFEST" --source-root "$SOURCE_ROOT" --out "$OUTPUT_ROOT" --json --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")"
./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out /tmp/support-triage-workspace-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

`discover-report` validates and summarizes one manifest. `report` loads a manifest when the blueprint sets `discovery_manifest_path` and surfaces a bounded discovery summary plus warnings.

`discover-pack` is the manifest-only path. It materializes the manifest into:

```text
agentmo-discovery-db.json
facts.jsonl
coverage.json
```

`discover-workspace` is the approved local source-intake path. It reads only supported local source files referenced by the manifest under the repo-bound `--source-root` and writes:

```text
agentmo-discovery-db.json
facts.jsonl
coverage.json
source-cards.json
source-chunks.jsonl
```

Source-derived evidence enters `agentmo-discovery-db.json.facts` and `facts.jsonl` as `kind:"source_chunk"` records. `source-cards.json` and `source-chunks.jsonl` are supplemental sidecars. The discovery DB remains the durable Stage 2 `blueprint-draft` input; unsafe workspace DBs fail closed and must not enter Stage 2.

Neither Stage 1 path performs web crawling, live search, browser automation, or search API collection. Stage 1 does not invoke Stage 2/3 and must not write blueprint, handoff, build, run, birth, domain-eval, or delivery artifacts.

## Schema

Required fields:

- `schemaVersion`: must be `agentmo.discovery.v1`
- `agent_id`: blueprint agent id that the manifest supports
- `source_inventory[]`: source list with `id`, `type`, `trust_level`, `description`, optional `location`, and `extraction_fields[]`
- `database_outputs[]`: structured database/table outputs or references
- `retrieval_outputs[]`: retrieval corpus or bounded answer-packet outputs
- `user_need_inputs[]`: user/workflow needs that shaped the agent
- `refresh_policy`: object with `cadence`, `owner`, and `stale_after`
- `forbidden_data_handling[]`: explicit handling rules for secrets, raw transcripts, or unsafe source use

For `discover-workspace`, each source intended for intake must have a `location` that resolves inside `--source-root`. In the MVP, supported local source formats are Markdown/text (`.md`, `.txt`) and JSON (`.json`). Unsupported required sources make the workspace result fail closed.

Allowed source `type` values: `document`, `database`, `retrieval_corpus`, `tool_output`, `user_interview`, `runtime_trace`, `manual_inventory`.

Allowed `trust_level` values: `verified`, `trusted`, `derived`, `unverified`, `unknown`.

## Example

```json
{
  "schemaVersion": "agentmo.discovery.v1",
  "agent_id": "support-triage",
  "source_inventory": [
    {
      "id": "support-policy-handbook",
      "type": "document",
      "trust_level": "verified",
      "description": "Bounded support policy reference for refunds, escalations, account access, and evidence-required replies.",
      "location": "examples/fixtures/support-triage/policy-handbook.md",
      "extraction_fields": [
        "refund eligibility rules",
        "account access escalation triggers",
        "evidence requirements for customer-facing replies"
      ]
    }
  ],
  "database_outputs": ["support source inventory"],
  "retrieval_outputs": ["bounded policy evidence cards"],
  "user_need_inputs": ["triage incoming support tickets by category and priority"],
  "refresh_policy": {
    "cadence": "before every support policy release",
    "owner": "support operations lead",
    "stale_after": "30 days"
  },
  "forbidden_data_handling": [
    "Do not store credentials, customer secrets, raw ticket transcripts, or full tool result bodies in managed AgentMo evidence."
  ]
}
```

## Safety rules

- Keep manifests small and evidence-oriented.
- Store references and bounded summaries, not raw secrets, credentials, full transcripts, or full tool result bodies.
- Do not point `--source-root` at `.env` files, key/cert directories, parent directories, sibling projects, or other secret roots.
- `discover-workspace` must reject traversal, source-root escape, denied secret filenames, and unsupported required sources before treating the workspace as safe.
- Secret-like source content must be redacted in emitted artifacts and must mark the workspace DB unsafe so Stage 2 rejects it.
- Treat discovery as planning input. It is not a module-pack manifest and cannot change scaffold output by itself.
