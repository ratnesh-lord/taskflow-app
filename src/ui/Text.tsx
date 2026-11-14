import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { useTheme } from '@/state/theme';

import { type ColorName, type TextVariant, typography } from './tokens';

export type TextProps = NativeTextProps & {
  variant?: TextVariant;
  color?: ColorName;
};

/** All text in the app goes through here, so type and colour stay on the tokens. */
export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return <NativeText {...rest} style={[typography[variant], { color: colors[color] }, style]} />;
}
