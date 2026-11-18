import { Stack, useSegments } from 'expo-router';
import { View } from 'react-native';

import { NoticeBar } from '@/components/NoticeBar';
import { QuickAddProvider } from '@/components/QuickAdd';
import { signOut } from '@/platform/auth';
import { DataProvider, useDataState } from '@/state/data';
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
    return (
      <Screen narrow>
        <Text variant="heading" accessibilityRole="header">
          Your tasks could not be opened
        </Text>
        <Text variant="small" color="textSecondary">
          The database on this device reported: {state.message}
        </Text>
        <Text variant="small" color="textSecondary">
          Closing and reopening the app usually fixes this. On the web, it needs a recent Chrome, Edge or Firefox, and only one tab of TaskFlow at a time.
        </Text>
        <View style={{ gap: space.sm }}>
          <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
        </View>
      </Screen>
    );
  }

  return (
    <QuickAddProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="project/[id]" />
        <Stack.Screen name="all-tasks" />
        <Stack.Screen name="completed" />
        <Stack.Screen name="search" />
        <Stack.Screen name="categories" />
      </Stack>
      <NoticeBar bottom={onTabs ? TAB_BAR_HEIGHT : 0} right={onTabs ? FAB_SPACE : 0} />
    </QuickAddProvider>
  );
}
