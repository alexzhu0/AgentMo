# OpenClaw Runtime Notes

Source inspected for AgentMo runtime profiling:

- Local source: `/home/alex/DTAlex/learningGitHub/openclaw`
- Commit: `5bcd25f0fb fix(discord): gate guild metadata reads [AI] (#98966)`
- Package: `openclaw@2026.6.11`
- CLI bin: `openclaw -> openclaw.mjs`

## Architecture facts to preserve

OpenClaw separates four layers that AgentMother must not collapse:

| Layer | OpenClaw examples | AgentMother implication |
| --- | --- | --- |
| Provider | `openai`, `anthropic`, `github-copilot` | Auth/model catalog ownership. |
| Model | `gpt-5.5`, `claude-opus-4-6` | Selected inference target. |
| Agent runtime | `openclaw`, `codex`, `copilot`, `claude-cli` | Loop/backend that executes the prepared turn. |
| Channel | Telegram, Discord, Slack, WhatsApp | Ingress/egress surface, not the domain agent itself. |

The built-in OpenClaw runtime id is `openclaw`. Plugin harnesses can register more runtime ids. `auto` selects a supporting plugin harness when one exists and otherwise falls back to OpenClaw.

## Runtime layout

OpenClaw's runtime architecture maps to AgentMother profile fields as follows:

| OpenClaw surface | Meaning for AgentMother |
| --- | --- |
| `src/agents/embedded-agent-runner/` | Attempt loop, provider stream adapters, model selection, compaction, session wiring. |
| `src/agents/sessions/` | Session persistence, extension loading, resource discovery, skills, prompts, themes. |
| `packages/agent-core/` | Reusable agent core and lower-level harness contracts. |
| `src/agents/runtime/` | OpenClaw facade over the agent core. |
| `src/agents/agent-tools*.ts` | OpenClaw-owned tool definitions, schemas, policy, and hook adapters. |
| `src/agents/agent-hooks/` | Built-in runtime hooks such as compaction safeguards and context pruning. |
| `src/llm/` | Model/provider registry and provider-specific streams. |
| `src/gateway/`, `src/channels/` | WebSocket Gateway and messaging delivery surfaces. |

## Multi-agent isolation rule

OpenClaw defines an agent as a fully scoped brain:

- workspace files: `AGENTS.md`, `SOUL.md`, `USER.md`, local memory, skills;
- state directory: `~/.openclaw/agents/<agentId>/agent`;
- auth profiles: per-agent credentials and model profiles;
- session store: `~/.openclaw/agents/<agentId>/sessions`.

AgentMother should preserve this as a reusable rule: workspace, auth, and session evidence must be scoped per agent unless sharing is explicit. Do not reuse an `agentDir` across agents.

## Session and evidence rule

OpenClaw session inspection is bounded by default:

- session lists return newest 100 rows unless callers ask for another limit;
- trajectory tails redact prompt text, tool args, and tool result bodies;
- trajectory exports live inside `.openclaw/trajectory-exports/` under the selected workspace;
- cleanup and compaction are explicit session-maintenance paths.

AgentMother should encode equivalent evidence boundaries for every runtime profile: default to bounded summaries, require explicit audit expansion, and never treat raw transcripts as normal prompt context.

## Agent loop rule

OpenClaw's loop is intake → context assembly → model inference → tool execution → streaming replies → persistence. Runs are serialized per session key and protected by session write locks. Runtime profiles should therefore record:

- model loop owner;
- canonical thread/session owner;
- dynamic tool and native tool hook support;
- context lifecycle and compaction owner;
- channel delivery owner;
- known unsupported surfaces.

## Transfer into AgentMo

For the Win9 blueprint, Pi remains the certified execution authority. OpenClaw is recorded as an active alternate architecture reference, not as an implicit Pi-compatible API.

Use OpenClaw concepts when designing future agents:

1. Gateway/channel delivery as a control-plane and ingress/egress pattern.
2. Isolated agent workspaces and per-agent session stores as memory/evidence boundaries.
3. Runtime ownership tables to avoid provider/model/runtime/channel confusion.
4. Session trajectory redaction as a default audit posture.
5. Plugin hook names as inspiration only when the active runtime exposes equivalent hooks.
