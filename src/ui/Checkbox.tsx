import { Pressable, View } from 'react-native';

import { useTheme } from '@/state/theme';

import { Icon } from './Icon';
import { TOUCH } from './tokens';

export type CheckboxProps = {
  checked: boolean;
  onPress: () => void;
  label: string;
  size?: number;
  /** Red outline, for an overdue task. */
  alert?: boolean;
  /** Shown but not changeable (a group task someone else has). */
  disabled?: boolean;
};

/** A square box: outlined when open, filled green with a tick when done. */
export function Checkbox({ checked, onPress, label, size = 20, alert, disabled }: CheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      accessibilityLabel={label}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={4}
      style={{ width: TOUCH - 4, height: TOUCH - 4, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      {checked ? (
        <View style={{ width: size, height: size, backgroundColor: colors.completed, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" color={colors.background} size={size - 6} />
        </View>
      ) : (
        <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: alert ? colors.overdue : colors.text }} />
      )}
    </Pressable>
  );
}
