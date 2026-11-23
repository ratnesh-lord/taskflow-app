/**
 * How a task looks: its colour and its picture.
 *
 * Colour. Each priority has a colour, and each project can have one; the
 * person chooses both, from a fixed set of colours that read well in light
 * and dark (src/ui/tokens.ts, taskColors). A setting says which one a task's
 * colour bar follows: its priority (the default), its project, or neither.
 *
 * Picture. A task can carry one picture, or none: an emoji, a clipart
 * drawing, or a photo. It is stored in the task's `icon` column as text:
 *
 *   e:🎂                 an emoji
 *   c:cake               clipart, by key (src/core/clipart.ts)
 *   i:<storage path>     a photo in the account's private Storage folder
 *
 * Where only text fits (notification titles, widgets, Google Calendar), an
 * emoji, or the clipart's emoji, goes before the title. A photo shows only
 * in the app.
 */
import { CLIPART_BY_KEY } from './clipart';
import type { Priority } from './types';

export const COLOR_NAMES = ['red', 'orange', 'amber', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink', 'grey'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export function isColorName(v: unknown): v is ColorName {
  return typeof v === 'string' && (COLOR_NAMES as readonly string[]).includes(v);
}

export type ColorBy = 'priority' | 'project' | 'none';

export type ColorSettings = { by: ColorBy; priority: Record<Priority, ColorName> };

export const DEFAULT_COLORS: ColorSettings = {
  by: 'priority',
  priority: { critical: 'red', high: 'orange', medium: 'blue', low: 'grey' },
};

/** The account's colour settings (profiles.settings.colors), filling in defaults for anything missing or unknown. */
export function readColorSettings(settings: unknown): ColorSettings {
  const c = (settings as { colors?: { by?: unknown; priority?: Record<string, unknown> } } | null)?.colors;
  if (!c || typeof c !== 'object') return DEFAULT_COLORS;
  const by: ColorBy = c.by === 'project' || c.by === 'none' || c.by === 'priority' ? c.by : DEFAULT_COLORS.by;
  const p = c.priority && typeof c.priority === 'object' ? c.priority : {};
  const pick = (k: Priority) => (isColorName(p[k]) ? p[k] : DEFAULT_COLORS.priority[k]);
  return { by, priority: { critical: pick('critical'), high: pick('high'), medium: pick('medium'), low: pick('low') } };
}

/** The colour a task shows, or null for none. A project without a colour gives none. */
export function taskColor(task: { priority: Priority; projectId: string | null }, projectColors: ReadonlyMap<string, string | null>, settings: ColorSettings): ColorName | null {
  if (settings.by === 'none') return null;
  if (settings.by === 'priority') return settings.priority[task.priority];
  const c = task.projectId ? projectColors.get(task.projectId) : null;
  return isColorName(c) ? c : null;
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

export type TaskIcon = { kind: 'emoji'; emoji: string } | { kind: 'clipart'; key: string } | { kind: 'image'; path: string };

/** Longest emoji kept: a family or flag sequence fits easily. */
const MAX_EMOJI = 16;

/** Code points that draw as emoji (pictographs, symbols, flags). */
function isPictograph(cp: number): boolean {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2300 && cp <= 0x23ff)
    || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x25a0 && cp <= 0x25ff)
    || cp === 0x2934 || cp === 0x2935 || cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299
    || cp === 0x00a9 || cp === 0x00ae || cp === 0x2122 || cp === 0x2139 || cp === 0x203c || cp === 0x2049
  );
}

/** Joiners, variation selectors, skin tones, keycaps and flag tags that only modify an emoji. */
function isModifier(cp: number): boolean {
  return cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f);
}

/**
 * Whether text is one emoji (or a short emoji sequence), not words. Checked
 * by code point, without regular-expression Unicode classes, which not every
 * JavaScript engine on phones supports.
 */
export function isEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_EMOJI) return false;
  const cps = Array.from(t, (c) => c.codePointAt(0)!);
  if (!cps.some(isPictograph)) {
    // A keycap such as 1️⃣: a digit, # or *, then U+FE0F U+20E3.
    return /^[0-9#*]\uFE0F?\u20E3$/.test(t);
  }
  return cps.every((cp) => isPictograph(cp) || isModifier(cp) || /^[0-9#*]$/.test(String.fromCodePoint(cp)));
}

export function parseIcon(value: string | null | undefined): TaskIcon | null {
  if (!value) return null;
  const kind = value.slice(0, 2);
  const rest = value.slice(2);
  if (kind === 'e:' && isEmoji(rest)) return { kind: 'emoji', emoji: rest.trim() };
  if (kind === 'c:' && CLIPART_BY_KEY.has(rest)) return { kind: 'clipart', key: rest };
  if (kind === 'i:' && /^[0-9a-f-]{36}\/task-pictures\/[\w.-]{1,200}$/i.test(rest)) return { kind: 'image', path: rest };
  return null;
}

export function formatIcon(icon: TaskIcon | null): string | null {
  if (!icon) return null;
  switch (icon.kind) {
    case 'emoji':
      return `e:${icon.emoji}`;
    case 'clipart':
      return `c:${icon.key}`;
    case 'image':
      return `i:${icon.path}`;
  }
}

/** The emoji that stands for a picture where only text fits, or null (photos have none). */
export function emojiOf(value: string | null | undefined): string | null {
  const icon = parseIcon(value);
  if (!icon) return null;
  if (icon.kind === 'emoji') return icon.emoji;
  if (icon.kind === 'clipart') return CLIPART_BY_KEY.get(icon.key)?.emoji ?? null;
  return null;
}

/** "🎂 Mum's birthday" when the task has an emoji or clipart; the title alone otherwise. */
export function titleWithEmoji(task: { title: string; icon?: string | null }): string {
  const e = emojiOf(task.icon);
  return e ? `${e} ${task.title}` : task.title;
}

/** Where a task's photo is stored: the account's folder (Storage rules allow only that), then task-pictures. */
export function picturePath(userId: string, taskId: string, unique: string, extension: string): string {
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'jpg';
  return `${userId}/task-pictures/${taskId}-${unique}.${ext}`;
}

/** Emoji offered first in the picker. Any other emoji can be typed. */
export const SUGGESTED_EMOJI = [
  '⭐', '🔥', '✅', '❗', '💡', '📌', '🎯', '🏆',
  '🏠', '💼', '🛒', '💰', '🧾', '🏦', '📞', '✉️',
  '💻', '📄', '📚', '🎓', '🏋️', '🏃', '🚴', '🧘',
  '💊', '🩺', '🦷', '❤️', '🍽️', '☕', '🍎', '🥗',
  '🎂', '🎁', '🎉', '👶', '🐶', '🐱', '🌱', '🧹',
  '🧺', '🔧', '🚗', '✈️', '🧳', '🏖️', '🎵', '🎮',
  '📷', '📺', '🙏', '😊', '😴', '🌙', '☀️', '💧',
] as const;
