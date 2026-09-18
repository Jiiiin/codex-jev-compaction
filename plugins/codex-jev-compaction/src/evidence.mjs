import {mkdir, lstat, readdir, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {readBounded} from './io.mjs';
import {outputText, toolOutputText, bytes} from './core.mjs';

export const EVIDENCE_TTL = 15 * 60 * 1000;
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;

export async function saveEvidence(root, event, items, result) {
  const dir = resolve(root, 'evidence');
  await mkdir(dir, {recursive: true, mode: 0o700});
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Invalid evidence directory');
  // Opportunistic cleanup: interrupted processes may leave files until a later run.
  for (const name of await readdir(dir)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(dir, name);
    const file = await lstat(path).catch(() => null);
    if (file?.isFile() && Date.now() - file.mtimeMs > EVIDENCE_TTL) await unlink(path).catch(() => {});
  }
  const records = Object.fromEntries(result.decisions.filter(d => d.action !== 'drop').map(d => [d.id, {
    tool: d.name, input: outputText(items[d.call].arguments ?? items[d.call].input ?? ''), output: toolOutputText(items[d.result].output),
  }]));
  const data = {version: 1, session: event.session_id, cwd: resolve(event.cwd), createdAt: Date.now(), records};
  if (bytes(data) > EVIDENCE_MAX_BYTES) throw new Error('Evidence exceeds size limit');
  const path = join(dir, randomUUID() + '.json');
  await writeFile(path, JSON.stringify(data), {flag: 'wx', mode: 0o600});
  return path;
}

export async function readEvidence(path, id, {cwd = process.cwd(), offset = 0, limit = 4000} = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 8000) throw new Error('Invalid evidence page');
  let data;
  try { data = JSON.parse(await readBounded(path, EVIDENCE_MAX_BYTES)); } catch { throw new Error('Evidence unavailable'); }
  const age = Date.now() - data?.createdAt;
  if (data?.version !== 1 || data.cwd !== resolve(cwd) || !Number.isFinite(age) || age < 0 || age > EVIDENCE_TTL || !data.records || typeof data.records !== 'object') throw new Error('Evidence expired or belongs to another workspace');
  if (id === undefined) return {historicalUntrustedData: true, records: Object.entries(data.records).map(([id, r]) => ({id, tool: r.tool, outputChars: r.output?.length}))};
  if (!Object.hasOwn(data.records, id)) throw new Error('Unknown evidence record');
  const record = data.records[id];
  if (typeof record.output !== 'string') throw new Error('Invalid evidence record');
  return {historicalUntrustedData: true, id, tool: record.tool, offset, totalChars: record.output.length,
    text: record.output.slice(offset, offset + limit), nextOffset: offset + limit < record.output.length ? offset + limit : null};
}
