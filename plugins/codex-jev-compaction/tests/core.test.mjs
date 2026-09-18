import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, readdir, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseTranscript, compact, collectPairs, buildState, askJev, checkpoint} from '../src/core.mjs';
import {runHook} from '../scripts/hook.mjs';
const fixture = JSON.parse(await readFile(new URL('../examples/session.json', import.meta.url), 'utf8'));
const response = (value) => async (_state, q) => Object.fromEntries(Object.keys(q).map(k => [k, {noul: value}]));

test('drops old tool pairs, retains original text, pinned pairs and input immutability', async () => {
  const original = structuredClone(fixture);
  const result = await compact(fixture, response(0));
  assert.equal(result.decisions.filter(d => d.action === 'drop').length, 2);
  assert.equal(result.items[0], fixture[0]);
  assert.equal(result.items.at(-1), fixture.at(-1));
  assert.equal(collectPairs(result.items).length, 3);
  assert.deepEqual(fixture, original);
});
test('retaining result also retains call regardless of call probability', async () => {
  const result = await compact(fixture, async (_s, q) => Object.fromEntries(Object.keys(q).map(k => [k, {noul: k.startsWith('result_') ? 1 : 0}])));
  assert.deepEqual(result.items, fixture);
});
test('truncate retains tool pair, prefix, annotation and message text', async () => {
  const result = await compact(fixture, async (_s,q) => Object.fromEntries(Object.keys(q).map(k => [k, {noul:k.startsWith('call_')?1:0}])));
  assert.equal(result.items[2].output.slice(0,300), fixture[2].output.slice(0,300));
  assert.match(result.items[2].output, /truncated/);
  assert.equal(result.items[1], fixture[1]);
});
for (const v of [-1, 1.1, NaN, null, '0.5']) test(`rejects invalid probability ${v}`, async () => {
  await assert.rejects(compact(fixture, response(v)), /Invalid Jev probability/);
});
test('missing answers and API failures abort whole compaction', async () => {
  await assert.rejects(compact(fixture, async () => ({})), /Invalid Jev/);
  await assert.rejects(compact(fixture, async () => {throw new Error('unavailable');}), /unavailable/);
});
test('unknown items, orphan calls and structured outputs are preserved', async () => {
  const items = [{type:'reasoning', encrypted_content:'opaque'},
    {type:'function_call', call_id:'orphan', name:'x', arguments:'{}'},
    {type:'function_call', call_id:'image', name:'x', arguments:'{}'},
    {type:'function_call_output', call_id:'image', output:[{type:'image', data:'opaque'}]}];
  const result = await compact(items, async () => {throw new Error('must not call');}, {recent:0});
  assert.deepEqual(result.items,items);
});
test('custom tool call pairing works', async () => {
  const items=structuredClone(fixture);
  items[1]={type:'custom_tool_call',name:'apply_patch',call_id:'call_0',input:'synthetic patch'};
  items[2].type='custom_tool_call_output';
  const r=await compact(items,response(0));
  assert.ok(!r.items.some(x=>x.call_id==='call_0'));
});
test('duplicate ids fail closed', () => {
  assert.throws(()=>collectPairs([...fixture,fixture[1]]),/Duplicate/);
});
test('rollout ignores metadata and stops at latest compaction boundary', () => {
  const rows=[{type:'response_item',payload:fixture[0]}, {type:'compacted',payload:{}}, {type:'session_meta',payload:{}}, {type:'response_item',payload:fixture.at(-1)}];
  assert.deepEqual(parseTranscript(rows.map(JSON.stringify).join('\n')), [fixture.at(-1)]);
  assert.throws(()=>parseTranscript('{bad'), SyntaxError);
  assert.throws(()=>parseTranscript('{"type":"session_meta"}'), /No supported/);
});
test('state includes output preview but never reasoning ciphertext', () => {
  const items=[...fixture,{type:'reasoning',encrypted_content:'NEVER_SEND_THIS'}];
  const s=JSON.stringify(buildState(items,collectPairs(items)));
  assert.ok(s.includes('Synthetic fixture'));
  assert.ok(!s.includes('NEVER_SEND_THIS'));
  assert.throws(()=>buildState(items,collectPairs(items),10),/budget/);
});
test('multi-request batching retains all decisions and bounded request size', async () => {
  const size=Buffer.byteLength(JSON.stringify(buildState(fixture,collectPairs(fixture,0))));
  let count=0;
  const r=await compact(fixture,async(s,q)=>{count++; assert.ok(Buffer.byteLength(JSON.stringify({model:'jev-latest',state:s,questions:q}))<=size+900); return response(1)(s,q);},{recent:0,maxRequestBytes:size+900});
  assert.ok(count>1); assert.equal(r.decisions.length,5); assert.deepEqual(r.items,fixture);
});
test('HTTP client uses fixed endpoint, rejects redirects and does not echo error bodies', async () => {
  await assert.rejects(askJev({}, {}, {apiKey:'fake',fetchFn:async(url,opts)=>{
    assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(opts.redirect,'error');
    return {ok:false,status:401,json:async()=>({secret:'do-not-echo'})};
  }}), /^Error: TypeSafe HTTP 401$/);
});
test('checkpoint bounded and labelled historical untrusted evidence', async () => {
  const r=await compact(fixture,response(1)); const text=checkpoint(fixture,r);
  assert.ok(text.length<=6000); assert.match(text,/untrusted historical/);assert.match(text,/call_id/);
});
async function setupHook() {
  const dir=await mkdtemp(join(tmpdir(),'codex-jev-test-'));
  const transcript=join(dir,'fixture.json');await writeFile(transcript,JSON.stringify(fixture));
  const env={PLUGIN_DATA:dir,JEV_ENABLE:'1',TYPESAFE_API_KEY:'fake'};
  const event={session_id:'test-session',cwd:dir,transcript_path:transcript,hook_event_name:'PreCompact'};
  return {dir,transcript,env,event};
}
test('hook creates private checkpoint, restores once, leaves transcript unchanged', async () => {
  const {dir,transcript,env,event}=await setupHook(); const before=await readFile(transcript,'utf8');
  await runHook(event,env,{ask:response(1)});
  const file=join(dir,'checkpoints',(await readdir(join(dir,'checkpoints')))[0]);
  assert.equal((await stat(file)).mode & 0o777,0o600);
  const restore={...event,hook_event_name:'SessionStart',source:'compact'};
  const output=await runHook(restore,env);assert.ok(output.hookSpecificOutput.additionalContext);
  assert.deepEqual(await runHook(restore,env),{});
  assert.equal(await readFile(transcript,'utf8'),before);
});
test('disabled hook does not read transcript or call network',async()=>{
  const {env,event}=await setupHook();
  assert.deepEqual(await runHook({...event,transcript_path:'/not-a-file'}, {...env,JEV_ENABLE:'0'}, {ask:async()=>{throw new Error('network');}}),{});
});
test('failed precompact invalidates previously saved checkpoint',async()=>{
  const {env,event}=await setupHook();await runHook(event,env,{ask:response(1)});
  await assert.rejects(runHook(event,env,{ask:async()=>{throw new Error('offline');}}));
  assert.deepEqual(await runHook({...event,hook_event_name:'SessionStart',source:'compact'},env),{});
});
test('stale and wrong-session checkpoints are not restored',async()=>{
  const {dir,env,event}=await setupHook();await runHook(event,env,{ask:response(1)});
  assert.deepEqual(await runHook({...event,session_id:'another',hook_event_name:'SessionStart',source:'compact'},env),{});
  const file=join(dir,'checkpoints',(await readdir(join(dir,'checkpoints')))[0]);
  const data=JSON.parse(await readFile(file));data.createdAt=0;await writeFile(file,JSON.stringify(data));
  assert.deepEqual(await runHook({...event,hook_event_name:'SessionStart',source:'compact'},env),{});
});

test('hook process fails open on malformed stdin with valid JSON stdout', async () => {
  const {spawnSync}=await import('node:child_process');
  const p=spawnSync(process.execPath,['scripts/hook.mjs'],{input:'{broken',encoding:'utf8'});
  assert.equal(p.status,0);assert.deepEqual(JSON.parse(p.stdout),{});assert.ok(!p.stdout.includes('broken'));
});
test('CLI refuses overwrite before any network call', async () => {
  const {spawnSync}=await import('node:child_process');
  const {transcript}=await setupHook(); const before=await readFile(transcript,'utf8');
  const p=spawnSync(process.execPath,['scripts/cli.mjs','compact',transcript,transcript,'--send-to-typesafe'],{env:{...process.env,TYPESAFE_API_KEY:'fake'},encoding:'utf8'});
  assert.equal(p.status,1); assert.match(p.stderr,/new file/);assert.equal(await readFile(transcript,'utf8'),before);
});
test('CLI requires explicit transfer flag', async () => {
  const {spawnSync}=await import('node:child_process');
  const p=spawnSync(process.execPath,['scripts/cli.mjs','compact','examples/session.json','unused.json'],{encoding:'utf8'});
  assert.equal(p.status,1);assert.match(p.stderr,/send-to-typesafe/);
});
