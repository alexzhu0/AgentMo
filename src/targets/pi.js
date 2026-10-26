import { buildTargetFiles } from '../scaffold-files.js';
import { fileMapToWriteOperations } from './operations.js';
export const piTarget = {
  id: 'pi', label: 'Pi SDK browser agent', runtimeId: 'pi',
  verificationHints: ['Pi installation, activation and model acceptance each require an exact approved preview.'],
  unsupportedSurfaces: ['Scaffold presence does not certify SDK execution or domain quality.'],
  supports: blueprint => blueprint.execution_profile === 'native-chat' && blueprint.native_runtime === 'pi'
    && blueprint.native_model_profile === 'minimax-m3-cn-v1' && blueprint.runtime === 'pi',
  planOperations(blueprint, context) {
    if (!this.supports(blueprint)) throw new Error('AGENTMO_PI_TARGET_REJECTED');
    return fileMapToWriteOperations(buildTargetFiles(blueprint, 'pi'), context, 'generated:pi-scaffold');
  },
};
