import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validateBlueprint } from '../blueprint.js';
import { validateBuildContract } from '../build-contract.js';
import { selectPackageCarriers } from '../package-carriers.js';
import { validatePiTargetCarrierAdmission } from '../pi-target-admission.js';
import { serializePersistableJson } from '../persistability.js';

export { buildPiSystemPrompt } from '../scaffold-files.js';
import { buildPiSystemPrompt } from '../scaffold-files.js';

export function buildPiPackageProjection({ blueprint, buildContract, carrierSelection, targetAdmission }) {
  if (!validateBlueprint(blueprint).ok || blueprint.native_runtime !== 'pi' || blueprint.native_model_profile !== 'minimax-m3-cn-v1'
    || !validateBuildContract(buildContract).ok || buildContract.native_runtime !== 'pi'
    || blueprint.agent_id !== buildContract.agentId || !validatePiTargetCarrierAdmission(targetAdmission).ok
    || targetAdmission.target.descriptorDigest !== buildContract.targetRuntime.descriptorDigest
    || !isDeepStrictEqual(carrierSelection, selectPackageCarriers(buildContract))) {
    throw Object.assign(new Error('Pi package authority rejected.'), { code: 'AGENTMO_PI_PACKAGE_REJECTED' });
  }
  const json = (name, value) => ({ relativePath: `projections/pi/${name}`, mode: 0o644,
    bytes: Buffer.from(serializePersistableJson(value, { subject: 'pi-package-projection' })) });
  return [
    json('agent.json', { schemaVersion: 'agentmo.pi-agent-intent.v1', agentId: blueprint.agent_id,
      execution_profile: 'native-chat', native_runtime: 'pi', modelProfile: 'minimax-m3-cn-v1',
      model: 'agentmo-budget/MiniMax-M3', tools: [], extensions: [], mcp: false,
      retry: { enabled: false, maxRetries: 0 }, providerRetry: 0, cacheWarming: false,
      compaction: false, promptTemplates: false, fallback: [], proposalOnly: true }),
    { relativePath: 'projections/pi/system.md', mode: 0o644, bytes: Buffer.from(buildPiSystemPrompt(blueprint)) },
    json('runtime-binding.json', { schemaVersion: 'agentmo.pi-runtime-binding.v1', target: targetAdmission.target,
      modelProfile: 'minimax-m3-cn-v1', executionAuthorized: false, installed: false, runtimeVerified: false }),
    ...[['index.html', 'pi-chat.html'], ['client.js', 'pi-chat-client.js'], ['style.css', 'pi-chat.css']].map(([name, source]) => ({
      relativePath: `projections/pi/browser/${name}`, mode: 0o644,
      bytes: readFileSync(new URL(`../${source}`, import.meta.url)),
    })),
  ].sort((a, b) => Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath)));
}
