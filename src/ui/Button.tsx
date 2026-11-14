import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/state/theme';

import { Text } from './Text';
import { space, TOUCH } from './tokens';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  /** primary: filled accent. secondary: outlined. quiet: text only. */
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  /** Shown in place of the label while work is in progress, e.g. "Signing in…". */
  busyLabel?: string;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', disabled, busy, busyLabel, style }: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || busy;

  const surface: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: colors.accent }
      : variant === 'secondary'
        ? { borderWidth: 1, borderColor: colors.text }
        : {};

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        surface,
        pressed && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}>
      <Text variant="bodyStrong" color={variant === 'primary' ? 'onAccent' : variant === 'quiet' ? 'accent' : 'text'}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.45 },
});
