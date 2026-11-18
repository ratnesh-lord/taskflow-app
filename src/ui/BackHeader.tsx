import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { IconButton } from './IconButton';
import { Text } from './Text';
import { space } from './tokens';

/** Back button and a small title, for screens opened from a list. */
export function BackHeader({ title, right }: { title?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -space.md, marginTop: -space.sm, gap: space.xs }}>
      <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Text variant="label" color="textSecondary" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {title ?? ''}
      </Text>
      {right}
    </View>
  );
}
