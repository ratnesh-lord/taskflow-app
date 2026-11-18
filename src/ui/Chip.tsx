import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/state/theme';

import { Icon } from './Icon';
import { Text } from './Text';
import { space } from './tokens';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Shows a small cross: tapping removes. */
  removable?: boolean;
  accessibilityLabel?: string;
};

/** A square label: outlined, or filled when selected. */
export function Chip({ label, selected, onPress, removable, accessibilityLabel }: ChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? (removable ? 'button' : 'checkbox') : 'text'}
      aria-checked={onPress && !removable ? !!selected : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? colors.text : colors.divider, backgroundColor: selected ? colors.text : 'transparent' },
      ]}>
      <Text variant="smallStrong" color={selected ? 'background' : 'text'}>
        {label}
      </Text>
      {removable ? <Icon name="close" color={selected ? colors.background : colors.textSecondary} size={14} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
