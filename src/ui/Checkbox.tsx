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
};

/** A square box: outlined when open, filled green with a tick when done. */
export function Checkbox({ checked, onPress, label, size = 20, alert }: CheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={{ width: TOUCH - 4, height: TOUCH - 4, alignItems: 'center', justifyContent: 'center' }}>
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
