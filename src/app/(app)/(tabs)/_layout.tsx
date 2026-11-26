import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/state/theme';
import { Icon, type IconName } from '@/ui/Icon';
import { useSidebar } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { SIDEBAR_WIDTH, space, TAB_BAR_HEIGHT } from '@/ui/tokens';

/**
 * The signed-in app: five tabs with a square tab bar drawn by the app itself
 * (the system tab bar has a rounded selection pill). On a wide window the same
 * tabs form a sidebar on the left, nearer the content than a bar along the
 * bottom of a large screen.
 */
export default function AppLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const sidebar = useSidebar();

  return (
    <Tabs style={{ flex: 1, flexDirection: sidebar ? 'row-reverse' : 'column' }}>
      {/* flex and minHeight keep a long list inside the screen, so the tab bar stays on screen. */}
      <TabSlot style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
      <TabList
        style={
          sidebar
            ? [styles.side, { backgroundColor: colors.background, borderRightColor: colors.divider, paddingTop: insets.top + space.lg }]
            : [styles.bar, { backgroundColor: colors.background, borderTopColor: colors.divider, paddingBottom: insets.bottom }]
        }>
        {sidebar ? (
          <Text variant="heading" accessibilityRole="header" style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
            TaskFlow
          </Text>
        ) : null}
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
  const sidebar = useSidebar();
  const tint = isFocused ? colors.text : colors.textSecondary;
  if (sidebar) {
    return (
      <Pressable
        {...pressable}
        accessibilityRole="tab"
        aria-selected={!!isFocused}
        style={({ pressed }) => [styles.sideTab, { backgroundColor: isFocused ? colors.divider : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.sideMarker, { backgroundColor: isFocused ? colors.accent : 'transparent' }]} />
        <Icon name={icon} color={tint} size={20} />
        <Text variant={isFocused ? 'bodyStrong' : 'body'} style={{ color: tint }}>
          {label}
        </Text>
      </Pressable>
    );
  }
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
  side: { width: SIDEBAR_WIDTH, flexDirection: 'column', justifyContent: 'flex-start', borderRightWidth: 1, paddingHorizontal: space.sm, gap: 2 },
  sideTab: { height: 44, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md },
  sideMarker: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
});
