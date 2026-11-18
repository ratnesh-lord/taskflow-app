import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/state/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { TAB_BAR_HEIGHT } from '@/ui/tokens';

/**
 * The signed-in app: five tabs with a square tab bar drawn by the app itself
 * (the system tab bar has a rounded selection pill).
 */
export default function AppLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs>
      {/* flex and minHeight keep a long list inside the screen, so the tab bar stays on screen. */}
      <TabSlot style={{ flex: 1, minHeight: 0 }} />
      <TabList
        style={[
          styles.bar,
          { backgroundColor: colors.background, borderTopColor: colors.divider, paddingBottom: insets.bottom },
        ]}>
        <TabTrigger name="today" href="/" asChild>
          <TabButton icon="today" label="Today" />
        </TabTrigger>
        <TabTrigger name="inbox" href="/inbox" asChild>
          <TabButton icon="inbox" label="Inbox" />
        </TabTrigger>
        <TabTrigger name="upcoming" href="/upcoming" asChild>
          <TabButton icon="upcoming" label="Upcoming" />
        </TabTrigger>
        <TabTrigger name="projects" href="/projects" asChild>
          <TabButton icon="projects" label="Projects" />
        </TabTrigger>
        <TabTrigger name="more" href="/more" asChild>
          <TabButton icon="more" label="More" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: IconName; label: string };

function TabButton({ icon, label, isFocused, style: _style, children: _children, ref: _ref, ...pressable }: TabButtonProps) {
  const { colors } = useTheme();
  const tint = isFocused ? colors.text : colors.textSecondary;
  return (
    <Pressable
      {...pressable}
      accessibilityRole="tab"
      aria-selected={!!isFocused}
      style={styles.tab}>
      <View style={[styles.marker, { backgroundColor: isFocused ? colors.accent : 'transparent' }]} />
      <Icon name={icon} color={tint} size={20} />
      <Text variant="caption" style={{ color: tint, fontSize: 11, lineHeight: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, height: TAB_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 4 },
  marker: { position: 'absolute', top: -1, left: 0, right: 0, height: 2 },
});
