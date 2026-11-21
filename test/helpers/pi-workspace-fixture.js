import { createHash } from 'node:crypto';
export function workspacePolicy(name = 'project-brief') {
  const description = name === 'project-brief' ? 'Summarize project evidence and gaps' : 'Prepare a support handoff';
  const body = `---\nname: ${name}\ndescription: ${description}\n---\nUse the approved sources. Cite evidence for conclusions, list missing information, write the report, then explain briefly.\n`;
  return { schemaVersion: 'agentmo.pi-workspace.v1',
    inputPolicy: { extensions: ['txt', 'md'], maxFiles: 2, maxFileBytes: 4096, maxTotalBytes: 8192 },
    skill: { name, description, body, digest: 'sha256:' + createHash('sha256').update(body).digest('hex') },
    outputPolicy: { fileName: 'report.md', format: 'markdown', maxBytes: 8192, overwrite: false },
    limits: { maxRequests: 6, maxTools: 8, maxWrites: 1, maxTaskCodePoints: 8000, maxWireBytes: 49152, maxMessages: 32,
      maxOutputTokens: 2048, taskMs: 600000, requestMs: 90000, cleanupMs: 300000, retries: 0, restarts: 0, reservationFen: 31, maxReservedFen: 186 } };
}

export const projectBriefScenario = Object.freeze({
 taskText:'Prepare a project brief grounded in the approved sources. Identify missing information.',
 inputs:[{name:'facts.md',text:'Project Atlas\nOwner: Ada\n'},{name:'risks.txt',text:'Launch date remains unconfirmed.\n'}],
 report:'# Project brief\nProject Atlas, owner Ada. [source-1:L1-L2]\nLaunch date is unconfirmed. [source-2:L1-L1]\n',
 citations:[{sourceId:'source-1',startLine:1,endLine:2},{sourceId:'source-2',startLine:1,endLine:1}],
});
export function projectBriefSteps(){return [
 {name:'read',args:{path:'skills/project-brief/SKILL.md'}},
 {name:'read',args:{path:'sources/1.md'}},{name:'read',args:{path:'sources/2.md'}},
 {name:'write',args:{path:'output/report.md',content:projectBriefScenario.report.replace('[source-2:L1-L1]','[source-2:L1]')}},{}
];}
