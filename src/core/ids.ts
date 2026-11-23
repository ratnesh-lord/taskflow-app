/**
 * Ids that two devices work out independently and agree on.
 *
 * A tag named "exam", or Saturday's occurrence of a recurring task, gets the
 * same id on every device, so creating it offline on two phones produces one
 * row after sync instead of two. These are name-based UUIDs (RFC 4122 version 5).
 */

/** TaskFlow's own namespace for name-based ids. Never change it. */
export const TASKFLOW_NAMESPACE = '9b1d4f6e-3c2a-4e57-8a91-5d0c7e2f4b13';

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    c = 0;
  }
  return out;
}

function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8;
  const msg = [...bytes, 0x80];
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i -= 1) msg.push(i >= 4 ? 0 : (ml >>> (i * 8)) & 255);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = (msg[off + 4 * i] << 24) | (msg[off + 4 * i + 1] << 16) | (msg[off + 4 * i + 2] << 8) | msg[off + 4 * i + 3];
    }
    for (let i = 16; i < 80; i += 1) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i += 1) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) out.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
  return out;
}

function uuidBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Not a uuid: ${uuid}`);
  const out: number[] = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

export function uuidV5(name: string, namespace: string): string {
  const hash = sha1([...uuidBytes(namespace), ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Tag names are matched without case and surrounding spaces. */
export function normaliseTagName(name: string): string {
  return name.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
}

export function tagId(userId: string, name: string): string {
  return uuidV5(`tag:${userId}:${normaliseTagName(name)}`, TASKFLOW_NAMESPACE);
}

export function taskTagId(taskId: string, tagIdValue: string): string {
  return uuidV5(`task-tag:${taskId}:${tagIdValue}`, TASKFLOW_NAMESPACE);
}

export function occurrenceId(taskId: string, date: string): string {
  return uuidV5(`occurrence:${taskId}:${date}`, TASKFLOW_NAMESPACE);
}

/** The link between a task and its copy in a Google Tasks list: one per task and list, whichever device writes it. */
export function externalLinkId(taskId: string, listId: string): string {
  return uuidV5(`external:${taskId}:${listId}`, TASKFLOW_NAMESPACE);
}
