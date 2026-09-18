import {readFile, writeFile, mkdir, rename, unlink, stat} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join} from 'node:path';
import {parseTranscript, compact, askJev, checkpoint} from '../src/core.mjs';

export async function runHook(event, env = process.env, deps = {}) {
  if (!env.PLUGIN_DATA || typeof event.session_id !== 'string' || typeof event.cwd !== 'string') return {};
  const dir = resolve(env.PLUGIN_DATA, 'checkpoints');
  const id = createHash('sha256').update(event.session_id + '\0' + resolve(event.cwd)).digest('hex');
  const file = join(dir, id + '.json');
  if (event.hook_event_name === 'PreCompact') {
    await unlink(file).catch(() => {}); // Invalidate stale state even if this attempt fails.
    if (env.JEV_ENABLE !== '1' || !env.TYPESAFE_API_KEY || !event.transcript_path) return {};
    const size = (await stat(event.transcript_path)).size;
    if (size > 20 * 1024 * 1024) throw new Error('Transcript exceeds 20 MiB limit');
    const items = parseTranscript(await readFile(event.transcript_path, 'utf8'));
    const signal = AbortSignal.timeout(18000);
    const ask = deps.ask ?? ((state, questions) => askJev(state, questions, {apiKey: env.TYPESAFE_API_KEY, signal}));
    const result = await compact(items, ask);
    const evidence = checkpoint(items, result);
    if (!evidence) return {};
    await mkdir(dir, {recursive: true, mode: 0o700});
    const tmp = file + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, JSON.stringify({session: event.session_id, cwd: resolve(event.cwd), createdAt: Date.now(), evidence}), {mode: 0o600, flag: 'wx'});
    await rename(tmp, file);
    return {};
  }
  if (event.hook_event_name === 'SessionStart' && event.source === 'compact') {
    if (env.JEV_ENABLE !== '1') {await unlink(file).catch(() => {}); return {};}
    let data;
    try {data = JSON.parse(await readFile(file, 'utf8'));} catch {return {};}
    await unlink(file).catch(() => {}); // One-shot: never inject a checkpoint twice.
    const age = Date.now() - data.createdAt;
    if (data.session !== event.session_id || data.cwd !== resolve(event.cwd) || !Number.isFinite(age) || age < 0 || age > 900000 || typeof data.evidence !== 'string' || data.evidence.length > 6000) return {};
    return {hookSpecificOutput: {hookEventName: 'SessionStart', additionalContext: data.evidence}};
  }
  return {};
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {input += chunk; if (input.length > 65536) throw new Error('Hook input too large');}
    process.stdout.write(JSON.stringify(await runHook(JSON.parse(input))));
  } catch {
    // Hook failures must not stop native compaction or expose transcript / API details.
    process.stderr.write('codex-jev-compaction: checkpoint unavailable; native compaction continues.\n');
    process.stdout.write('{}');
  }
}
