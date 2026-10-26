import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const finalMessage = () => ({ role: 'assistant', content: [{ type: 'text', text: '合成最终回复' }],
  api: 'openai-completions', provider: 'agentmo-budget', model: 'MiniMax-M3', stopReason: 'stop', timestamp: 1,
  usage: { input: 20, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 23,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
export function fakePiSdk() {
  const calls = { create: [], runtime: [], credential: [], prompt: [], stream: [], abort: 0, dispose: 0 };
  let sequence = () => [{ type: 'message_end', message: finalMessage() }, { type: 'agent_end', willRetry: false }, { type: 'agent_settled', aborted: false }];
  class Manager {
    constructor(cwd, dir, id, file) { this.cwd = cwd; this.id = id; this.file = file ?? path.join(dir, `synthetic_${id}.jsonl`); this.entries = [];
      if (existsSync(this.file)) this.entries = readFileSync(this.file, 'utf8').trim().split('\n').map(JSON.parse).slice(1); }
    getSessionFile() { return this.file; }
    getSessionId() { return this.id; }
    getBranch() { return this.entries; }
    getHeader() { return { type: 'session', version: 3, id: this.id, timestamp: '2026-10-16T00:00:00.000Z', cwd: this.cwd }; }
    getEntry(id) { return this.entries.find(e => e.id === id); }
    appendMessage(message) { const row = { type: 'message', id: randomUUID(), message };
      this.entries.push(row); writeFileSync(this.file, [this.getHeader(), ...this.entries].map(JSON.stringify).join('\n') + '\n', { mode: 0o600 }); return row.id; }
    buildSessionContext() { return { messages: this.entries.map(e => e.message), model: null, thinkingLevel: 'off' }; }
  }
  const sdk = { CURRENT_SESSION_VERSION: 3, createExtensionRuntime: () => ({ synthetic: true }),
    SettingsManager: { inMemory(value) { calls.settings = structuredClone(value); return {
      getCacheWarmingMode: () => value.cacheWarming, getRetrySettings: () => value.retry,
      getProviderRetrySettings: () => value.retry.provider, getCompactionEnabled: () => value.compaction.enabled,
      getEnableSkillCommands: () => value.enableSkillCommands,
    }; } },
    SessionManager: { create: (cwd, dir, options) => new Manager(cwd, dir, options.id),
      open: (file, dir, cwd) => new Manager(cwd, dir, JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).id, file) },
    ModelRuntime: { async create(options) { calls.runtime.push(options); let model;
      // The fixed SDK creates its default auth file even before the first prompt.
      if (!options.credentials) {
        if (typeof options.authPath !== 'string') throw new Error('Synthetic default auth path missing');
        if (!existsSync(options.authPath)) writeFileSync(options.authPath, '{}', { mode: 0o600 });
      }
      return { registerProvider(id, config) { calls.provider = { id, config }; model = { ...config.models[0], provider: id, api: config.api }; },
        getModel: () => model, setRuntimeApiKey: async (provider, credential) => { calls.credential.push({ provider, credential }); },
        removeRuntimeApiKey: async () => {},
        streamSimple(model, context, options) { calls.stream.push({ model, context, options }); return {}; },
      }; } },
    async createAgentSession(options) {
      calls.create.push(options); const listeners = new Set(), manager = options.sessionManager;
      return { extensionsResult: { extensions: [], errors: [] }, session: {
        model: options.model, thinkingLevel: 'off', pendingMessageCount: 0,
        getActiveToolNames: () => [], subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async prompt(text, promptOptions) {
          calls.prompt.push({ text, options: promptOptions });
          options.modelRuntime.streamSimple(options.model, { messages: [{ role: 'system', content: 'Default cwd /SYNTHETIC/HOST', timestamp: 0 },
            ...manager.buildSessionContext().messages, { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }] }, { maxRetries: 2, maxTokens: 4096 });
          manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 });
          for await (const event of await sequence()) {
            if (event.type === 'message_end' && event.message?.role === 'assistant') manager.appendMessage(event.message);
            for (const listener of listeners) listener(event);
          }
        }, abort: async () => { calls.abort++; }, dispose: () => { calls.dispose++; },
      } };
    },
  };
  return { sdk, calls, sequence: value => { sequence = typeof value === 'function' ? value : () => value; } };
}
