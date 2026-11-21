/**
 * The Android widgets cannot read tokens.ts, so WidgetTokens.kt holds a copy.
 * This test keeps the copy exact.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { palette, widget } from './tokens';

const kotlin = readFileSync(
  join(__dirname, '../../modules/taskflow-alarms/android/src/main/java/com/ratnesh/taskflow/alarms/WidgetTokens.kt'),
  'utf8',
);

function block(name: string): string {
  const start = kotlin.indexOf(`val ${name} = WidgetPalette(`);
  expect(start).toBeGreaterThan(-1);
  return kotlin.slice(start, kotlin.indexOf(')\n', start));
}

describe('widget tokens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`the ${scheme} palette matches tokens.ts`, () => {
      const text = block(scheme);
      const found = Object.fromEntries([...text.matchAll(/(\w+) = 0xFF([0-9A-F]{6})/g)].map((m) => [m[1], `#${m[2]}`]));
      expect(found).toEqual(palette[scheme]);
    });
  }

  it('the sizes match tokens.ts', () => {
    const names: Record<keyof typeof widget, string> = {
      label: 'LABEL', caption: 'CAPTION', row: 'ROW', heading: 'HEADING', time: 'TIME', number: 'NUMBER', rowHeight: 'ROW_HEIGHT',
    };
    for (const [key, constName] of Object.entries(names)) {
      const m = kotlin.match(new RegExp(`const val ${constName} = (\\d+)f?\\b`));
      expect([key, Number(m?.[1])]).toEqual([key, widget[key as keyof typeof widget]]);
    }
  });
});
