"""Opt-in real Codex runtime test with a loopback model and synthetic Jev responses.
Requires a locally installed, reviewed/trusted codex-jev-compaction plugin.
Never sends a prompt to a real model or TypeSafe. Does not edit persisted trust.
Creates and archives only its own synthetic test task. Existing user hooks still run.
Run from this repository root: python3 scripts/runtime-smoke.py [manual|auto|paginated|failure|repeat]
"""
import json, subprocess, threading, queue, time, os, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

mode=sys.argv[1] if len(sys.argv)>1 else 'manual'
if mode not in {'manual','auto','paginated','failure','repeat'}: raise SystemExit('Mode must be manual, auto, paginated, failure or repeat')
history_mode='paginated' if mode=='paginated' else 'legacy'
root=Path.cwd(); artifact=root/'artifacts'; artifact.mkdir(exist_ok=True)
log=artifact/'runtime-hooks.ndjson'; log.write_text('')
preload=artifact/'runtime-fetch-stub.mjs'
preload.write_text('''import {appendFileSync} from 'node:fs';
if (process.argv[1]?.endsWith('/scripts/hook.mjs')) {
 appendFileSync(process.env.JEV_TEST_LOG, JSON.stringify({hookStarted:true, enabled:process.env.JEV_ENABLE, keyPresent:Boolean(process.env.TYPESAFE_API_KEY), pluginData:process.env.PLUGIN_DATA})+'\\n');
 const original=process.stdin[Symbol.asyncIterator].bind(process.stdin);
 process.stdin[Symbol.asyncIterator]=async function*(){let text='';for await(const chunk of original()){text+=chunk;yield chunk;} const e=JSON.parse(text);appendFileSync(process.env.JEV_TEST_LOG,JSON.stringify({event:e.hook_event_name,source:e.source,trigger:e.trigger,transcriptAvailable:Boolean(e.transcript_path)})+'\\n');};
 globalThis.fetch=async (url, options)=>{
  if(url!=='https://api.typesafe.ai/v1/systemone') throw new Error('Unexpected endpoint in fixture');
  if(process.env.JEV_TEST_MODE==='failure') return new Response('{}',{status:429});
  const body=JSON.parse(options.body);
  appendFileSync(process.env.JEV_TEST_LOG,JSON.stringify({scoring:true,questions:Object.keys(body.questions).length})+'\\n');
  return new Response(JSON.stringify({model:'mock-only',answers:Object.fromEntries(Object.keys(body.questions).map(k=>[k,{type:'noul',noul:0.9}])),usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
 };
}
''')
requests=[]; count=0
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  global count
  raw=self.rfile.read(int(self.headers.get('content-length',0))); body=json.loads(raw)
  count+=1
  requests.append({'path':self.path,'hasEvidence':'Historical evidence selected before compaction' in raw.decode(),'toolCount':len(body.get('tools',[]))})
  if '/compact' in self.path:
   data={'id':'cmp_test','object':'response.compaction','created_at':int(time.time()),'output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'Synthetic compaction summary; original tool facts omitted.'}]}],'usage':{'input_tokens':100,'output_tokens':10,'total_tokens':110}}
   self.send_response(200);self.send_header('content-type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode());return
  tools=body.get('tools',[])
  synthetic=next((x.get('name') for x in tools if x.get('name')=='synthetic_record'),None)
  if count <= 8 and synthetic:
   item={'id':f'fc_{count}','type':'function_call','call_id':f'call_{count}','name':'synthetic_record','arguments':json.dumps({'index':count})}
  else:
   item={'id':f'msg_{count}','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'Synthetic fixture turn complete.','annotations':[]}]}
  response={'id':f'resp_{count}','object':'response','status':'completed','model':'codex-jev-runtime-test','output':[item],'usage':{'input_tokens':200 if mode=='auto' and count==8 else 10,'output_tokens':10,'total_tokens':210 if mode=='auto' and count==8 else 20}}
  events=[{'type':'response.created','response':{'id':response['id'],'status':'in_progress','output':[]}}, {'type':'response.output_item.added','output_index':0,'item':item}, {'type':'response.output_item.done','output_index':0,'item':item}, {'type':'response.completed','response':response}]
  self.send_response(200);self.send_header('content-type','text/event-stream');self.end_headers()
  for e in events: self.wfile.write(('data: '+json.dumps(e)+'\n\n').encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler); threading.Thread(target=server.serve_forever,daemon=True).start()
provider={'name':'Synthetic test only','base_url':f'http://127.0.0.1:{server.server_port}/v1','wire_api':'responses','requires_openai_auth':False,'supports_websockets':False}
def toml_obj(d):return '{'+','.join(k+'='+('true' if v is True else 'false' if v is False else json.dumps(v)) for k,v in d.items())+'}'
args=['codex','app-server','--stdio','-c','model_provider="jev-runtime-test"','-c','model="codex-jev-runtime-test"','-c','model_providers.jev-runtime-test='+toml_obj(provider)]
env={**os.environ,'JEV_ENABLE':'1','TYPESAFE_API_KEY':'fake-for-runtime-stub-only','NODE_OPTIONS':'--import '+str(preload),'JEV_TEST_LOG':str(log),'JEV_TEST_MODE':mode}
p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
messages=queue.Queue(); errors=[]
def reader():
 for line in p.stdout:
  try:messages.put(json.loads(line))
  except:pass
def stderr():
 for line in p.stderr:errors.append(line)
threading.Thread(target=reader,daemon=True).start();threading.Thread(target=stderr,daemon=True).start()
id_counter=0;events=[]
def send(data):p.stdin.write(json.dumps(data)+'\n');p.stdin.flush()
def receive(timeout=30):
 end=time.time()+timeout
 while time.time()<end:
  d=messages.get(timeout=max(.1,end-time.time()))
  if d.get('method')=='item/tool/call':
   index=d['params']['arguments'].get('index',0)
   send({'id':d['id'],'result':{'contentItems':[{'type':'inputText','text':f'SYNTHETIC_ORIGINAL_FACT_{index}=preserve-me'}],'success':True}})
  else:return d
 raise TimeoutError('receive timeout')
def rpc(method,params):
 global id_counter
 id_counter+=1;i=id_counter;send({'id':i,'method':method,'params':params})
 while True:
  d=receive()
  if d.get('id')==i:
   if 'error' in d:raise RuntimeError(str(d['error']))
   return d['result']
  events.append(d)
def wait_for(method,timeout=45):
 end=time.time()+timeout
 while time.time()<end:
  d=receive(end-time.time());events.append(d)
  if d.get('method')==method:return d
 raise TimeoutError(method)
thread_id=None
succeeded=False
try:
 rpc('initialize',{'clientInfo':{'name':'jev-runtime-smoke','version':'1'},'capabilities':{'experimentalApi':True}});send({'method':'initialized'})
 hooks=rpc('hooks/list',{'cwds':[str(root)]})
 ours=[h for d in hooks['data'] for h in d['hooks'] if h.get('pluginId')=='codex-jev-compaction@jev-compaction']
 print('Hook trust:',[(x['eventName'],x['trustStatus']) for x in ours],flush=True)
 if len(ours)!=2 or any(h['trustStatus']!='trusted' for h in ours): raise RuntimeError('Install the plugin and review its two hooks in /hooks before this test. The harness does not change trust.')
 result=rpc('thread/start',{'cwd':str(root),'modelProvider':'jev-runtime-test','model':'codex-jev-runtime-test','approvalPolicy':'never','sandbox':'read-only','historyMode':history_mode,'config':{'model_auto_compact_token_limit':150 if mode=='auto' else 1000000},'baseInstructions':'This is a deterministic local protocol fixture.','dynamicTools':[{'type':'function','name':'synthetic_record','description':'Returns synthetic test evidence only.','inputSchema':{'type':'object','properties':{'index':{'type':'integer'}},'required':['index']}}]})
 thread_id=result['thread']['id'];print('Synthetic thread started',thread_id,flush=True)
 rpc('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':'Synthetic runtime test: record eight facts, then finish.'}]})
 done=wait_for('turn/completed');initial_count=count;print('Initial turn:',done['params']['turn']['status'],'requests:',count,flush=True)
 if mode!='auto':
  rpc('thread/compact/start',{'threadId':thread_id});print('Compaction requested',flush=True)
  wait_for('turn/completed');print('Compaction turn completed',flush=True)
 rpc('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':'Continue the synthetic test after compaction.'}]})
 wait_for('turn/completed')
 second_recovery=None
 if mode=='repeat':
  rpc('thread/compact/start',{'threadId':thread_id});wait_for('turn/completed')
  rpc('turn/start',{'threadId':thread_id,'input':[{'type':'text','text':'Synthetic test after a second compaction, without new tool evidence.'}]});wait_for('turn/completed')
  second_recovery=requests[-1]['hasEvidence']
 plugin_hooks=[d['params']['run'] for d in events if d.get('method')=='hook/completed' and d.get('params',{}).get('run',{}).get('source')=='plugin' and 'codex-jev-compaction' in d['params']['run'].get('sourcePath','')]
 probe=[json.loads(line) for line in log.read_text().splitlines()]
 for r in probe:r.pop('pluginData',None)
 report={'mode':mode,'staleEvidenceAfterSecondCompaction':second_recovery,'mockModel':True,'mockJev':True,'realCodexRuntime':True,'requestCount':len(requests),
  'evidenceInContinuation':any(r['hasEvidence'] for r in requests), 'evidenceInImmediateAutoContinuation':any(r['hasEvidence'] for r in requests[:initial_count]) if mode=='auto' else None,
  'pluginHooks':[{'event':h['eventName'],'status':h['status'],'durationMs':h['durationMs']} for h in plugin_hooks], 'hookProbe':probe}
 assert {h['eventName'] for h in plugin_hooks} >= {'preCompact','sessionStart'}, 'Both plugin hooks must execute'
 assert all(h['status']=='completed' for h in plugin_hooks), 'Hook execution failed'
 assert report['evidenceInContinuation'] == (mode!='failure'), 'Unexpected recovery result'
 if mode=='auto': assert report['evidenceInImmediateAutoContinuation'], 'Evidence must reach the immediate mid-turn continuation'
 if mode=='repeat': assert second_recovery is False, 'Old checkpoint must not be reinjected after another compaction'
 succeeded=True
 (artifact/f'runtime-{mode}.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)

except Exception as e:
 print('Runtime smoke failed:',type(e).__name__,str(e),flush=True)
 print('Request metadata:',requests,flush=True)
 print('Event methods:',[d.get('method') for d in events][-25:],flush=True)
 print('App-server diagnostic lines:',len(errors),flush=True)
 (artifact/'runtime-failure-events.json').write_text(json.dumps(events,indent=2))
finally:
 if thread_id:
  try: rpc('thread/archive',{'threadId':thread_id})
  except:pass
 p.terminate()
 try:p.wait(timeout=5)
 except:p.kill()
 server.shutdown()

raise SystemExit(0 if succeeded else 1)
