/**
 * Stores one long string as several short ones.
 *
 * A Supabase session (two tokens plus the user record) is a few thousand
 * characters, more than a secure-storage entry is meant to hold. This splits
 * the value across numbered entries so the whole session stays in encrypted
 * storage.
 *
 *   <key>.count   how many chunks there are
 *   <key>.0 ...   the chunks
 */
import type { KeyValueStore } from './kv';

export const CHUNK_SIZE = 1800;

export function createChunkedStorage(base: KeyValueStore, chunkSize: number = CHUNK_SIZE): KeyValueStore {
  const countKey = (key: string) => `${key}.count`;
  const chunkKey = (key: string, index: number) => `${key}.${index}`;

  async function readCount(key: string): Promise<number> {
    const raw = await base.getItem(countKey(key));
    const count = raw == null ? 0 : Number(raw);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  return {
    async getItem(key) {
      const count = await readCount(key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await base.getItem(chunkKey(key, i));
        // A missing chunk means a write was interrupted: treat the value as absent.
        if (part == null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const previous = await readCount(key);
      const count = Math.max(1, Math.ceil(value.length / chunkSize));
      // Hide the old value first, so a crash mid-write can never leave a mix
      // of old and new chunks that reads back as one value.
      await base.removeItem(countKey(key));
      for (let i = 0; i < count; i += 1) {
        await base.setItem(chunkKey(key, i), value.slice(i * chunkSize, (i + 1) * chunkSize));
      }
      await base.setItem(countKey(key), String(count));
      for (let i = count; i < previous; i += 1) {
        await base.removeItem(chunkKey(key, i));
      }
    },

    async removeItem(key) {
      const count = await readCount(key);
      await base.removeItem(countKey(key));
      for (let i = 0; i < count; i += 1) {
        await base.removeItem(chunkKey(key, i));
      }
    },
  };
}
