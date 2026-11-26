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
/** From this window width (a desktop browser, a tablet) the tabs become a sidebar. */
export const SIDEBAR_FROM_WIDTH = 1024;
export const SIDEBAR_WIDTH = 232;

/** Room the floating add button needs at the bottom right. */
export const FAB_SPACE = 88;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export const typography = {
  /** The focus timer's clock. */
  display: { fontFamily: font.semibold, fontSize: 64, lineHeight: 72, letterSpacing: -1, fontVariant: ['tabular-nums'] },
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

/**
 * Home-screen widgets (Android draws them from Kotlin). Text sizes in sp,
 * row height in dp. WidgetTokens.kt in modules/taskflow-alarms holds the same
 * values and the palette above; widget-tokens.test.ts checks they match.
 */
export const widget = {
  label: 11,
  caption: 12,
  row: 13,
  heading: 15,
  time: 20,
  number: 40,
  rowHeight: 44,
} as const;

/** The calendar's hour grid (dp): an hour's height, the time column, an all-day item. */
export const calendarGrid = {
  hourHeight: 48,
  gutter: 44,
  allDayItem: 24,
  /** How wide the calendar may grow in a desktop browser. */
  maxWidth: 1200,
} as const;

/**
 * Colours a person can give tasks (through priorities) and projects. Each has
 * a fill for light and for dark, and the ink that reads on it: white on the
 * darker light-mode fills, near-black on the lighter dark-mode fills (at
 * least 4.5:1 either way; checked in task-colors.test.ts).
 */
export const taskColors = {
  red: { label: 'Red', light: '#DC2626', dark: '#F87171' },
  orange: { label: 'Orange', light: '#C2410C', dark: '#FB923C' },
  amber: { label: 'Amber', light: '#B45309', dark: '#FBBF24' },
  green: { label: 'Green', light: '#15803D', dark: '#4ADE80' },
  teal: { label: 'Teal', light: '#0F766E', dark: '#2DD4BF' },
  cyan: { label: 'Cyan', light: '#0E7490', dark: '#22D3EE' },
  blue: { label: 'Blue', light: '#2563EB', dark: '#60A5FA' },
  indigo: { label: 'Indigo', light: '#4F46E5', dark: '#818CF8' },
  violet: { label: 'Violet', light: '#7C3AED', dark: '#A78BFA' },
  pink: { label: 'Pink', light: '#DB2777', dark: '#F472B6' },
  grey: { label: 'Grey', light: '#4B5563', dark: '#9CA3AF' },
} as const;

/** Ink on a task colour: white in light mode, near-black in dark. */
export const taskColorInk = { light: '#FFFFFF', dark: '#101010' } as const;
