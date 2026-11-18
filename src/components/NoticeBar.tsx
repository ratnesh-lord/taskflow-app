import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useData, useNotice, useRun } from '@/state/data';
import { useTheme } from '@/state/theme';
import { Text } from '@/ui/Text';
import { MAX_CONTENT_WIDTH, space, TOUCH } from '@/ui/tokens';

/** A short message above the tab bar, with Undo when the action can be reversed. */
export function NoticeBar({ bottom, right = 0 }: { bottom: number; right?: number }) {
  const { colors } = useTheme();
  const { notice, dismiss } = useNotice();
  const { actions } = useData();
  const run = useRun();
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  const undo = notice.undo;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: bottom + insets.bottom + space.sm, paddingRight: space.md + right }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.bar, { backgroundColor: notice.tone === 'error' ? colors.overdue : colors.text }]}>
        <Text variant="small" numberOfLines={2} style={{ color: colors.background, flex: 1 }}>
          {notice.message}
        </Text>
        {undo ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              dismiss();
              void run(() => actions.undo(undo), 'Undone');
            }}
            style={styles.action}>
            <Text variant="smallStrong" style={{ color: colors.background, textDecorationLine: 'underline' }}>
              Undo
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md },
  bar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    gap: space.sm,
  },
  action: { minHeight: TOUCH, paddingHorizontal: space.lg, justifyContent: 'center' },
});
