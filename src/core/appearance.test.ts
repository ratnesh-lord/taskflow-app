import {
  DEFAULT_COLORS, emojiOf, formatIcon, isEmoji, parseIcon, picturePath, readColorSettings, SUGGESTED_EMOJI, taskColor, titleWithEmoji,
} from './appearance';
import { CLIPART } from './clipart';

const USER = '4f1c2b8e-1d2e-4a3b-9c4d-5e6f7a8b9c0d';

describe('task colours', () => {
  it('defaults: coloured by priority, critical red, high orange, medium blue, low grey', () => {
    expect(readColorSettings(null)).toEqual(DEFAULT_COLORS);
    expect(DEFAULT_COLORS).toEqual({ by: 'priority', priority: { critical: 'red', high: 'orange', medium: 'blue', low: 'grey' } });
  });

  it('keeps chosen colours and fills in anything missing or unknown', () => {
    expect(readColorSettings({ colors: { by: 'project', priority: { high: 'violet', low: 'purple' } } })).toEqual({
      by: 'project', priority: { critical: 'red', high: 'violet', medium: 'blue', low: 'grey' },
    });
    expect(readColorSettings({ colors: { by: 'rainbow' } }).by).toBe('priority');
  });

  it('a task takes its priority colour, its project colour, or none, as the setting says', () => {
    const projects = new Map<string, string | null>([['p1', 'teal'], ['p2', null], ['p3', 'not-a-colour']]);
    const task = { priority: 'high' as const, projectId: 'p1' };
    expect(taskColor(task, projects, DEFAULT_COLORS)).toBe('orange');
    const byProject = { ...DEFAULT_COLORS, by: 'project' as const };
    expect(taskColor(task, projects, byProject)).toBe('teal');
    expect(taskColor({ ...task, projectId: 'p2' }, projects, byProject)).toBeNull();
    expect(taskColor({ ...task, projectId: 'p3' }, projects, byProject)).toBeNull();
    expect(taskColor({ ...task, projectId: null }, projects, byProject)).toBeNull();
    expect(taskColor(task, projects, { ...DEFAULT_COLORS, by: 'none' })).toBeNull();
  });
});

describe('task pictures', () => {
  it('emoji are recognised, including sequences, flags, keycaps and skin tones; words are not', () => {
    for (const e of ['🎂', '❤️', '✈️', '👨‍👩‍👧', '🇮🇳', '1️⃣', '👍🏽', '☕', ...SUGGESTED_EMOJI]) expect([e, isEmoji(e)]).toEqual([e, true]);
    for (const e of ['', 'a', 'cake', '🎂 cake', '12', '😊😊😊😊😊😊😊😊😊', ':)']) expect([e, isEmoji(e)]).toEqual([e, false]);
  });

  it('reads and writes the three kinds, and ignores anything malformed', () => {
    const photo = `${USER}/task-pictures/abc-1.jpg`;
    for (const icon of [{ kind: 'emoji', emoji: '🎂' }, { kind: 'clipart', key: 'cake' }, { kind: 'image', path: photo }] as const) {
      expect(parseIcon(formatIcon(icon))).toEqual(icon);
    }
    expect(parseIcon('e:cake')).toBeNull();
    expect(parseIcon('c:unicorn')).toBeNull();
    expect(parseIcon('i:../../etc/passwd')).toBeNull();
    expect(parseIcon(`i:${USER}/other/abc.jpg`)).toBeNull();
    expect(parseIcon(null)).toBeNull();
    expect(formatIcon(null)).toBeNull();
  });

  it('notifications get the emoji, or the clipart emoji; photos have none', () => {
    expect(titleWithEmoji({ title: "Mum's birthday", icon: 'e:🎂' })).toBe("🎂 Mum's birthday");
    expect(titleWithEmoji({ title: 'Gym', icon: 'c:dumbbell' })).toBe('🏋️ Gym');
    expect(titleWithEmoji({ title: 'Passport', icon: `i:${USER}/task-pictures/x.jpg` })).toBe('Passport');
    expect(titleWithEmoji({ title: 'Plain', icon: null })).toBe('Plain');
    expect(emojiOf('c:unicorn')).toBeNull();
  });

  it('every clipart has a name, an emoji and at least one shape', () => {
    expect(CLIPART.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CLIPART.map((c) => c.key)).size).toBe(CLIPART.length);
    for (const c of CLIPART) {
      expect([c.key, isEmoji(c.emoji), c.elements.length > 0, c.label.length > 0]).toEqual([c.key, true, true, true]);
    }
  });

  it("a photo is stored in the account's own folder, under task-pictures", () => {
    const path = picturePath(USER, 'task-1', 'u1', 'JPEG');
    expect(path).toBe(`${USER}/task-pictures/task-1-u1.jpeg`);
    expect(parseIcon(`i:${path}`)).toEqual({ kind: 'image', path });
    expect(picturePath(USER, 't', 'u', '../x')).toBe(`${USER}/task-pictures/t-u.x`);
  });
});
