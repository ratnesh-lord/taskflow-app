import { createChunkedStorage } from './chunked-storage';
import type { KeyValueStore } from './kv';

function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return { data, store };
}

describe('createChunkedStorage', () => {
  it('returns null for a key that was never written', async () => {
    const { store } = memoryStore();
    expect(await createChunkedStorage(store).getItem('session')).toBeNull();
  });

  it('round-trips a value longer than one chunk', async () => {
    const { data, store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    const value = 'abcdefghijklmnopqrstuvwxyz0123456789';
    await chunked.setItem('session', value);
    expect(await chunked.getItem('session')).toBe(value);
    expect(data.get('session.count')).toBe('4');
    expect([...data.values()].every((v) => v.length <= 10)).toBe(true);
  });

  it('round-trips a short value and an empty one', async () => {
    const { store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    await chunked.setItem('a', 'short');
    await chunked.setItem('b', '');
    expect(await chunked.getItem('a')).toBe('short');
    expect(await chunked.getItem('b')).toBe('');
  });

  it('leaves no stale chunks when a shorter value replaces a longer one', async () => {
    const { data, store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    await chunked.setItem('session', 'x'.repeat(45));
    await chunked.setItem('session', 'y'.repeat(12));
    expect(await chunked.getItem('session')).toBe('y'.repeat(12));
    expect([...data.keys()].sort()).toEqual(['session.0', 'session.1', 'session.count']);
  });

  it('removes every chunk', async () => {
    const { data, store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    await chunked.setItem('session', 'x'.repeat(45));
    await chunked.removeItem('session');
    expect(await chunked.getItem('session')).toBeNull();
    expect(data.size).toBe(0);
  });

  it('reads an interrupted write as absent rather than as a broken value', async () => {
    const { data, store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    await chunked.setItem('session', 'x'.repeat(45));
    data.delete('session.2');
    expect(await chunked.getItem('session')).toBeNull();
  });

  it('keeps separate keys apart', async () => {
    const { store } = memoryStore();
    const chunked = createChunkedStorage(store, 10);
    await chunked.setItem('one', '1'.repeat(25));
    await chunked.setItem('two', '2'.repeat(25));
    expect(await chunked.getItem('one')).toBe('1'.repeat(25));
    expect(await chunked.getItem('two')).toBe('2'.repeat(25));
  });
});
