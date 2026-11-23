import { Pressable, StyleSheet, View } from 'react-native';

import { COLOR_NAMES, type ColorName } from '@/core/appearance';
import { useTheme } from '@/state/theme';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space, taskColorInk, taskColors, TOUCH } from '@/ui/tokens';

/** A square of a colour, with a tick when chosen. */
export function Swatch({ name, size = 20, chosen }: { name: ColorName; size?: number; chosen?: boolean }) {
  const { scheme } = useTheme();
  return (
    <View style={{ width: size, height: size, backgroundColor: taskColors[name][scheme], alignItems: 'center', justifyContent: 'center' }}>
      {chosen ? <Icon name="check" color={taskColorInk[scheme]} size={Math.round(size * 0.7)} /> : null}
    </View>
  );
}

/** Choose one of the task colours, or none when [allowNone]. */
export function ColorSheet({
  visible, title, value, allowNone, onClose, onPick,
}: {
  visible: boolean;
  title: string;
  value: ColorName | null;
  allowNone?: boolean;
  onClose: () => void;
  onPick: (color: ColorName | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.grid} role="radiogroup" aria-label={title}>
        {COLOR_NAMES.map((name) => (
          <Pressable
            key={name}
            role="radio"
            aria-checked={value === name}
            accessibilityLabel={taskColors[name].label}
            onPress={() => onPick(name)}
            style={[styles.option, { borderColor: value === name ? colors.text : 'transparent' }]}>
            <Swatch name={name} size={36} chosen={value === name} />
            <Text variant="caption" color="textSecondary">
              {taskColors[name].label}
            </Text>
          </Pressable>
        ))}
      </View>
      {allowNone ? (
        <Pressable
          role="radio"
          aria-checked={value === null}
          accessibilityLabel="No colour"
          onPress={() => onPick(null)}
          style={[styles.none, { borderColor: value === null ? colors.text : colors.divider }]}>
          <Text variant="bodyStrong">No colour</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { width: 64, minHeight: TOUCH + 20, alignItems: 'center', gap: 4, paddingVertical: space.xs, borderWidth: 2 },
  none: { minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
