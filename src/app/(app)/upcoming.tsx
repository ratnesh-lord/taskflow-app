import { View } from 'react-native';

import { Divider } from '@/ui/Divider';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

export default function Upcoming() {
  return (
    <Screen>
      <PageHeader title="Upcoming" />
      <Divider />
      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Empty for now</Text>
        <Text variant="small" color="textSecondary">
          Tomorrow, the next 7 and 30 days, and the calendar. This screen is built in the next phase.
        </Text>
      </View>
    </Screen>
  );
}
