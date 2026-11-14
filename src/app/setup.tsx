import { View } from 'react-native';

import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/** Shown instead of the app when the build has no database address or key. */
export default function Setup() {
  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.xs, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Not connected yet
        </Text>
        <Text variant="small" color="textSecondary">
          This build was made without a database address, so there is nothing to sign in to.
        </Text>
      </View>

      <Notice tone="info">
        Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY, then build again. docs/SETUP.md in the repository
        shows where each value comes from.
      </Notice>
    </Screen>
  );
}
