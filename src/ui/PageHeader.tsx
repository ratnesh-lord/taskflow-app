import { View } from 'react-native';

import { Text } from './Text';
import { space } from './tokens';

/** The large title at the top of a main screen, with an optional line under it. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="small" color="textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
