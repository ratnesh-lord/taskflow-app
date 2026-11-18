import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/state/theme';

import { Text } from './Text';
import { space, TOUCH } from './tokens';

export type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** A row of square options where exactly one is selected. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, { borderColor: colors.text }]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            aria-checked={selected}
            onPress={() => onChange(option.value)}
            style={[
              styles.option,
              index > 0 && { borderLeftWidth: 1, borderLeftColor: colors.text },
              selected && { backgroundColor: colors.text },
            ]}>
            <Text variant="smallStrong" color={selected ? 'background' : 'text'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'stretch', borderWidth: 1 },
  // Each option is at least as wide as its label and shares any extra room.
  // (flex: 1 alone starts from zero width, and in a row that does not fix its
  // own width, Android squeezed the whole switch to a line.)
  option: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', minHeight: TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
});
