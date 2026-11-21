import {recoverWorkspaceArtifact} from '../../src/pi-workspace-files.js';
if(process.argv[2])process.stdout.write(JSON.stringify(await recoverWorkspaceArtifact({attemptRoot:process.argv[2]})));
