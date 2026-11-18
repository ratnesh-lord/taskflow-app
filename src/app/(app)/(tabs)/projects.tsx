import { View } from 'react-native';

import { Divider } from '@/ui/Divider';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

export default function Projects() {
  return (
    <Screen>
      <PageHeader title="Projects" />
      <Divider />
      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Empty for now</Text>
        <Text variant="small" color="textSecondary">
          Each project with its own tasks, deadline and progress. This screen is built in the next phase.
        </Text>
      </View>
    </Screen>
  );
}
