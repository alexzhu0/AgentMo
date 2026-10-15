export const MINIMAX_M3_PROFILE = "minimax-m3-cn-v1";

const deepseek = Object.freeze({
  provider: "deepseek", model: "deepseek-v4-flash", nativeModel: "deepseek/deepseek-v4-flash",
  endpoint: "https://api.deepseek.com/chat/completions", envName: "DEEPSEEK_API_KEY",
  label: "DeepSeek V4 Flash", outputLimitKey: "max_tokens",
  responseModels: Object.freeze(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4.1-flash"]),
});
const minimax = Object.freeze({
  provider: "minimax-cn", model: "MiniMax-M3", nativeModel: "minimax-cn/MiniMax-M3",
  endpoint: "https://api.minimax.cn/v1/chat/completions", envName: "MINIMAX_API_KEY",
  label: "MiniMax M3", outputLimitKey: "max_completion_tokens",
  responseModels: Object.freeze(["MiniMax-M3"]),
});

export function nativeChatModelProfile(id) {
  if (id === undefined) return deepseek;
  if (id === MINIMAX_M3_PROFILE) return minimax;
  throw Object.assign(new Error("Native model selection rejected."), { code: "AGENTMO_NATIVE_MODEL_PROFILE_REJECTED" });
}

export function validNativeModelProfileSource(value) {
  return !Object.hasOwn(value, "native_model_profile")
    || value.execution_profile === "native-chat" && value.native_model_profile === MINIMAX_M3_PROFILE;
}
