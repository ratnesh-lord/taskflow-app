/**
 * Hybrid logical clock.
 *
 * Every edit made on a device is stamped with one of these timestamps. The
 * server keeps the latest stamp per column and uses it to merge edits from
 * several devices field by field (see supabase/migrations, sync_push).
 *
 * Text form, which sorts correctly as plain text:
 *
 *   <15-digit milliseconds since 1970>:<5-digit counter>:<device uuid>
 *
 * Two properties matter:
 *   - a device's stamps always increase, even if its wall clock jumps back;
 *   - after seeing a stamp from another device, this device's next stamp is
 *     later than it, so "I edited after I saw your change" always wins.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAMP = /^(\d{15}):(\d{5}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const MAX_COUNTER = 99999;

export type Stamp = string;

export type ParsedStamp = { millis: number; counter: number; device: string };

export function formatStamp(millis: number, counter: number, device: string): Stamp {
  return `${String(millis).padStart(15, '0')}:${String(counter).padStart(5, '0')}:${device}`;
}

export function parseStamp(stamp: string): ParsedStamp | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  return { millis: Number(m[1]), counter: Number(m[2]), device: m[3] };
}

/** Plain text comparison: negative when a is earlier than b. */
export function compareStamps(a: Stamp, b: Stamp): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type ClockState = { millis: number; counter: number };

export class HybridClock {
  private millis: number;
  private counter: number;

  /**
   * @param device this device's id (lower-case uuid)
   * @param wallClock returns the current time in milliseconds
   * @param state last persisted state, so stamps keep increasing across restarts
   */
  constructor(
    private readonly device: string,
    private readonly wallClock: () => number = Date.now,
    state: ClockState = { millis: 0, counter: 0 },
  ) {
    if (!UUID.test(device)) {
      throw new Error(`HybridClock: device id must be a lower-case uuid, got "${device}"`);
    }
    this.millis = state.millis;
    this.counter = state.counter;
  }

  /** A new stamp, later than every stamp this clock has produced or seen. */
  now(): Stamp {
    const wall = Math.floor(this.wallClock());
    if (wall > this.millis) {
      this.millis = wall;
      this.counter = 0;
    } else {
      this.bump();
    }
    return formatStamp(this.millis, this.counter, this.device);
  }

  /** Take note of a stamp that arrived from the server. */
  receive(remote: Stamp): void {
    const parsed = parseStamp(remote);
    if (!parsed) return;
    if (parsed.millis > this.millis) {
      this.millis = parsed.millis;
      this.counter = parsed.counter;
    } else if (parsed.millis === this.millis && parsed.counter > this.counter) {
      this.counter = parsed.counter;
    }
  }

  /** Persist this between app launches. */
  snapshot(): ClockState {
    return { millis: this.millis, counter: this.counter };
  }

  private bump(): void {
    if (this.counter >= MAX_COUNTER) {
      this.millis += 1;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
  }
}
