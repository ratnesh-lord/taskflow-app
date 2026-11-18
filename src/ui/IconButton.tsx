import { Pressable } from 'react-native';

import { useTheme } from '@/state/theme';

import { Icon, type IconName } from './Icon';
import type { ColorName } from './tokens';
import { TOUCH } from './tokens';

export function IconButton({
  icon, label, onPress, color = 'text', disabled,
}: { icon: IconName; label: string; onPress: () => void; color?: ColorName; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      <Icon name={icon} color={colors[color]} />
    </Pressable>
  );
}
