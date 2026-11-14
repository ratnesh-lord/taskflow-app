/** Web: the browser's localStorage. Falls back to memory when storage is blocked. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const kv: KeyValueStore = {
  async getItem(key) {
    try {
      return storage()?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  async setItem(key, value) {
    memory.set(key, value);
    try {
      storage()?.setItem(key, value);
    } catch {
      // Private browsing or a full quota: keep the in-memory copy.
    }
  },
  async removeItem(key) {
    memory.delete(key);
    try {
      storage()?.removeItem(key);
    } catch {
      // Nothing to do.
    }
  },
};
