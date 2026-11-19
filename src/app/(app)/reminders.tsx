import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { DEFAULT_SUMMARIES, readSummarySettings, type SummarySettings } from '@/core/alarms';
import { localDateOf, minutesToTime } from '@/core/dates';
import { OptionSheet } from '@/components/OptionSheet';
import {
  alarmStatus, askNotificationPermission, openAlarmSettings, remindersOnDevice, sendTestReminder, type AlarmStatus,
} from '@/platform/reminders';
import { useSession } from '@/state/session';
import { useData, useNotice, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { dayLabelOrTime, plural, showTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { FieldRow } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const OFF = 'off';
const times = (from: number, to: number) =>
  Array.from({ length: (to - from) * 2 + 1 }, (_, i) => minutesToTime(from * 60 + i * 30));
const MORNING_TIMES = times(5, 11);
const EVENING_TIMES = times(17, 23);

/** Whether reminders can reach you on this phone, the daily summaries, and a test button. */
export default function Reminders() {
  const { data, actions } = useData();
  const { user } = useSession();
  const { now } = useNow();
  const { notify } = useNotice();
  const run = useRun();
  const [status, setStatus] = useState<AlarmStatus | null>(null);
  const [sheet, setSheet] = useState<'morning' | 'evening' | null>(null);
  const summaries = readSummarySettings(data.profile?.settings ?? {});

  const refresh = useCallback(() => {
    void alarmStatus()?.then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    // Coming back from Android settings: show the new state.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    const timer = setInterval(refresh, 5000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh, data]);

  const save = (next: SummarySettings) => {
    if (!user) return;
    void run(() => actions.setSummaries(user.id, next), 'Saved');
  };

  const when = (ms: number) => {
    const d = new Date(ms);
    return dayLabelOrTime(localDateOf(d), minutesToTime(d.getHours() * 60 + d.getMinutes()), now.date);
  };

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Reminders" subtitle="Reminders and daily summaries arrive as phone notifications, even with the app closed and offline." />

      {!remindersOnDevice ? (
        <Notice tone="info">
          In a browser, reminders are saved and synced to your phone, and the TaskFlow app on the phone shows them. Open this page there to check its settings.
        </Notice>
      ) : status ? (
        <View>
          <StatusRow
            ok={status.notifications}
            label="Notifications"
            value={status.notifications ? 'Allowed' : 'Off: nothing will show'}
            action={status.notifications ? undefined : 'Allow'}
            onAction={async () => {
              const granted = await askNotificationPermission();
              if (!granted) openAlarmSettings('notifications');
              refresh();
            }}
          />
          <StatusRow
            ok={status.exactAlarms}
            label="On-time alarms"
            value={status.exactAlarms ? 'Allowed' : 'Off: reminders may come a few minutes late'}
            action={status.exactAlarms ? undefined : 'Allow'}
            onAction={() => openAlarmSettings('exactAlarms')}
          />
          <StatusRow
            ok={status.batteryUnrestricted}
            label="Battery"
            value={status.batteryUnrestricted ? 'Not restricted' : 'Optimised: the phone may hold reminders back'}
            action={status.batteryUnrestricted ? undefined : 'Change'}
            onAction={() => openAlarmSettings('battery')}
          />
          <StatusRow
            ok
            label="Planned"
            value={
              status.planned
                ? `${plural(status.planned, 'notification')} in the next 30 days${status.next ? `; next ${when(status.next)}` : ''}`
                : 'Nothing planned'
            }
          />
          {!status.batteryUnrestricted ? (
            <Text variant="caption" color="textSecondary" style={{ paddingTop: space.sm }}>
              If Change does nothing on your phone: open Settings, then Apps, TaskFlow, App battery usage, and choose Unrestricted.
              {status.manufacturer.toLowerCase().includes('nothing') ? ' On a Nothing phone this is under Settings, Apps, TaskFlow, Battery.' : ''}
            </Text>
          ) : null}
          <View style={{ alignItems: 'flex-start', paddingTop: space.lg }}>
            <Button
              variant="secondary"
              label="Send a test reminder in 10 seconds"
              onPress={async () => {
                await sendTestReminder(10);
                notify('A test reminder arrives in 10 seconds. You can close the app to try it.');
              }}
            />
          </View>
        </View>
      ) : (
        <Text variant="small" color="textSecondary">
          Checking…
        </Text>
      )}

      <View>
        <Text variant="label" color="textSecondary" style={{ paddingBottom: space.xs }}>
          Daily summaries
        </Text>
        <FieldRow
          label="Morning plan"
          value={summaries.morning ? showTime(summaries.morning) : 'Off'}
          onPress={() => setSheet('morning')}
        />
        <FieldRow
          label="Evening check"
          value={summaries.evening ? showTime(summaries.evening) : 'Off'}
          onPress={() => setSheet('evening')}
          last
        />
        <Text variant="caption" color="textSecondary" style={{ paddingTop: space.sm }}>
          The morning plan lists what is due today and anything overdue. The evening check lists today&apos;s tasks still open, and is skipped when there are none. These times apply on every device signed in to your account.
        </Text>
        {!data.profile ? (
          <Text variant="caption" color="overdue">
            Your profile has not arrived from your account yet, so these cannot be changed until the next sync.
          </Text>
        ) : null}
      </View>

      <OptionSheet<string>
        visible={sheet !== null}
        title={sheet === 'morning' ? 'Morning plan' : 'Evening check'}
        value={(sheet === 'morning' ? summaries.morning : summaries.evening) ?? OFF}
        options={[
          { value: OFF, label: 'Off' },
          ...(sheet === 'morning' ? MORNING_TIMES : EVENING_TIMES).map((t) => ({
            value: t,
            label: showTime(t),
            detail: t === (sheet === 'morning' ? DEFAULT_SUMMARIES.morning : DEFAULT_SUMMARIES.evening) ? 'Default' : undefined,
          })),
        ]}
        onClose={() => setSheet(null)}
        onPick={(value) => {
          const which = sheet;
          setSheet(null);
          const time = value === OFF ? null : value;
          save(which === 'morning' ? { ...summaries, morning: time } : { ...summaries, evening: time });
        }}
      />
    </Screen>
  );
}

function StatusRow({ ok, label, value, action, onAction }: { ok: boolean; label: string; value: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <Icon name={ok ? 'check' : 'close'} color={ok ? colors.completed : colors.overdue} size={18} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="smallStrong">{label}</Text>
        <Text variant="caption" color={ok ? 'textSecondary' : 'overdue'}>
          {value}
        </Text>
      </View>
      {action && onAction ? <Button variant="secondary" label={action} onPress={onAction} /> : null}
    </View>
  );
}
