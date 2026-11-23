import { COLOR_NAMES } from '@/core/appearance';

import { palette, taskColorInk, taskColors } from './tokens';

/** WCAG contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('task colours', () => {
  it('every colour name the app knows has a colour, and no more', () => {
    expect(Object.keys(taskColors).sort()).toEqual([...COLOR_NAMES].sort());
  });

  for (const [name, c] of Object.entries(taskColors)) {
    it(`${name}: text on it reads (4.5:1) and it stands out from the page (3:1), in light and dark`, () => {
      expect(contrast(c.light, taskColorInk.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.dark, taskColorInk.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.light, palette.light.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.dark, palette.dark.background)).toBeGreaterThanOrEqual(3);
    });
  }
});
