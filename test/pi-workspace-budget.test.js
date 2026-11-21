import assert from 'node:assert/strict';import test from 'node:test';
import {piBudgetFixture} from './helpers/pi-budget-fixture.js';
import {workspacePolicy} from './helpers/pi-workspace-fixture.js';
import {workspaceWireToolSchemas} from '../src/pi-workspace-protocol.js';
import {createPiTurnController,createPiBudgetHandler} from '../src/pi-budget-proxy.js';
import {piHttpRequest,piNativeResponse} from './helpers/pi-http-fixture.js';
import {stubPiUpstream} from './helpers/pi-https-fixture.js';
async function fixture(t,baseline=false){const f=await piBudgetFixture(t,'Make report',{workspaceBaseline:baseline}),records=[];
 const binding={...f.binding,pi_workspace:workspacePolicy()};
 const workspace={binding:{taskId:f.turnId,sessionId:f.sessionId,systemPrompt:'Approved system',snapshotDigest:'snapshot'},approvedText:f.text,deadline:Date.now()+600000,records:()=>records};
 const controller=await createPiTurnController({binding,stateRoot:f.stateRoot,approvedCases:f.approvedCases,workspace});
 const handler=createPiBudgetHandler({binding,stateRoot:f.stateRoot,budgetRoot:f.budgetRoot,apiKey:'SYNTHETIC_KEY_MARKER',controller});
 const admitted=await controller.admit({...f.approvedCases[0],turnId:f.turnId});
 const request={model:'MiniMax-M3',stream:true,max_tokens:2048,thinking:{type:'disabled'},system:'Approved system',tools:workspaceWireToolSchemas(),messages:[{role:'user',content:f.text}]};
 const next=i=>{const record={toolCallId:`read-${i}`,name:'read',args:{path:'sources/1.md'},result:{text:'evidence'}};records.push(record);request.messages.push({role:'assistant',content:[{type:'tool_use',id:record.toolCallId,name:'read',input:record.args}]},{role:'user',content:[{type:'tool_result',tool_use_id:record.toolCallId,content:JSON.stringify(record.result)}]});};
 return {...f,controller,handler,token:admitted.turnToken,request,next};}
test('six native requests reserve separately and seventh closes the task',async t=>{
 let calls=0;stubPiUpstream(t,async()=>{calls++;return piNativeResponse();});const f=await fixture(t);
 for(let i=0;i<6;i++){assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,200);f.next(i);}
 assert.equal((await f.summary()).projectReservedFen,186);assert.equal(calls,6);
 assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,409);assert.equal(calls,6);
 assert.equal((await f.controller.status()).canSend,false);
});
test('workspace wire failure closes task before another reservation',async t=>{
 let calls=0;stubPiUpstream(t,async()=>{calls++;return piNativeResponse();});const f=await fixture(t);
 f.request.system='forged';assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,400);
 f.request.system='Approved system';assert.notEqual((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,200);
 assert.equal(calls,0);assert.equal((await f.summary()).projectReservedFen,0);
});

test('expired workspace task is refused at admission without spending',async t=>{
 stubPiUpstream(t,async()=>piNativeResponse());const f=await piBudgetFixture(t,'Make report');
 const binding={...f.binding,pi_workspace:workspacePolicy()};
 await assert.rejects(createPiTurnController({binding,stateRoot:f.stateRoot,approvedCases:f.approvedCases,workspace:{binding:{sessionId:f.sessionId},approvedText:f.text,deadline:Date.now()-1,records:()=>[]}}));
 assert.equal((await f.summary()).projectReservedFen,0);
});
test('an upstream failure preserves its reservation and prevents continuation',async t=>{
 let calls=0;stubPiUpstream(t,async()=>{calls++;throw Object.assign(new Error('synthetic disconnect'),{code:'ECONNRESET'});});
 const f=await fixture(t);assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,502);
 f.next(1);assert.notEqual((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,200);
 assert.equal(calls,1);assert.equal((await f.summary()).projectReservedFen,31);
 const {readdir}=await import('node:fs/promises');const path=await import('node:path');
 assert((await readdir(path.join(f.stateRoot,'attempts'))).some(n=>/^pi-request-.*\.failed\.json$/.test(n)));
});

test('synthetic 5053/35 baseline reaches 5239/41 after six independent reservations',async t=>{
 stubPiUpstream(t,async()=>piNativeResponse());const f=await fixture(t,true);
 assert.equal((await f.summary()).totalReservedFen,5053);assert.equal((await f.summary()).projectReservations,35);
 for(let i=0;i<6;i++){assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,200);f.next(i);}
 assert.equal((await f.summary()).totalReservedFen,5239);assert.equal((await f.summary()).projectReservations,41);
});

test('workspace refuses less than the complete 186-fen envelope before the first upstream attempt',async t=>{
 let calls=0;stubPiUpstream(t,async()=>{calls++;return piNativeResponse();});const f=await fixture(t);
 const {writeFile}=await import('node:fs/promises'),{default:path}=await import('node:path');
 const before=await f.summary();for(let i=1;i<=before.remainingRequests-5;i++)await writeFile(path.join(f.budgetRoot,'budget',`slot-${String(i).padStart(3,'0')}`),'reserved:31\n',{mode:0o600,flag:'wx'});
 const filled=await f.summary();assert(filled.remainingFen<186);
 assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,400);assert.equal(calls,0);assert.equal((await f.summary()).projectReservations,filled.projectReservations);
});
test('external synthetic spending between requests cannot bypass the atomic reservation check',async t=>{
 let calls=0;stubPiUpstream(t,async()=>{calls++;return piNativeResponse();});const f=await fixture(t);
 assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,200);f.next(1);
 const {writeFile}=await import('node:fs/promises'),{default:path}=await import('node:path');const before=await f.summary();
 for(let i=before.projectReservations+1;i<=before.projectReservations+before.remainingRequests;i++)await writeFile(path.join(f.budgetRoot,'budget',`slot-${String(i).padStart(3,'0')}`),'reserved:31\n',{mode:0o600,flag:'wx'});
 assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,502);assert.equal(calls,1);assert.equal((await f.controller.status()).canSend,false);
});
test('concurrent request closes the task and late upstream completion cannot finish it',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 stubPiUpstream(t,async()=>{entered();await gate;return piNativeResponse();});const f=await fixture(t);
 const first=piHttpRequest(f.handler,f.request,{'x-api-key':f.token});await started;
 assert.equal((await piHttpRequest(f.handler,f.request,{'x-api-key':f.token})).statusCode,409);release();assert.notEqual((await first).statusCode,200);
 assert.equal((await f.summary()).projectReservedFen,31);assert.notEqual((await f.controller.finish({sessionId:f.sessionId,turnId:f.turnId,status:'completed',finalEntryId:'forged'})).status,'completed');
});
