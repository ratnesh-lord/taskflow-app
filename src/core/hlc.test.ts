import { compareStamps, formatStamp, HybridClock, MAX_COUNTER, parseStamp } from './hlc';

const PHONE = '11111111-1111-4111-8111-111111111111';
const LAPTOP = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// The pattern sync_push accepts (supabase/migrations/20261114000400_sync_functions.sql).
const SERVER_FORMAT =
  /^[0-9]{15}:[0-9]{5}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('HybridClock', () => {
  it('produces stamps in the format the server accepts', () => {
    const clock = new HybridClock(PHONE, () => 1_794_596_000_123);
    const stamp = clock.now();
    expect(stamp).toMatch(SERVER_FORMAT);
    expect(stamp).toBe(`001794596000123:00000:${PHONE}`);
  });

  it('keeps increasing while the wall clock stands still', () => {
    const clock = new HybridClock(PHONE, () => 1000);
    const a = clock.now();
    const b = clock.now();
    const c = clock.now();
    expect(compareStamps(a, b)).toBeLessThan(0);
    expect(compareStamps(b, c)).toBeLessThan(0);
    expect(parseStamp(c)).toEqual({ millis: 1000, counter: 2, device: PHONE });
  });

  it('keeps increasing when the wall clock jumps backwards', () => {
    let wall = 5000;
    const clock = new HybridClock(PHONE, () => wall);
    const before = clock.now();
    wall = 1000;
    const after = clock.now();
    expect(compareStamps(before, after)).toBeLessThan(0);
  });

  it('stamps an edit later than any change it has already seen', () => {
    const phone = new HybridClock(PHONE, () => 1000);
    const laptopStamp = formatStamp(9000, 4, LAPTOP);
    phone.receive(laptopStamp);
    const next = phone.now();
    expect(compareStamps(laptopStamp, next)).toBeLessThan(0);
    expect(parseStamp(next)).toEqual({ millis: 9000, counter: 5, device: PHONE });
  });

  it('ignores an older remote stamp and malformed input', () => {
    const clock = new HybridClock(PHONE, () => 5000);
    const first = clock.now();
    clock.receive(formatStamp(10, 0, LAPTOP));
    clock.receive('yesterday');
    expect(clock.snapshot()).toEqual({ millis: 5000, counter: 0 });
    expect(compareStamps(first, clock.now())).toBeLessThan(0);
  });

  it('continues from its saved state after a restart', () => {
    const first = new HybridClock(PHONE, () => 7000);
    first.now();
    const last = first.now();
    const restarted = new HybridClock(PHONE, () => 6000, first.snapshot());
    expect(compareStamps(last, restarted.now())).toBeLessThan(0);
  });

  it('rolls the counter into the next millisecond instead of overflowing', () => {
    const clock = new HybridClock(PHONE, () => 1000, { millis: 1000, counter: MAX_COUNTER });
    const stamp = clock.now();
    expect(stamp).toMatch(SERVER_FORMAT);
    expect(parseStamp(stamp)).toEqual({ millis: 1001, counter: 0, device: PHONE });
  });

  it('never gives two devices the same stamp', () => {
    const a = new HybridClock(PHONE, () => 1000).now();
    const b = new HybridClock(LAPTOP, () => 1000).now();
    expect(a).not.toBe(b);
    expect(compareStamps(a, b)).not.toBe(0);
  });

  it('rejects a device id that is not a lower-case uuid', () => {
    expect(() => new HybridClock('PHONE')).toThrow(/uuid/);
    expect(() => new HybridClock(LAPTOP.toUpperCase())).toThrow(/uuid/);
  });

  it('orders stamps by time first, as text', () => {
    const stamps = [formatStamp(2000, 0, PHONE), formatStamp(1000, 7, LAPTOP), formatStamp(1000, 2, PHONE)];
    expect([...stamps].sort()).toEqual([stamps[2], stamps[1], stamps[0]]);
  });
});
