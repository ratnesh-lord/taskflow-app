import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { pinWidget, type WidgetKind, type WidgetStatus, widgetStatus, widgetsOnDevice } from '@/platform/widgets';
import { useNotice } from '@/state/data';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const WIDGETS: readonly { kind: WidgetKind; name: string; size: string; about: string }[] = [
  { kind: 'today', name: "Today's tasks", size: '4 × 2, can be made taller', about: "Today's open tasks and anything overdue. Tick the box to complete a task; + opens quick add." },
  { kind: 'pending', name: 'Pending', size: '2 × 2', about: 'How many tasks are left today, how many are overdue or high priority, and the next deadline.' },
  { kind: 'productivity', name: 'Productivity', size: '2 × 2', about: "Today's progress, with a bar for each day of this week." },
  { kind: 'next', name: 'Next reminder', size: '4 × 1', about: 'The next reminder and when it goes off.' },
];

/** The four home-screen widgets: what each shows, and a button to add it. */
export default function Widgets() {
  const { colors } = useTheme();
  const { notify } = useNotice();
  const [status, setStatus] = useState<WidgetStatus | null>(null);

  const refresh = useCallback(() => {
    void widgetStatus()?.then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    // Back from the home screen after adding one: show it as added.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Widgets" subtitle="Four TaskFlow widgets for the phone's home screen. They update with the app closed." />

      {!widgetsOnDevice ? (
        <Notice tone="info">Widgets are part of the Android app. Open this page there to add them.</Notice>
      ) : (
        <View>
          {WIDGETS.map((w) => {
            const count = status?.installed[w.kind] ?? 0;
            return (
              <View key={w.kind} style={{ paddingVertical: space.md, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {w.name}
                  </Text>
                  <Text variant="caption" color={count ? 'completed' : 'textSecondary'}>
                    {count ? (count === 1 ? 'On your home screen' : `${count} on your home screen`) : w.size}
                  </Text>
                </View>
                <Text variant="small" color="textSecondary">
                  {w.about}
                </Text>
                {status?.pinSupported ? (
                  <View style={{ alignItems: 'flex-start', paddingTop: space.xs }}>
                    <Button
                      variant="secondary"
                      label={count ? 'Add another' : 'Add to home screen'}
                      onPress={async () => {
                        const asked = await pinWidget(w.kind);
                        if (!asked) notify('This home screen does not accept widgets from apps. Add it from the home screen instead.');
                      }}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
          <Text variant="caption" color="textSecondary" style={{ paddingTop: space.md }}>
            {status?.pinSupported
              ? 'Your phone asks you to confirm and lets you place the widget. '
              : ''}
            You can also touch and hold an empty part of the home screen, tap Widgets, and find TaskFlow. Ticking a task on a widget is saved and synced like ticking it in the app, within a minute or so when the phone is online.
          </Text>
        </View>
      )}
    </Screen>
  );
}
