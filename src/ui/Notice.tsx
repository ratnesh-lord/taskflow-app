import { View } from 'react-native';

import { useTheme } from '@/state/theme';

import { Text } from './Text';
import { space } from './tokens';

/** A short message with a coloured bar: red for a problem, accent for information. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: string }) {
  const { colors } = useTheme();
  const bar = tone === 'error' ? colors.overdue : tone === 'success' ? colors.completed : colors.accent;
  return (
    <View
      accessible
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={{ flexDirection: 'row', gap: space.md, alignItems: 'stretch' }}>
      <View style={{ width: 3, backgroundColor: bar }} />
      <Text variant="small" style={{ flex: 1, paddingVertical: space.xs }}>
        {children}
      </Text>
    </View>
  );
}
