# AgentMo Discovery Manifest

Discovery manifests represent AgentMother's first stage: finding bounded data and user-need inputs before planning or production. They are input manifests only; they do not select scaffold modules or mutate build behavior.

## CLI

```bash
./bin/agentmo.js discover-report examples/win9.discovery.json --json
./bin/agentmo.js report examples/win9.agentmo.json --json
```

`discover-report` validates and summarizes one manifest. `report` loads a manifest when the blueprint sets `discovery_manifest_path` and surfaces a bounded discovery summary plus warnings.

## Schema

Required fields:

- `schemaVersion`: must be `agentmo.discovery.v1`
- `agent_id`: blueprint agent id that the manifest supports
- `source_inventory[]`: source list with `id`, `type`, `trust_level`, `description`, and `extraction_fields[]`
- `database_outputs[]`: structured database/table outputs or references
- `retrieval_outputs[]`: retrieval corpus or bounded answer-packet outputs
- `user_need_inputs[]`: user/workflow needs that shaped the agent
- `refresh_policy`: object with `cadence`, `owner`, and `stale_after`
- `forbidden_data_handling[]`: explicit handling rules for secrets, raw transcripts, or unsafe source use

Allowed source `type` values: `document`, `database`, `retrieval_corpus`, `tool_output`, `user_interview`, `runtime_trace`, `manual_inventory`.

Allowed `trust_level` values: `verified`, `trusted`, `derived`, `unverified`, `unknown`.

## Example

```json
{
  "schemaVersion": "agentmo.discovery.v1",
  "agent_id": "win9",
  "source_inventory": [
    {
      "id": "pi-win9-prompts",
      "type": "document",
      "trust_level": "verified",
      "description": "Current runtime source of truth.",
      "location": "../pi/.pi/agents/",
      "extraction_fields": ["agent purpose", "routing rules"]
    }
  ],
  "database_outputs": ["source inventory"],
  "retrieval_outputs": ["bounded answer packets"],
  "user_need_inputs": ["methodology lookup"],
  "refresh_policy": {
    "cadence": "before release",
    "owner": "AgentMo maintainers",
    "stale_after": "90 days"
  },
  "forbidden_data_handling": ["Do not store credentials or raw transcripts."]
}
```

## Safety rules

- Keep manifests small and evidence-oriented.
- Store references and bounded summaries, not raw secrets, credentials, full transcripts, or full tool result bodies.
- Treat discovery as planning input. It is not a module-pack manifest and cannot change scaffold output by itself.
