import { Stack, useSegments } from 'expo-router';
import { Platform, View } from 'react-native';

import { NoticeBar } from '@/components/NoticeBar';
import { QuickAddProvider } from '@/components/QuickAdd';
import { signOut } from '@/platform/auth';
import { DataProvider, useDataState } from '@/state/data';
import { GoogleProvider } from '@/state/google';
import { NowProvider } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space, TAB_BAR_HEIGHT } from '@/ui/tokens';

/**
 * The signed-in app. Opens this account's tasks on the device first; every
 * screen below can then read them synchronously.
 */
export default function SignedInLayout() {
  return (
    <NowProvider>
      <DataProvider>
        <Gate />
      </DataProvider>
    </NowProvider>
  );
}

function Gate() {
  const state = useDataState();
  const { colors } = useTheme();
  const segments = useSegments();
  const onTabs = (segments as string[]).includes('(tabs)');

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="small" color="textSecondary">
          Opening your tasks…
        </Text>
      </View>
    );
  }

  if (state.status === 'error') {
    // On the web the database file can be open in one tab only.
    const otherTab = Platform.OS === 'web' && /access handle/i.test(state.message);
    return (
      <Screen narrow>
        <Text variant="heading" accessibilityRole="header">
          {otherTab ? 'TaskFlow is open in another tab' : 'Your tasks could not be opened'}
        </Text>
        <Text variant="small" color="textSecondary">
          {otherTab
            ? 'Your tasks can be open in one browser tab at a time. Close the other tab, then reload this one.'
            : 'Closing and reopening the app usually fixes this.'}
        </Text>
        {otherTab ? null : (
          <Text variant="caption" color="textSecondary">
            Details: {state.message}
          </Text>
        )}
        <View style={{ gap: space.sm }}>
          {Platform.OS === 'web' ? <Button label="Reload" onPress={() => window.location.reload()} /> : null}
          <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
        </View>
      </Screen>
    );
  }

  return (
    <GoogleProvider>
      <QuickAddProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" />
          <Stack.Screen name="project/[id]" />
          <Stack.Screen name="all-tasks" />
          <Stack.Screen name="completed" />
          <Stack.Screen name="search" />
          <Stack.Screen name="categories" />
          <Stack.Screen name="reminders" />
          <Stack.Screen name="widgets" />
          <Stack.Screen name="google" />
          <Stack.Screen name="colours" />
          <Stack.Screen name="add" />
        </Stack>
        <NoticeBar bottom={onTabs ? TAB_BAR_HEIGHT : 0} right={onTabs ? FAB_SPACE : 0} />
      </QuickAddProvider>
    </GoogleProvider>
  );
}
