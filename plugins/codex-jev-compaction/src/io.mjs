import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';

// Reject pipes/devices and cap the actual read, including files growing after stat.
export async function readBounded(path, maxBytes) {
  if (!(await lstat(path)).isFile()) throw new Error('Expected a regular file');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('File exceeds size limit');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error('File exceeds size limit');
    return buffer.subarray(0, size).toString('utf8');
  } finally { await file.close(); }
}
