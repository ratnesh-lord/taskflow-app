import { View } from 'react-native';

import { Divider } from '@/ui/Divider';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

export default function Inbox() {
  return (
    <Screen>
      <PageHeader title="Inbox" />
      <Divider />
      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Empty for now</Text>
        <Text variant="small" color="textSecondary">
          A place to capture tasks before they have a project or a date. This screen is built in the next phase.
        </Text>
      </View>
    </Screen>
  );
}
