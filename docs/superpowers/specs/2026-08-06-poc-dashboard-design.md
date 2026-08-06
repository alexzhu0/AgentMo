# AgentMo POC Dashboard Design

Date: 2026-08-06

## Outcome

Add one bounded public command:

```text
agentmo poc dashboard <workspace> --profile <isolated-profile> --model deepseek/<model> --runtime-env-file <path> [--port <loopback-port>] [--json]
```

It prepares and starts an isolated OpenClaw Dashboard for the generated Agent. The operator must not need to set `HOME`, source `.env`, configure a provider, select the generated Agent manually, or discover the correct URL.

## Chosen approach

Use a separate `poc dashboard` action. Reusing `poc run` with a dashboard flag would combine one-shot inference with a long-running process, while installing the Agent into the user's default OpenClaw would cross the existing POC isolation boundary. The separate action keeps the default OpenClaw untouched and makes the long-running lifecycle explicit.

## Runtime flow

1. Validate the workspace, non-default profile, DeepSeek model, environment-file path, and port.
2. Load only AgentMo's existing runtime-environment allowlist. Do not print, return, or persist secret values.
3. Reuse the existing isolated profile home at `<workspace>/.agentmo-poc-home`.
4. Trust and install the pinned DeepSeek provider plugin using the existing idempotent rules.
5. Configure the DeepSeek `SecretRef`, register the requested model in the provider model catalog, and register or reuse the generated Agent with that model.
6. Start `openclaw gateway run` in the foreground on `127.0.0.1:<port>` with token authentication. Generate the token in memory and include it only in the child environment and the browser URL; JSON/text output must expose a redacted URL without the token.
7. Open the exact generated-Agent session URL when browser opening is enabled:

```text
http://127.0.0.1:<port>/chat?session=agent%3A<agent-id>%3Amain
```

8. Forward termination signals to the Gateway and exit with its status. Never use `--force`, never stop the user's default Gateway, and never mutate the default `~/.openclaw` profile.

## Port and collision behavior

The default POC port is `18889`. Before starting, AgentMo must reject an occupied port with a stable bounded diagnostic. It must not connect to an existing Gateway or choose another port silently. The operator can supply a loopback port from `1024` through `65535`.

## Output and failure behavior

Before the foreground handoff, human-readable output identifies the Agent ID, isolated profile, workspace, port, and token-free Dashboard URL. JSON mode emits the same bounded fields and never emits the token or environment values. Failures use stable `AGENTMO_POC_DASHBOARD_*` codes and redacted diagnostics.

The command does not activate schedules, deliver messages, install into the user's default OpenClaw, certify domain quality, or claim production readiness.

## Tests and acceptance

- Argument tests reject missing environment files, default/unsafe profiles, non-DeepSeek models, invalid ports, and unknown flags.
- Command-construction tests prove isolated `HOME`, explicit loopback binding, token authentication, no `--force`, exact Agent/model registration, and exact session URL.
- Secret tests prove the token and environment values do not appear in output, diagnostics, workspace artifacts, or parent environment.
- Lifecycle tests prove startup command order, idempotent plugin/Agent reuse, occupied-port rejection, signal forwarding, and bounded failure output.
- CLI help documents the command and its isolation/non-certification boundary.
- A local smoke starts the command against the accepted POC workspace and confirms the generated Agent appears with `deepseek/deepseek-v4-flash`; it does not activate the schedule.
