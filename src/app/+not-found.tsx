import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.lg, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Nothing here
        </Text>
        <Text variant="small" color="textSecondary">
          That address does not match a screen.
        </Text>
        <Button label="Go to Today" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
