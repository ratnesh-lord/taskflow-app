import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from './Text';
import { space } from './tokens';

/** The large title at the top of a main screen, with an optional line under it and buttons beside it. */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', marginRight: -space.md, marginTop: -space.sm }}>{right}</View> : null}
    </View>
  );
}
