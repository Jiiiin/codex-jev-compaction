import {writeFile, mkdir, rename, unlink, lstat, open} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join} from 'node:path';
import {parseTranscript, compact, askJev, checkpoint} from '../src/core.mjs';
import {readBounded} from '../src/io.mjs';
import {apiKeyFrom} from '../src/config.mjs';
import {saveEvidence} from '../src/evidence.mjs';
import {fileURLToPath} from 'node:url';

async function privateDirectory(dir) {
  await mkdir(dir, {recursive: true, mode: 0o700});
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid data directory');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Data directory must be private');
}
async function atomicJson(file, data) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(data), {mode: 0o600, flag: 'wx'});
    await rename(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
}
export async function runHook(event, env = process.env, deps = {}) {
  if (!event || !env.PLUGIN_DATA || typeof event.session_id !== 'string' || typeof event.cwd !== 'string') return {};
  const dir = resolve(env.PLUGIN_DATA, 'checkpoints');
  const id = createHash('sha256').update(event.session_id + '\0' + resolve(event.cwd)).digest('hex');
  const file = join(dir, id + '.json');
  const status = async (outcome, extra = {}) => {
    // Metadata only: never persist dialogue, request bodies, keys or remote errors here.
    try {
      const statusDir = resolve(env.PLUGIN_DATA, 'status');
      await privateDirectory(statusDir);
      await atomicJson(join(statusDir, id + '.json'), {at: new Date().toISOString(), outcome, ...extra});
    } catch { /* Diagnostics must never affect the host. */ }
  };
  if (event.hook_event_name === 'PreCompact') {
    if (!['manual', 'auto', undefined].includes(event.trigger)) return {};
    await unlink(file).catch(() => {});
    if (env.JEV_ENABLE !== '1') return {};
    const apiKey = await apiKeyFrom(env);
    if (!apiKey) { await status('missing_key'); return {}; }
    if (!event.transcript_path) { await status('no_transcript'); return {}; }
    await privateDirectory(dir);
    const lock = file + '.lock';
    // Recover an abandoned lock after a killed process, beyond the host's 25s timeout.
    const lockInfo = await lstat(lock).catch(() => null);
    if (lockInfo && Date.now() - lockInfo.mtimeMs > 60000) await unlink(lock).catch(() => {});
    let lease;
    try { lease = await open(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') { await status('busy'); return {}; } throw error; }
    const started = Date.now();
    try {
      const items = parseTranscript(await readBounded(event.transcript_path, 20 * 1024 * 1024));
      const signal = AbortSignal.timeout(18000);
      const usages = [];
      const ask = deps.ask ?? ((state, questions) => askJev(state, questions, {apiKey, signal, onUsage: x => usages.push(x)}));
      const result = await compact(items, ask);
      if (!result.decisions.some(d => d.action !== 'drop')) { await status('no_evidence'); return {}; }
      const snapshotPath = await saveEvidence(env.PLUGIN_DATA, event, items, result);
      const evidence = checkpoint(items, result, 6000, {snapshotPath, readerPath: fileURLToPath(new URL('./cli.mjs', import.meta.url))});
      if (!evidence) { await status('no_evidence'); return {}; }
      await atomicJson(file, {session: event.session_id, cwd: resolve(event.cwd), createdAt: Date.now(), evidence});
      await status('checkpoint_ready', {elapsedMs: Date.now() - started, requests: result.stats.requests,
        evidenceChars: evidence.length, usage: usages});
      return {};
    } catch (error) {
      await unlink(file).catch(() => {});
      await status('unavailable', {elapsedMs: Date.now() - started});
      throw error;
    } finally { await lease.close(); await unlink(lock).catch(() => {}); }
  }
  if (event.hook_event_name === 'SessionStart' && event.source === 'compact') {
    if (env.JEV_ENABLE !== '1') {await unlink(file).catch(() => {}); return {};}
    // Atomic claim: concurrent restores cannot both read the same checkpoint.
    const claimed = file + '.' + randomUUID() + '.claimed';
    try { await rename(file, claimed); } catch { return {}; }
    let data;
    try { data = JSON.parse(await readBounded(claimed, 65536)); }
    catch { await status('invalid_checkpoint'); return {}; }
    finally { await unlink(claimed).catch(() => {}); }
    if (!data || typeof data !== 'object') return {};
    const age = Date.now() - data.createdAt;
    if (data.session !== event.session_id || data.cwd !== resolve(event.cwd) || !Number.isFinite(age) || age < 0 || age > 900000 || typeof data.evidence !== 'string' || !data.evidence || data.evidence.length > 6000) return {};
    await status('restored', {evidenceChars: data.evidence.length});
    return {hookSpecificOutput: {hookEventName: 'SessionStart', additionalContext: data.evidence}};
  }
  return {};
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {input += chunk; if (Buffer.byteLength(input) > 65536) throw new Error('Hook input too large');}
    process.stdout.write(JSON.stringify(await runHook(JSON.parse(input))));
  } catch {
    process.stderr.write('codex-jev-compaction: checkpoint unavailable; native compaction continues.\n');
    process.stdout.write('{}');
  }
}
