#!/usr/bin/env node
import {compact, checkpoint, askJev} from '../src/core.mjs';
import {apiKeyFrom} from '../src/config.mjs';
import {evaluationCases} from '../examples/evaluation.mjs';

// Offline mode deliberately uses an oracle. It measures evidence transport, NOT model quality.
// Live mode sends only the bundled synthetic cases, never discovers local conversations.
const args = process.argv.slice(2);
try {
  if (args.length > 1 || (args.length && args[0] !== '--live-synthetic')) throw new Error('Usage: evaluate.mjs [--live-synthetic]');
  const live = args[0] === '--live-synthetic';
  const apiKey = live ? await apiKeyFrom(process.env) : null;
  if (live && !apiKey) throw new Error('Live evaluation requires TYPESAFE_API_KEY or TYPESAFE_API_KEY_FILE');
  const rows = [];
  for (const entry of evaluationCases()) {
    const usage = [];
    const started = performance.now();
    const signal = AbortSignal.timeout(18000);
    const ask = live ? (state, questions) => askJev(state, questions, {apiKey, signal, onUsage: u => usage.push(u)})
      : async (_s, questions) => Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, {type: 'noul', noul: q.instructions.includes('critical (') ? 1 : 0}]));
    try {
      const result = await compact(entry.items, ask);
      const evidence = checkpoint(entry.items, result);
      rows.push({case: entry.id, selectedCritical: result.decisions.find(d => d.id === 'critical')?.action === 'keep',
        restoredExactFact: evidence.includes(entry.fact), evidenceChars: evidence.length,
        elapsedMs: Math.round(performance.now() - started), requests: result.stats.requests, usage});
    } catch { rows.push({case: entry.id, failed: true, elapsedMs: Math.round(performance.now() - started)}); }
  }
  const facts = rows.filter(r => r.restoredExactFact).length;
  console.log(JSON.stringify({mode: live ? 'live Jev on bundled synthetic fixtures' : 'offline oracle; not Jev predictions',
    cases: rows.length, restoredFacts: facts, factRecall: facts / rows.length,
    releaseReady: false, releaseNote: 'This small retrieval suite is not a downstream Codex A/B quality evaluation. Full runtime and real-model gates remain required.', rows}, null, 2));
  if (rows.some(r => r.failed)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
