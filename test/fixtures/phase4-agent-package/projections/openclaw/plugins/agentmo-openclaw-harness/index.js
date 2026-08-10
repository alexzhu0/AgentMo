export default function register(api) {
  api.on("before_agent_run", async () => undefined);
  api.on("after_tool_call", async () => undefined);
  api.on("before_compaction", async () => undefined);
  api.on("agent_end", async () => undefined);
}
