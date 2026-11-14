import { View } from 'react-native';

import { useSession } from '@/state/session';
import { Divider } from '@/ui/Divider';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

function todayLabel(): string {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}

export default function Today() {
  const { user } = useSession();

  return (
    <Screen>
      <PageHeader title="Today" subtitle={todayLabel()} />
      <Divider />
      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Nothing scheduled</Text>
        <Text variant="small" color="textSecondary">
          {user?.email ? `Signed in as ${user.email}. ` : ''}
          Tasks, reminders and the quick-add button arrive with the next build.
        </Text>
      </View>
    </Screen>
  );
}
