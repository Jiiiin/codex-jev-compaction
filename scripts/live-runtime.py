"""Opt-in paid synthetic A/B test: actual Codex model, native compaction and Jev.
Uses the configured Codex model/account. No production actions: dynamic tools are
fixtures. Requires installed/trusted hooks and TYPESAFE_API_KEY_FILE in the caller.
Run: python3 scripts/live-runtime.py [native|jev] [mario|ticket|hotel]
"""
import json, os, queue, subprocess, sys, tempfile, threading, time
from pathlib import Path

mode, scenario = sys.argv[1:]
assert mode in ('native', 'jev') and scenario in ('mario', 'ticket', 'hotel')
root = Path(__file__).resolve().parent.parent
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
workspace = Path(tempfile.mkdtemp(prefix='live-fixture-',dir=artifacts))
probe = artifacts / f'live-probe-{mode}-{scenario}.ndjson'
probe.write_text('')
observer = artifacts / 'live-observer.mjs'
observer.write_text('''import {appendFileSync} from 'node:fs';
const record=x=>appendFileSync(process.env.JEV_LIVE_PROBE,JSON.stringify(x)+'\\n');
if(process.argv[1]?.endsWith('/scripts/hook.mjs')) {
 const write=process.stdout.write.bind(process.stdout);
 process.stdout.write=(chunk,...rest)=>{
  try {const context=JSON.parse(String(chunk)).hookSpecificOutput?.additionalContext;
   if(context) record({kind:'restore',evidenceChars:context.length});} catch {}
  return write(chunk,...rest);
 };
 const original=globalThis.fetch;
 globalThis.fetch=async(...args)=>{
  const start=performance.now();const response=await original(...args);
  const data=await response.clone().json().catch(()=>({}));
  record({kind:'jev',status:response.status,elapsedMs:Math.round(performance.now()-start),model:data.model??null,usage:data.usage??null});
  return response;
 };
}
if(process.argv[1]?.endsWith('/scripts/cli.mjs') && process.argv[2]==='evidence') record({kind:'snapshotRead'});
''')
cases = {
 'mario': {'task':'准备继续马里奥游戏；之后需要准确的安全落点、存档位置和最后一次临时错误。',
   'fact':'SAFE_LANDING_X=173; CHECKPOINT=world-4-tower; LAST_ERROR=E_PLATFORM_61',
   'query':'现在只回答安全落点、存档位置、最后一次错误码、模式。纠正之前的计划：模式改为 WALK，不要 RUN。不要执行游戏操作。',
   'expected':['173','world-4-tower','E_PLATFORM_61','WALK']},
 'ticket': {'task':'准备跟进工单；保留已完成派单的回执，避免重复派单。',
   'fact':'TICKET=T-835; DISPATCH=completed; RECEIPT=rcpt-9M4',
   'query':'现在只回答工单号、派单状态、回执和负责人。纠正之前的计划：负责人改为林夏，不是王冬。不要再次派单。',
   'expected':['T-835','rcpt-9M4','林夏']},
 'hotel': {'task':'准备跟进已有酒店订单；保留确认回执，避免重复预订或扣款。',
   'fact':'BOOKING=H-63V; STATUS=confirmed; PAYMENT=captured; RECEIPT=pay-2N8',
   'query':'现在只回答订单号、支付回执、付款状态和早餐人数。纠正之前的计划：早餐人数改为 1，不是 2。不要再次预订或付款。',
   'expected':['H-63V','pay-2N8','1']},
}
case = cases[scenario]
filler = ''.join(f'Observation {i:03d}: heartbeat ok, no transaction state change.\n' for i in range(75))
records = {i: f'Observation {i}: unrelated rendering diagnostics. No transaction.\n' + filler[:1000] for i in range(1,9)}
records[2] = filler + case['fact'] + '\n' + filler
reads=[]; side_effects=[]; events=[]; errors=[]; messages=queue.Queue()
env = {**os.environ, 'JEV_ENABLE':'1' if mode=='jev' else '0',
       'NODE_OPTIONS':'--import '+str(observer), 'JEV_LIVE_PROBE':str(probe)}
p=subprocess.Popen(['codex','app-server','--stdio','-c','shell_environment_policy.set='+
 '{'+','.join(k+'='+json.dumps(env[k]) for k in ('JEV_ENABLE','TYPESAFE_API_KEY_FILE','NODE_OPTIONS','JEV_LIVE_PROBE') if k in env)+'}'],
 stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
def stdout_reader():
 for line in p.stdout:
  try:messages.put(json.loads(line))
  except json.JSONDecodeError:pass
def stderr_reader():
 for line in p.stderr:errors.append(line)
threading.Thread(target=stdout_reader,daemon=True).start()
threading.Thread(target=stderr_reader,daemon=True).start()
counter=0
def send(d):p.stdin.write(json.dumps(d)+'\n');p.stdin.flush()
def receive(timeout=50):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  d=messages.get(timeout=max(.1,deadline-time.monotonic()))
  if d.get('method')=='item/tool/call':
   params=d['params']; args=params.get('arguments',{})
   if params.get('tool')=='synthetic_record' or params.get('name')=='synthetic_record':
    index=args.get('index');reads.append(index)
    output=records.get(index,'Unknown record') if reads.count(index)==1 else 'Transient observation unavailable: record cannot be fetched again.'
   else:
    side_effects.append(params.get('tool') or params.get('name'));output='Synthetic action detected; no actual external action was performed.'
   send({'id':d['id'],'result':{'contentItems':[{'type':'inputText','text':output}],'success':True}})
  elif 'id' in d and 'method' in d:
   send({'id':d['id'],'error':{'code':-32601,'message':'Unsupported request in synthetic fixture'}})
  else:return d
 raise TimeoutError('No app-server event within deadline')
def rpc(method,params):
 global counter
 counter+=1; request_id=counter;send({'id':request_id,'method':method,'params':params})
 while True:
  d=receive()
  if d.get('id')==request_id:
   if 'error' in d:raise RuntimeError('RPC failed: '+method)
   return d['result']
  events.append(d)
def complete(timeout=240):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  d=receive(min(50,deadline-time.monotonic()));events.append(d)
  if d.get('method')=='turn/completed':
   if d['params']['turn']['status']!='completed':raise RuntimeError('Model turn did not complete')
   return
 raise TimeoutError('Turn exceeded deadline')
thread_id=None; succeeded=False
try:
 rpc('initialize',{'clientInfo':{'name':'jev-live-evaluation','version':'1'},'capabilities':{'experimentalApi':True}})
 send({'method':'initialized'})
 if mode=='jev':
  hooks=rpc('hooks/list',{'cwds':[str(workspace)]})
  ours=[h for d in hooks['data'] for h in d['hooks'] if h.get('pluginId')=='codex-jev-compaction@jev-compaction']
  if len(ours)!=2 or any(h['trustStatus']!='trusted' for h in ours):raise RuntimeError('Installed hooks require normal /hooks review')
 tool=lambda name,description,properties,required:{'type':'function','name':name,'description':description,'inputSchema':{'type':'object','properties':properties,'required':required}}
 result=rpc('thread/start',{'cwd':str(workspace),'approvalPolicy':'never','sandbox':'read-only',
  'config':{'model_auto_compact_token_limit':1000000,
    'shell_environment_policy.set':{key:env[key] for key in ('JEV_ENABLE','TYPESAFE_API_KEY_FILE','NODE_OPTIONS','JEV_LIVE_PROBE') if key in env}},
  'baseInstructions':'You are executing a bounded synthetic integration test. Follow the user task. Only use synthetic_record to gather fixture observations. After compaction you may use the installed local evidence reader if needed to recover omitted historical facts. Do not inspect any other files, sessions, credentials, network or applications. Never delegate. Do not repeat side effects. No repository exploration is needed.',
  'dynamicTools':[tool('synthetic_record','Read one transient synthetic observation, once only.',{'index':{'type':'integer'}},['index']),tool('synthetic_action','Simulates a game move, ticket dispatch or hotel booking. No actual external action.',{'action':{'type':'string'}},['action'])]})
 thread_id=result['thread']['id']; model=result.get('model');print(f'{mode}/{scenario}: started ({model})',flush=True)
 rpc('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':case['task']+' 请按顺序调用 synthetic_record 读取 1 到 8，每次一条。记录只可读取一次。现在不执行任何业务操作，读完仅回答 READY，稍后再回答业务问题。'}]})
 complete();print(f'{mode}/{scenario}: gathered {len(reads)} records',flush=True)
 if sorted(reads)!=list(range(1,9)):raise RuntimeError('Gathering did not match fixture protocol')
 compact_start=time.monotonic()
 rpc('thread/compact/start',{'threadId':thread_id});complete()
 compact_ms=round((time.monotonic()-compact_start)*1000)
 print(f'{mode}/{scenario}: native compaction completed',flush=True)
 before=len(events)
 rpc('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':case['query']}]});complete()
 finals=[e['params']['item'].get('text','') for e in events[before:] if e.get('method')=='item/completed' and e.get('params',{}).get('item',{}).get('type')=='agentMessage']
 answer='\n'.join(finals)
 hooks=[d['params']['run'] for d in events if d.get('method')=='hook/completed' and 'codex-jev-compaction' in d.get('params',{}).get('run',{}).get('sourcePath','')]
 report={'mode':mode,'case':scenario,'model':model,'realCodexModel':True,'nativeCompaction':True,'realJev':any(json.loads(x).get('kind')=='jev' and json.loads(x).get('status')==200 for x in probe.read_text().splitlines()),
  'compactionMs':compact_ms,'expectedMatches':[x in answer for x in case['expected']],'allExactFacts':all(x in answer for x in case['expected']),
  'answer':answer,'recordReads':reads,'sideEffects':side_effects,'probe':[json.loads(x) for x in probe.read_text().splitlines()],
  'pluginHooks':[{'event':h['eventName'],'status':h['status'],'durationMs':h['durationMs']} for h in hooks]}
 (artifacts/f'live-runtime-{mode}-{scenario}.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
 print(json.dumps(report,indent=2,ensure_ascii=False),flush=True)
 if mode=='jev' and not any(x.get('kind')=='jev' and x.get('status')==200 for x in report['probe']):
  raise RuntimeError('No successful real Jev call observed; runtime result is not a live Jev pass')
 if mode=='jev' and not any(x.get('kind')=='restore' for x in report['probe']):
  raise RuntimeError('No evidence restoration observed')
 succeeded=True
except Exception as e:
 print('Test failed:',type(e).__name__,str(e),flush=True)
 (artifacts/f'live-runtime-error-{mode}-{scenario}.json').write_text(json.dumps(events,indent=2,ensure_ascii=False))
finally:
 if thread_id:
  try:rpc('thread/archive',{'threadId':thread_id})
  except Exception:pass
 p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill()
raise SystemExit(0 if succeeded else 1)
