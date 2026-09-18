import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readdir, readFile, rm, chmod, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compact, checkpoint, buildState, collectPairs, excerpt, askJev, parseTranscript} from '../src/core.mjs';
import {readBounded} from '../src/io.mjs';
import {apiKeyFrom} from '../src/config.mjs';
import {runHook} from '../scripts/hook.mjs';

const fakeScores = async (_state, q) => Object.fromEntries(Object.keys(q).map(k => [k, {type: 'noul', noul: 0.9}]));
const message = text => ({type: 'message', role: 'user', content: [{type: 'input_text', text}]});
function history(count = 10) {
  return [message('Synthetic test. Preserve original deployment evidence.'), ...Array.from({length: count}, (_, i) => [
    {type: 'function_call', call_id: `test_${i}`, name: 'read_log', arguments: '{}'},
    {type: 'function_call_output', call_id: `test_${i}`, output: `${i === 0 ? 'CRITICAL_OLD_EVIDENCE' : 'irrelevant log'}\n${'x'.repeat(2500)}\nTAIL_${i}`},
  ]).flat(), message('Continue investigating the original failure.')];
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-system-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const transcript = join(dir, 'synthetic.json');
  await writeFile(transcript, JSON.stringify(history()));
  return {dir, env: {PLUGIN_DATA: dir, JEV_ENABLE: '1', TYPESAFE_API_KEY: 'synthetic-only'}, event: {hook_event_name: 'PreCompact', trigger: 'manual', session_id: 'synthetic-session', cwd: dir, transcript_path: transcript}};
}

test('selected old evidence wins over pinned recent tool logs', async () => {
  const items = history();
  const result = await compact(items, async (_s, q) => Object.fromEntries(Object.keys(q).map(k => [k, {noul: k.endsWith('_0') ? 1 : 0}])));
  const text = checkpoint(items, result, 2000);
  assert.match(text, /CRITICAL_OLD_EVIDENCE/);
  assert.ok(text.length <= 2000);
});
test('head-tail previews retain final errors and user corrections', () => {
  assert.match(excerpt('start' + 'x'.repeat(8000) + 'TAIL_ERROR', 800), /TAIL_ERROR$/);
  assert.equal(excerpt('text', 0), '');
  const items = [...history(), message('x'.repeat(12000) + 'LATEST_USER_CORRECTION')];
  const state = buildState(items, collectPairs(items));
  assert.match(JSON.stringify(state), /LATEST_USER_CORRECTION/);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) <= 20000);
});
test('120 tool calls with long logs score in bounded batches and concurrency', async () => {
  let active = 0, peak = 0, calls = 0;
  const items = history(120);
  const result = await compact(items, async (state, questions) => {
    active++; peak = Math.max(active, peak); calls++;
    assert.ok(Buffer.byteLength(JSON.stringify({model: 'jev-latest', state, questions})) <= 28000);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return fakeScores(state, questions);
  });
  assert.equal(result.decisions.length, 120);
  assert.equal(peak, 2);
  assert.ok(calls > 1 && calls <= 20);
  assert.deepEqual(result.items, items);
});
test('excessive history refuses before any paid request', async () => {
  let calls = 0;
  await assert.rejects(compact(history(300), async () => { calls++; }), /Request limit/);
  assert.equal(calls, 0);
});
test('checkpoint obeys tiny budgets and emits no empty header', async () => {
  const items = history(); const result = await compact(items, fakeScores);
  for (const budget of [0, 50, 300, 1000, 6000]) assert.ok(checkpoint(items, result, budget).length <= budget);
  assert.equal(checkpoint(items, result, 50), '');
});
test('200 deterministic randomized decisions preserve text, unknown items and intact pairing', async () => {
  let seed = 931;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 200; trial++) {
    const items = history(5 + Math.floor(random() * 20));
    items.push({type: 'future_unknown', body: 'unchanged'});
    const original = JSON.stringify(items);
    const result = await compact(items, async (_s, q) => Object.fromEntries(Object.keys(q).map(k => [k, {noul: random()}])));
    assert.equal(JSON.stringify(items), original);
    assert.deepEqual(result.items.filter(x => x.type === 'message'), items.filter(x => x.type === 'message'));
    assert.deepEqual(result.items.at(-1), items.at(-1));
    for (const output of result.items.filter(x => x.type === 'function_call_output')) {
      assert.ok(result.items.some(x => x.type === 'function_call' && x.call_id === output.call_id));
    }
    for (const pinned of result.decisions.filter(x => x.pinned)) assert.ok(result.items.includes(items[pinned.result]));
  }
});
test('multiple concurrent restores inject once', async t => {
  const {env, event} = await setup(t);
  await runHook(event, env, {ask: fakeScores});
  const outputs = await Promise.all(Array.from({length: 12}, () => runHook({...event, hook_event_name: 'SessionStart', source: 'compact'}, env)));
  assert.equal(outputs.filter(x => x.hookSpecificOutput).length, 1);
});
test('overlapping compaction performs at most one scoring operation', async t => {
  const {env, event} = await setup(t); let calls = 0;
  await Promise.all(Array.from({length: 6}, () => runHook(event, env, {ask: async (s, q) => {
    calls++; await new Promise(r => setTimeout(r, 30)); return fakeScores(s, q);
  }})));
  assert.equal(calls, 1);
});
test('disabled/missing-key operation never contacts Jev', async t => {
  const {env, event} = await setup(t);
  for (const override of [{JEV_ENABLE: '0'}, {TYPESAFE_API_KEY: ''}]) {
    assert.deepEqual(await runHook(event, {...env, ...override}, {ask: () => { throw new Error('network must not run'); }}), {});
  }
});
test('startup and resume do not consume a compaction checkpoint', async t => {
  const {env, event} = await setup(t); await runHook(event, env, {ask: fakeScores});
  for (const source of ['startup', 'resume', 'clear']) assert.deepEqual(await runHook({...event, hook_event_name: 'SessionStart', source}, env), {});
  assert.ok((await runHook({...event, hook_event_name: 'SessionStart', source: 'compact'}, env)).hookSpecificOutput);
});
test('future/corrupt/oversize checkpoints are never injected', async t => {
  const {dir, env, event} = await setup(t);
  for (const mutate of [d => ({...d, createdAt: Date.now() + 999999}), d => ({...d, evidence: 'x'.repeat(70000)}), () => null]) {
    await runHook(event, env, {ask: fakeScores});
    const file = join(dir, 'checkpoints', (await readdir(join(dir, 'checkpoints'))).find(x => x.endsWith('.json')));
    await writeFile(file, JSON.stringify(mutate(JSON.parse(await readFile(file, 'utf8')))));
    assert.deepEqual(await runHook({...event, hook_event_name: 'SessionStart', source: 'compact'}, env), {});
  }
});
test('status files never contain transcript text, API keys, or tool arguments', async t => {
  const {dir, env, event} = await setup(t);
  await runHook(event, env, {ask: fakeScores});
  const statuses = await readdir(join(dir, 'status'));
  const text = await readFile(join(dir, 'status', statuses[0]), 'utf8');
  assert.match(text, /checkpoint_ready/);
  for (const secret of ['CRITICAL_OLD_EVIDENCE', 'synthetic-only', 'read_log']) assert.ok(!text.includes(secret));
});
test('bounded reader rejects oversized, symlink and non-regular input', async t => {
  const {dir} = await setup(t); const file = join(dir, 'oversized');
  await writeFile(file, 'x'.repeat(50)); await assert.rejects(readBounded(file, 10), /size limit/);
  await assert.rejects(readBounded(dir, 100), /regular/);
  if (process.platform !== 'win32') { await symlink(file, join(dir, 'link')); await assert.rejects(readBounded(join(dir, 'link'), 100), /regular/); }
});
test('key file supports private configuration, rejects loose permissions, never returns key in doctor', async t => {
  const {dir} = await setup(t); const file = join(dir, 'key'); const key = 'TEST_SECRET_NOT_REAL';
  await writeFile(file, key + '\n', {mode: 0o600});
  assert.equal(await apiKeyFrom({TYPESAFE_API_KEY_FILE: file}), key);
  const p = spawnSync(process.execPath, ['scripts/cli.mjs', 'doctor'], {env: {...process.env, TYPESAFE_API_KEY: '', TYPESAFE_API_KEY_FILE: file}, encoding: 'utf8'});
  assert.equal(p.status, 0); assert.ok(!p.stdout.includes(key)); assert.equal(JSON.parse(p.stdout).keyConfigured, true);
  if (process.platform !== 'win32') { await chmod(file, 0o644); await assert.rejects(apiKeyFrom({TYPESAFE_API_KEY_FILE: file}), /private/); }
});
test('existing output path fails before any network traffic even with invalid credentials', async t => {
  const {dir, event} = await setup(t); const out = join(dir, 'exists.json'); await writeFile(out, 'unchanged');
  const p = spawnSync(process.execPath, ['scripts/cli.mjs', 'compact', event.transcript_path, out, '--send-to-typesafe'], {env: {...process.env, TYPESAFE_API_KEY: 'test\ninvalid-header'}, encoding: 'utf8'});
  assert.equal(p.status, 1); assert.match(p.stderr, /new file/); assert.equal(await readFile(out, 'utf8'), 'unchanged');
});
test('malformed transcript errors do not include private input', () => {
  assert.throws(() => parseTranscript('SECRET_PRIVATE_CONTENT'), error => !error.message.includes('SECRET_PRIVATE_CONTENT'));
});
for (const code of [401, 429, 500, 529]) test(`HTTP ${code} fails without retrying or leaking response bodies`, async () => {
  let calls = 0;
  await assert.rejects(askJev({}, {}, {apiKey: 'fake', fetchFn: async () => {calls++; return {ok: false, status: code, json: async () => ({secret: 'PRIVATE'})};}}), new RegExp(`HTTP ${code}$`));
  assert.equal(calls, 1);
});
test('HTTP client validates answer types and reports numeric usage only', async () => {
  const q = {keep: {type: 'noul', instructions: 'Keep?'}}; const usages = [];
  const fetchFn = async () => ({ok: true, json: async () => ({model: 'jev-test', answers: {keep: {type: 'noul', noul: 0.8}}, usage: {input_tokens: 100, output_tokens: 10, secret: 'PRIVATE'}})});
  const answers = await askJev({}, q, {apiKey: 'fake', fetchFn, onUsage: u => usages.push(u)});
  assert.equal(answers.keep.noul, 0.8); assert.deepEqual(usages, [{model: 'jev-test', inputTokens: 100, outputTokens: 10}]);
  await assert.rejects(askJev({}, q, {apiKey: 'fake', fetchFn: async () => ({ok: true, json: async () => ({answers: {keep: {type: 'choice', noul: 0.8}}})})}), /answer type/);
});
test('network exceptions and invalid response JSON never echo remote/private text', async () => {
  await assert.rejects(askJev({}, {}, {apiKey: 'fake', fetchFn: async () => {throw new Error('PRIVATE');}}), /^Error: TypeSafe network request failed$/);
  await assert.rejects(askJev({}, {}, {apiKey: 'fake', fetchFn: async () => ({ok: true, json: async () => {throw new Error('PRIVATE');}})}), /^Error: Invalid TypeSafe response$/);
});
test('aborted request fails promptly with sanitized timeout reason', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(askJev({}, {}, {apiKey: 'fake', signal: controller.signal, fetchFn: async (_u, opts) => {opts.signal.throwIfAborted();}}), /timed out or aborted/);
});

test('all nine scenarios retain full selected facts, including log middles, in private snapshots', async t => {
  const {evaluationCases} = await import('../examples/evaluation.mjs');
  const {saveEvidence, readEvidence} = await import('../src/evidence.mjs');
  const {dir, event} = await setup(t);
  for (const entry of evaluationCases()) {
    const result = await compact(entry.items, async (_s, q) => Object.fromEntries(Object.entries(q).map(([id, question]) => [id, {noul: question.instructions.includes('critical (') ? 1 : 0}])));
    const path = await saveEvidence(dir, event, entry.items, result);
    const listing = await readEvidence(path, undefined, {cwd: dir});
    assert.ok(listing.records.some(r => r.id === 'critical'));
    assert.ok(!listing.records.some(r => r.id === 'irrelevant'));
    let text = '', offset = 0;
    do { const page = await readEvidence(path, 'critical', {cwd: dir, offset}); text += page.text; offset = page.nextOffset; } while (offset !== null);
    assert.ok(text.includes(entry.fact), entry.id);
    assert.equal(text, entry.items[2].output);
  }
});
test('snapshot reader rejects wrong workspace, expired data and invalid page ranges', async t => {
  const {saveEvidence, readEvidence} = await import('../src/evidence.mjs');
  const {dir, event} = await setup(t); const items = history();
  const path = await saveEvidence(dir, event, items, await compact(items, fakeScores));
  await assert.rejects(readEvidence(path, 'test_0', {cwd: join(dir, 'other')}), /workspace/);
  await assert.rejects(readEvidence(path, 'test_0', {cwd: dir, offset: -1}), /page/);
  await assert.rejects(readEvidence(path, '__proto__', {cwd: dir}), /Unknown/);
  const data = JSON.parse(await readFile(path)); data.createdAt = 0; await writeFile(path, JSON.stringify(data));
  await assert.rejects(readEvidence(path, 'test_0', {cwd: dir}), /expired/);
});
test('a real hook subprocess survives parse and credential errors without leaking input', async t => {
  const {env, event} = await setup(t);
  for (const input of ['null', '{"secret":"PRIVATE"', JSON.stringify({...event, transcript_path: '/not-found-PRIVATE'})]) {
    const p = spawnSync(process.execPath, ['scripts/hook.mjs'], {input, env: {...process.env, ...env}, encoding: 'utf8'});
    assert.equal(p.status, 0); assert.deepEqual(JSON.parse(p.stdout), {}); assert.ok(!p.stderr.includes('PRIVATE'));
  }
});
test('checkpoint advertises only a local bounded reader for omitted evidence', async t => {
  const {env, event} = await setup(t); await runHook(event, env, {ask: fakeScores});
  const restored = await runHook({...event, hook_event_name: 'SessionStart', source: 'compact'}, env);
  const text = restored.hookSpecificOutput.additionalContext;
  assert.match(text, /Full selected tool outputs/); assert.match(text, /cli\.mjs/); assert.ok(text.length <= 6000);
});
