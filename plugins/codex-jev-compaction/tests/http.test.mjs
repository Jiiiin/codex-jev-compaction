import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {askJev} from '../src/core.mjs';

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}
const questions = {keep: {type: 'noul', instructions: 'Keep this synthetic evidence?'}};

test('HTTP integration: real fetch encodes typed request, auth and usage correctly', async t => {
  const url = await serverFor(t, async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fake-for-loopback-only');
    let body = ''; for await (const chunk of request) body += chunk;
    const json = JSON.parse(body);
    assert.deepEqual(json.questions, questions); assert.equal(json.model, 'jev-latest');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({model: 'jev-synthetic', answers: {keep: {type: 'noul', noul: 0.9}}, usage: {input_tokens: 14, output_tokens: 3}}));
  });
  const usage = [];
  const answer = await askJev({synthetic: true}, questions, {apiKey: 'fake-for-loopback-only',
    fetchFn: (_fixed, options) => fetch(url, options), onUsage: u => usage.push(u)});
  assert.equal(answer.keep.noul, 0.9); assert.equal(usage[0].inputTokens, 14);
});
test('HTTP integration: delayed response is cancelled within the caller deadline', async t => {
  const url = await serverFor(t, () => {});
  const start = performance.now();
  await assert.rejects(askJev({}, questions, {apiKey: 'fake', signal: AbortSignal.timeout(80), fetchFn: (_fixed, options) => fetch(url, options)}), /timed out or aborted/);
  assert.ok(performance.now() - start < 2000);
});
test('HTTP integration: redirects are not followed and auth is never forwarded', async t => {
  let forwarded = 0;
  const sink = await serverFor(t, (_req, res) => {forwarded++; res.end('{}');});
  const url = await serverFor(t, (_req, res) => {res.writeHead(307, {location: sink}); res.end();});
  await assert.rejects(askJev({}, questions, {apiKey: 'fake', fetchFn: (_fixed, options) => fetch(url, options)}), /network request failed/);
  assert.equal(forwarded, 0);
});
test('HTTP integration: truncated JSON body fails with a generic error', async t => {
  const url = await serverFor(t, (_req, res) => {res.end('{"PRIVATE_REMOTE_FRAGMENT');});
  await assert.rejects(askJev({}, questions, {apiKey: 'fake', fetchFn: (_fixed, options) => fetch(url, options)}), /^Error: Invalid TypeSafe response$/);
});
