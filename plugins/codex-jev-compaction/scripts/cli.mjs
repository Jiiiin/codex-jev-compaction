#!/usr/bin/env node
import {readFile, writeFile, lstat, realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTranscript, compact, askJev} from '../src/core.mjs';
import {apiKeyFrom} from '../src/config.mjs';
import {readBounded} from '../src/io.mjs';
import {readEvidence} from '../src/evidence.mjs';

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'demo') {
    const input = fileURLToPath(new URL('../examples/session.json', import.meta.url));
    const items = parseTranscript(await readFile(input, 'utf8'));
    const result = await compact(items, async (_state, questions) => Object.fromEntries(Object.keys(questions).map(k => [k, {noul: k.endsWith('_0') ? 0.1 : 0.9}])));
    console.log(JSON.stringify({mode: 'offline fixture, no API call', decisions: result.decisions, stats: result.stats}, null, 2));
  } else if (command === 'evidence') {
    if (args.length < 1 || args.length > 3) throw new Error('Usage: evidence SNAPSHOT [CALL_ID [OFFSET]]');
    console.log(JSON.stringify(await readEvidence(args[0], args[1], {offset: args[2] === undefined ? 0 : Number(args[2])})));
  } else if (command === 'doctor') {
    const key = await apiKeyFrom(process.env);
    console.log(JSON.stringify({node: process.versions.node, nodeSupported: Number(process.versions.node.split('.')[0]) >= 22, enabled: process.env.JEV_ENABLE === '1', keyConfigured: Boolean(key), pluginDataConfigured: Boolean(process.env.PLUGIN_DATA), networkCalled: false, note: 'Also review /hooks in Codex. This checks the current process environment only.'}, null, 2));
  } else if (command === 'compact') {
    if (args.length !== 3 || args[2] !== '--send-to-typesafe') throw new Error('Usage: compact INPUT OUTPUT --send-to-typesafe (sends text, inputs and output previews)');
    const [input, output] = args;
    const apiKey = await apiKeyFrom(process.env);
    if (!apiKey) throw new Error('Set TYPESAFE_API_KEY or TYPESAFE_API_KEY_FILE');
    if (resolve(input) === resolve(output) || await realpath(output).catch(() => '') === await realpath(input)) throw new Error('Output must be a new file');
    try { await lstat(output); throw new Error('Output must be a new file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const items = parseTranscript(await readBounded(input, 20 * 1024 * 1024));
    const signal = AbortSignal.timeout(18000);
    const result = await compact(items, (state, questions) => askJev(state, questions, {apiKey, signal}));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify(result.stats));
  } else {
    console.log('Usage: node scripts/cli.mjs demo|doctor\n       node scripts/cli.mjs evidence SNAPSHOT [CALL_ID [OFFSET]]\n       node scripts/cli.mjs compact INPUT OUTPUT --send-to-typesafe\nINPUT: response-item JSON array or Codex rollout JSONL. Never modifies a live session.');
    if (command && command !== '--help') process.exitCode = 1;
  }
} catch (error) {console.error(error.message); process.exitCode = 1;}
