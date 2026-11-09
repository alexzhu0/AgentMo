import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { admittedArtifactProvenance } from './artifact-admission.js';
import { buildPiTargetDescriptor, PI_SDK_NAME } from './pi-target-descriptor.js';
import { piKeys, piReject, readPiPrivateFile } from './pi-install-plan.js';
import { preparePersistableProductText } from './persistability.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const failure = () => Object.assign(new Error('Pi session did not complete.'), { code: 'PI_SDK_FAILURE' });

export async function loadPiSdk({ descriptorAdmission, targetPaths }) {
  if (typeof process.send !== 'function' || !process.connected || process.env.AGENTMO_PI_CHILD !== '1') piReject();
  admittedArtifactProvenance(descriptorAdmission, { subject: 'pi-target-descriptor', value: descriptorAdmission.value });
  if (!isDeepStrictEqual(await buildPiTargetDescriptor(targetPaths), descriptorAdmission.value)) piReject();
  const sdk = await import(pathToFileURL(path.join(targetPaths.sdkRoot, 'node_modules', PI_SDK_NAME, 'dist/index.js')).href);
  if (['createAgentSession', 'createExtensionRuntime'].some(k => typeof sdk[k] !== 'function')
    || ['ModelRuntime', 'SessionManager', 'SettingsManager'].some(k => typeof sdk[k] !== 'function')
    || !Number.isInteger(sdk.CURRENT_SESSION_VERSION)) piReject();
  return sdk;
}

export function piFinalText(message) {
  const usage = message?.usage;
  if (message?.role !== 'assistant' || message.api !== 'anthropic-messages' || message.provider !== 'minimax-cn'
    || message.model !== 'MiniMax-M3' || message.responseModel !== undefined && message.responseModel !== 'MiniMax-M3'
    || message.stopReason !== 'stop' || message.rawStopReason !== 'end_turn' || message.errorMessage || message.deferred
    || typeof message.responseId !== 'string' || !message.responseId.trim()
    || !Array.isArray(message.content) || !message.content.length
    || message.content.some(p => !p || p.type !== 'text' || typeof p.text !== 'string' || !p.text.isWellFormed()
      || Object.keys(p).some(k => !['type', 'text', 'textSignature'].includes(k)))
    || !usage || !['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
    || usage.input + usage.cacheRead + usage.cacheWrite > 53248 || usage.output > 2048
    || usage.input + usage.cacheRead + usage.cacheWrite === 0 || usage.output === 0
    || usage.totalTokens !== usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    || usage.reasoning !== undefined && usage.reasoning !== 0) throw failure();
  const text = message.content.map(p => p.text).join('');
  if (!text.trim() || Buffer.byteLength(text) > 128 * 1024) throw failure();
  return text;
}

export async function createPiSession({ sdk, config, sessionFile, proxyCredential }) {
  try {
    if (!piKeys(config, ['stateRoot', 'sessionDir', 'sessionId', 'proxyPort', 'systemPrompt']) || !UUID.test(config.sessionId)
      || config.sessionDir !== path.join(config.stateRoot, 'sessions', config.sessionId)
      || !Number.isInteger(config.proxyPort) || config.proxyPort < 1024 || config.proxyPort > 65535
      || typeof config.systemPrompt !== 'string' || !config.systemPrompt.trim() || Buffer.byteLength(config.systemPrompt) > 128 * 1024
      || (process.umask() & 0o077) !== 0o077 || !/^[a-f0-9]{64}$/u.test(proxyCredential)) piReject();
    preparePersistableProductText(config.systemPrompt);
    for (const dir of [config.stateRoot, path.join(config.stateRoot, 'sessions'), config.sessionDir]) {
      const stat = await lstat(dir);
      if (await realpath(dir) !== dir || !stat.isDirectory() || stat.isSymbolicLink()
        || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) piReject();
    }
    if (sessionFile !== null) {
      if (path.dirname(sessionFile) !== config.sessionDir || !path.basename(sessionFile).endsWith(`_${config.sessionId}.jsonl`)) piReject();
      const bytes = (await readPiPrivateFile(sessionFile)).bytes;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.endsWith('\n')) piReject();
      // Admit history before SessionManager.open can migrate or repair it.
      const entries = text.trimEnd().split('\n').map(line => JSON.parse(line));
      if (entries[0]?.type !== 'session' || entries[0]?.id !== config.sessionId || entries[0]?.cwd !== config.stateRoot
        || entries[0]?.version !== sdk.CURRENT_SESSION_VERSION
        || entries.slice(1).some(e => !['message', 'model_change', 'thinking_level_change'].includes(e.type)
          || e.type === 'model_change' && (e.provider !== 'minimax-cn' || e.modelId !== 'MiniMax-M3')
          || e.type === 'thinking_level_change' && e.thinkingLevel !== 'off')) piReject();
    }
    for (const name of ['auth.json', 'models.json', 'models-store.json']) {
      try { await lstat(path.join(config.sessionDir, name)); piReject(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const settings = sdk.SettingsManager.inMemory({ cacheWarming: 'off', retry: { enabled: false, maxRetries: 0,
      provider: { maxRetries: 0, timeoutMs: 90000, maxRetryDelayMs: 0 } }, compaction: { enabled: false },
      enableSkillCommands: false, blockImages: true, transport: 'sse', extensions: [], skills: [], prompts: [] });
    const checkSettings = () => {
      if (settings.getCacheWarmingMode() !== 'off' || settings.getRetrySettings().enabled !== false || settings.getRetrySettings().maxRetries !== 0
        || settings.getProviderRetrySettings().maxRetries !== 0 || settings.getCompactionEnabled() !== false
        || settings.getEnableSkillCommands() !== false) piReject();
    };
    checkSettings();
    // RuntimeCredentials owns per-turn keys; the base store must never touch disk.
    const modelRuntime = await sdk.ModelRuntime.create({ credentials: {
      async read(_providerId, options) { options?.signal?.throwIfAborted(); },
      async list(options) { options?.signal?.throwIfAborted(); return []; },
      async modify() { throw failure(); },
      async delete() { throw failure(); },
    }, modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false });
    const nativeModel = modelRuntime.getModel('minimax-cn', 'MiniMax-M3');
    if (nativeModel?.provider !== 'minimax-cn' || nativeModel.id !== 'MiniMax-M3' || nativeModel.api !== 'anthropic-messages'
      || nativeModel.baseUrl !== 'https://api.minimaxi.com/anthropic' || nativeModel.thinkingLevelMap?.off === null) piReject();
    const stream = modelRuntime.streamSimple.bind(modelRuntime);
    // The fixed SDK appends cwd even with a custom prompt; only the Package prompt crosses the proxy.
    modelRuntime.streamSimple = (model, context, options) => {
      if (model.provider !== 'minimax-cn' || model.id !== 'MiniMax-M3' || model.api !== 'anthropic-messages' || !piKeys(context, ['messages'])
        || !Array.isArray(context.messages) || context.messages.some(m => !['system', 'user', 'assistant'].includes(m.role)
          || m.role === 'system' && ((m.toolsAdded?.length ?? 0) || (m.toolsRemoved?.length ?? 0))
          || m.role !== 'system' && (typeof m.content !== 'string' && (!Array.isArray(m.content)
            || m.content.some(p => p.type !== 'text' || typeof p.text !== 'string'))))) throw failure();
      // Pi owns the native protocol; only route its request through the one-use budget/key boundary.
      return stream({ ...model, baseUrl: `http://127.0.0.1:${config.proxyPort}` }, { messages: [{ role: 'system', content: config.systemPrompt, timestamp: 0 },
        ...context.messages.filter(m => m.role !== 'system')] },
      { ...options, reasoning: undefined, maxTokens: 2048, maxRetries: 0, transport: 'sse', cacheRetention: 'none', sessionId: undefined,
        onProviderStreamEvent: (event, native) => {
          if (!current) throw failure();
          if (event.type === 'message_start') {
            current.starts++;
            if (current.starts !== 1 || current.stops || event.message?.model !== 'MiniMax-M3'
              || typeof event.message.id !== 'string' || !event.message.id.trim()
              || !Number.isSafeInteger(event.message.usage?.input_tokens) || event.message.usage.input_tokens < 0
              || !Number.isSafeInteger(event.message.usage.output_tokens) || event.message.usage.output_tokens < 0) throw failure();
          }
          if (event.type === 'message_delta' && event.delta?.stop_reason != null) {
            current.ends++;
            if (current.starts !== 1 || current.stops || current.ends !== 1 || event.delta.stop_reason !== 'end_turn'
              || !Number.isSafeInteger(event.usage?.output_tokens) || event.usage.output_tokens <= 0 || event.usage.output_tokens > 2048) throw failure();
          }
          if (event.type === 'message_stop' && (current.starts !== 1 || ++current.stops !== 1)) throw failure();
          return options?.onProviderStreamEvent?.(event, native);
        } });
    };
    const extensions = { extensions: [], errors: [], runtime: sdk.createExtensionRuntime() };
    const resourceLoader = { getExtensions: () => extensions, getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => config.systemPrompt, getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
      extendResources: () => { throw failure(); }, reload: async () => {} };
    const manager = sessionFile === null ? sdk.SessionManager.create(config.stateRoot, config.sessionDir, { id: config.sessionId })
      : sdk.SessionManager.open(sessionFile, config.sessionDir, config.stateRoot);
    const header = manager.getHeader();
    if (header?.type !== 'session' || header.id !== config.sessionId || header.cwd !== config.stateRoot
      || header.version !== sdk.CURRENT_SESSION_VERSION
      || manager.getBranch().some(e => !['message', 'model_change', 'thinking_level_change'].includes(e.type)
        || e.type === 'model_change' && (e.provider !== 'minimax-cn' || e.modelId !== 'MiniMax-M3')
        || e.type === 'thinking_level_change' && e.thinkingLevel !== 'off')) piReject();
    if (manager.getSessionId() !== config.sessionId || path.dirname(manager.getSessionFile()) !== config.sessionDir
      || !path.basename(manager.getSessionFile()).endsWith(`_${config.sessionId}.jsonl`)) piReject();
    const result = await sdk.createAgentSession({ cwd: config.stateRoot, agentDir: config.sessionDir, modelRuntime,
      model: nativeModel, thinkingLevel: 'off', scopedModels: [], noTools: 'all',
      tools: [], customTools: [], resourceLoader, settingsManager: settings, sessionManager: manager });
    const { session } = result;
    checkSettings();
    if (result.modelFallbackMessage || result.extensionsResult.extensions.length || result.extensionsResult.errors.length
      || session.getActiveToolNames().length || session.pendingMessageCount || session.model?.provider !== 'minimax-cn'
      || session.model?.id !== 'MiniMax-M3' || session.thinkingLevel !== 'off') piReject();
    const subscribers = new Set(); let current = null, disposed = false;
    const unsubscribe = session.subscribe(event => {
      if (!current) return;
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        current.finals++; current.message = structuredClone(event.message);
      }
      if (event.type === 'agent_settled') { current.settled = true; current.aborted ||= event.aborted !== false; }
      if (event.type === 'agent_end' && event.willRetry !== false || ['auto_retry_start', 'compaction_start', 'tool_execution_start'].includes(event.type)) current.invalid = true;
      for (const listener of subscribers) listener({ type: 'progress' });
    });
    const setProxyCredential = async value => {
      if (disposed || current || !/^[a-f0-9]{64}$/u.test(value)) throw failure();
      await modelRuntime.setRuntimeApiKey('minimax-cn', value);
    };
    await setProxyCredential(proxyCredential);
    return {
      getSessionFile: () => manager.getSessionFile(), readEntries: () => structuredClone(manager.getBranch()),
      subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); },
      setProxyCredential,
      prompt: async text => {
        if (disposed || current || typeof text !== 'string' || !text.trim() || !text.isWellFormed() || [...text].length > 8000) throw failure();
        current = { finals: 0, starts: 0, ends: 0, stops: 0, settled: false, aborted: false, invalid: false }; const turn = current;
        try {
          checkSettings();
          await session.prompt(text, { expandPromptTemplates: false });
          if (turn.finals !== 1 || turn.starts !== 1 || turn.ends !== 1 || turn.stops !== 1 || !turn.settled || turn.aborted || turn.invalid) throw failure();
          const finalText = piFinalText(turn.message);
          const entry = manager.getBranch().findLast(e => e.type === 'message' && e.message?.role === 'assistant');
          if (!entry || !isDeepStrictEqual(entry.message, turn.message) || !/^[A-Za-z0-9_-]{1,128}$/u.test(entry.id)) throw failure();
          const filePath = manager.getSessionFile(); await readPiPrivateFile(filePath);
          const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { await file.sync(); } finally { await file.close(); }
          const dir = await open(config.sessionDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { await dir.sync(); } finally { await dir.close(); }
          return { text: finalText, finalEntryId: entry.id };
        } catch { throw failure(); }
        finally { current = null; await modelRuntime.removeRuntimeApiKey('minimax-cn').catch(() => {}); }
      },
      abort: async () => { if (current) current.aborted = true; await session.abort(); },
      dispose: async () => { if (disposed) return; disposed = true; if (current) current.aborted = true;
        await session.abort(); unsubscribe(); subscribers.clear(); await session.dispose(); await modelRuntime.removeRuntimeApiKey('minimax-cn').catch(() => {}); },
    };
  } catch { throw failure(); }
}
