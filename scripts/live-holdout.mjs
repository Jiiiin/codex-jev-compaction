// Paid opt-in evaluation, synthetic data only. Gold labels never enter Jev state.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compact, checkpoint, askJev} from '../plugins/codex-jev-compaction/src/core.mjs';
import {apiKeyFrom} from '../plugins/codex-jev-compaction/src/config.mjs';
import {saveEvidence, readEvidence} from '../plugins/codex-jev-compaction/src/evidence.mjs';

if (process.argv[2] !== '--send-synthetic-to-typesafe') throw new Error('Explicit live synthetic evaluation flag required');
const apiKey = await apiKeyFrom(process.env);
if (!apiKey) throw new Error('Configure a private TypeSafe key file');
const scenarios = [
  {name: 'mario-en', task: 'Continue Mario from the latest observed checkpoint. Preserve its exact safe landing coordinate.', fact: 'SAFE_LANDING_X=263; CHECKPOINT=world-5-bridge'},
  {name: 'ticket-zh', task: '跟进工单，不要重复已经完成的派单；必须保留准确的回执编号。', fact: '工单=T-719；派单=已完成；回执=rcpt-6V3'},
  {name: 'hotel-zh', task: '继续跟进已确认的酒店订单。保留订单和支付回执，不能重复预订或扣款。', fact: '订单=H-85P；状态=已确认；支付=已扣款；回执=pay-4A7'},
];
const msg=text=>({type:'message',role:'user',content:[{type:'input_text',text}]});
const pair=(id,output)=>[{type:'function_call',call_id:id,name:'read_record',arguments:JSON.stringify({record:id})},{type:'function_call_output',call_id:id,output}];
const directory=await mkdtemp(join(tmpdir(),'jev-holdout-'));
const rows=[];
try {
 for (const [si,s] of scenarios.entries()) for (const [pi,position] of ['head','tail','middle'].entries()) {
  const filler=Array.from({length:90},(_,i)=>`Observation ${i}: heartbeat ok, unchanged renderer diagnostics.\n`).join('');
  const important=position==='head'?s.fact+'\n'+filler:position==='tail'?filler+s.fact:filler+s.fact+'\n'+filler;
  const ids=Array.from({length:9},(_,i)=>`r${((i*197+si*67+pi*31+53)%997).toString(16).padStart(3,'0')}`);
  // Move the gold record among old positions; pin only the recent unrelated outputs.
  const target=(si+pi)%4;
  const items=[msg(s.task),...ids.flatMap((id,i)=>pair(id,i===target?important:'Archived unrelated rendering observation. No business state change.\n'+filler.slice(0,400))),msg(s.task)];
  const usage=[];const started=performance.now();const signal=AbortSignal.timeout(18000);
  try {
   const result=await compact(items,(state,questions)=>askJev(state,questions,{apiKey,signal,onUsage:u=>usage.push(u)}));
   const excerpt=checkpoint(items,result);
   const path=await saveEvidence(directory,{session_id:'synthetic',cwd:directory},items,result);
   let recovered='';let pages=0;
   try {let offset=0;do {const page=await readEvidence(path,ids[target],{cwd:directory,offset});recovered+=page.text;pages++;offset=page.nextOffset;} while(offset!==null);} catch {}
   rows.push({case:s.name+'-'+position,goldId:ids[target],directFact:excerpt.includes(s.fact),snapshotFact:recovered.includes(s.fact),snapshotPages:pages,
    elapsedMs:Math.round(performance.now()-started),evidenceChars:excerpt.length,usage,
    decisions:result.decisions.map(({id,pinned,keepCall,keepResult,action})=>({id,pinned,keepCall,keepResult,action}))});
  } catch(error) {rows.push({case:s.name+'-'+position,failed:true,error:error.message});}
 }
 const summary={kind:'live blinded-ID synthetic holdout; not downstream task quality',cases:rows.length,
  directFacts:rows.filter(r=>r.directFact).length,snapshotFacts:rows.filter(r=>r.snapshotFact).length,
  goldSelectionRecall:rows.filter(r=>r.decisions?.some(d=>d.id===r.goldId&&d.action!=='drop')).length/rows.length,
  nonGoldOldRetention:rows.flatMap(r=>(r.decisions??[]).filter(d=>d.id!==r.goldId&&!d.pinned)).filter(d=>d.action!=='drop').length,
  nonGoldOldTotal:rows.flatMap(r=>(r.decisions??[]).filter(d=>d.id!==r.goldId&&!d.pinned)).length,rows};
 console.log(JSON.stringify(summary,null,2));
 if(rows.some(r=>r.failed))process.exitCode=1;
} finally {await rm(directory,{recursive:true,force:true});}
