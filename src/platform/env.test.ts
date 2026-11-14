import { checkConfig } from './env';

const KEY = 'sb_publishable_0123456789abcdef';

describe('checkConfig', () => {
  it('accepts a Supabase project address with a key', () => {
    expect(checkConfig('https://abcd1234.supabase.co', KEY)).toBe(true);
  });

  it('accepts a database running on this machine over http', () => {
    expect(checkConfig('http://127.0.0.1:54321', KEY)).toBe(true);
    expect(checkConfig('http://localhost:54321', KEY)).toBe(true);
  });

  it('refuses plain http for anything else', () => {
    expect(checkConfig('http://abcd1234.supabase.co', KEY)).toBe(false);
    expect(checkConfig('http://localhost.evil.example', KEY)).toBe(false);
  });

  it('refuses a missing or malformed address', () => {
    expect(checkConfig('', KEY)).toBe(false);
    expect(checkConfig('abcd1234.supabase.co', KEY)).toBe(false);
    expect(checkConfig('https://abcd1234.supabase.co/rest/v1', KEY)).toBe(false);
  });

  it('refuses a missing, short or broken key', () => {
    expect(checkConfig('https://abcd1234.supabase.co', '')).toBe(false);
    expect(checkConfig('https://abcd1234.supabase.co', 'short')).toBe(false);
    expect(checkConfig('https://abcd1234.supabase.co', 'sb_publishable_0123 456789abcdef')).toBe(false);
  });
});
