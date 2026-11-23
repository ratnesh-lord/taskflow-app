import { base64ToBytes } from './base64';

describe('base64', () => {
  it('decodes text of every length, with or without padding', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'TaskFlow ✓ picture']) {
      const encoded = Buffer.from(s).toString('base64');
      expect(Buffer.from(base64ToBytes(encoded)).toString()).toBe(s);
      expect(Buffer.from(base64ToBytes(encoded.replace(/=+$/, ''))).toString()).toBe(s);
    }
  });

  it('decodes binary bytes', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...base64ToBytes(Buffer.from(bytes).toString('base64'))]).toEqual([...bytes]);
  });
});
