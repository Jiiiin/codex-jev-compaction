#!/usr/bin/env node
import {readFile, writeFile, stat, realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTranscript, compact, askJev} from '../src/core.mjs';

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'demo') {
    const input = fileURLToPath(new URL('../examples/session.json', import.meta.url));
    const items = parseTranscript(await readFile(input, 'utf8'));
    const result = await compact(items, async (_state, questions) => Object.fromEntries(Object.keys(questions).map(k => [k, {noul: k.endsWith('_0') ? 0.1 : 0.9}])));
    console.log(JSON.stringify({mode: 'offline fixture, no API call', decisions: result.decisions, stats: result.stats}, null, 2));
  } else if (command === 'compact') {
    if (args.length !== 3 || args[2] !== '--send-to-typesafe') throw new Error('Usage: compact INPUT OUTPUT --send-to-typesafe (sends text, inputs and output previews)');
    const [input, output] = args;
    if (!process.env.TYPESAFE_API_KEY) throw new Error('Set TYPESAFE_API_KEY');
    if (resolve(input) === resolve(output) || await realpath(output).catch(() => '') === await realpath(input)) throw new Error('Output must be a new file');
    if ((await stat(input)).size > 20 * 1024 * 1024) throw new Error('Transcript exceeds 20 MiB limit');
    const items = parseTranscript(await readFile(input, 'utf8'));
    const signal = AbortSignal.timeout(18000);
    const result = await compact(items, (state, questions) => askJev(state, questions, {apiKey: process.env.TYPESAFE_API_KEY, signal}));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify(result.stats));
  } else {
    console.log('Usage: node scripts/cli.mjs demo\n       node scripts/cli.mjs compact INPUT OUTPUT --send-to-typesafe\nINPUT: response-item JSON array or Codex rollout JSONL. Never modifies a live session.');
    if (command && command !== '--help') process.exitCode = 1;
  }
} catch (error) {console.error(error.message); process.exitCode = 1;}
