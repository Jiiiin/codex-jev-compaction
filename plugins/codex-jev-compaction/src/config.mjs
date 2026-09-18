import {stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {readBounded} from './io.mjs';

export async function apiKeyFrom(env) {
  if (env.TYPESAFE_API_KEY?.trim()) return env.TYPESAFE_API_KEY.trim();
  if (!env.TYPESAFE_API_KEY_FILE) return null;
  if (!isAbsolute(env.TYPESAFE_API_KEY_FILE)) throw new Error('Key file path must be absolute');
  const info = await stat(env.TYPESAFE_API_KEY_FILE);
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Key file must be private (chmod 600)');
  const key = (await readBounded(env.TYPESAFE_API_KEY_FILE, 4096)).trim();
  if (!key || /\s/.test(key)) throw new Error('Key file must contain only the API key');
  return key;
}
