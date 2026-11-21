import {readFile} from 'node:fs/promises';
import {createPiSession} from '../../src/pi-sdk.js';
import {fakePiSdk} from './pi-sdk-fixture.js';
if(process.argv[2]){
 process.umask(0o077);
 const {config,sessionFile}=JSON.parse(await readFile(process.argv[2],'utf8')),fake=fakePiSdk();
 config.workspace.execute=async()=>{throw new Error('Recovery cannot execute tools');};
 const session=await createPiSession({sdk:fake.sdk,config,sessionFile,proxyCredential:'0'.repeat(64)});
 const count=session.readEntries().filter(e=>e.message?.role==='toolResult').length;await session.dispose();
 process.stdout.write(JSON.stringify({toolResults:count,prompts:fake.calls.prompt.length,opens:fake.calls.open.length}));
}
