/**
 * Design tokens. Everything visual in the app comes from this file.
 *
 * One rule has no token because it has no value: corners are square.
 * `borderRadius` is banned by the lint configuration (eslint.config.js).
 */

export const palette = {
  light: {
    background: '#FFFFFF',
    text: '#111111',
    textSecondary: '#777777',
    divider: '#E5E5E5',
    accent: '#2563EB',
    onAccent: '#FFFFFF',
    overdue: '#DC2626',
    completed: '#16A34A',
  },
  dark: {
    background: '#101010',
    text: '#F5F5F5',
    textSecondary: '#999999',
    divider: '#292929',
    accent: '#60A5FA',
    onAccent: '#101010',
    overdue: '#F87171',
    completed: '#4ADE80',
  },
} as const;

export type Scheme = keyof typeof palette;
export type Colors = { readonly [K in keyof (typeof palette)['light']]: string };
export type ColorName = keyof Colors;

/** 4-point spacing grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Smallest comfortable touch target, in density-independent pixels. */
export const TOUCH = 48;

/** Height of the app's own tab bar, above the system navigation inset. */
export const TAB_BAR_HEIGHT = 62;

/** Room the floating add button needs at the bottom right. */
export const FAB_SPACE = 88;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const typography = {
  title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 32, letterSpacing: -0.3 },
  heading: { fontFamily: font.semibold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: font.medium, fontSize: 16, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: font.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
} as const;

export type TextVariant = keyof typeof typography;

/** Content never grows wider than this on a desktop browser. */
export const MAX_CONTENT_WIDTH = 720;
