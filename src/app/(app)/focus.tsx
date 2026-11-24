import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { titleWithEmoji } from '@/core/appearance';
import { localDateOf } from '@/core/dates';
import {
  BREAK_MINUTES, clock, DEFAULT_FOCUS, finishedOnTime, finishedToday, FOCUS_MINUTES, focusTotals, isRunning, minutesWords, nextBreakMinutes,
  plannedEndMs, remainingMs, runningSession, spentMinutes,
} from '@/core/focus';
import { SmallButton } from '@/components/ActionRow';
import { Meter } from '@/components/BarChart';
import { TaskPickerSheet } from '@/components/TaskPickerSheet';
import { useData, useRun } from '@/state/data';
import { useTheme } from '@/state/theme';
import { getDeviceId } from '@/platform/device';
import { focusAlertKind, prepareFocusAlert, scheduleFocusAlert } from '@/platform/focus-alert';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural, showTime } from '@/ui/format';
import { FieldRow, SectionTitle } from '@/ui/Row';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const toLocal = (iso: string) => localDateOf(new Date(iso));
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The current time, every second while the screen is open. */
function useTicker(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

/**
 * More → Focus timer: timed focus sessions on one task, with breaks. The end
 * rings on the Android phone that started it, even with the app closed.
 */
export default function Focus() {
  const { task: taskParam } = useLocalSearchParams<{ task?: string }>();
  const { data, actions } = useData();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const [taskId, setTaskId] = useState<string | null>(typeof taskParam === 'string' ? taskParam : null);
  const [minutes, setMinutes] = useState(String(DEFAULT_FOCUS));
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);

  const nowMs = useTicker();
  const running = runningSession(data.focusSessions, nowMs);
  const today = localDateOf(new Date(nowMs));
  const finished = finishedToday(data.focusSessions, today, nowMs, toLocal);
  const totals = focusTotals(data.focusSessions, today, today, nowMs, toLocal);
  const todays = data.focusSessions.filter((s) => toLocal(s.startedAt) === today);
  const last = data.focusSessions[0];
  const justEnded = !running && last && !isRunning(last, nowMs) && nowMs - plannedEndMs(last) < 15 * 60_000 && !last.endedAt;

  const taskTitle = (id: string | null) => {
    const t = id ? data.tasks.find((x) => x.id === id) : undefined;
    return t ? titleWithEmoji(t) : null;
  };
  const chosen = taskTitle(taskId);
  const runningEnd = running ? plannedEndMs(running) : null;
  const runningKind = running?.kind;
  const runningTask = running ? taskTitle(running.taskId) : null;

  // In a browser, the open page shows a notification at the end.
  useEffect(() => {
    if (focusAlertKind !== 'browser' || runningEnd == null) return;
    return scheduleFocusAlert(
      runningEnd,
      runningKind === 'break' ? 'Break over' : 'Focus session done',
      runningKind === 'break' ? 'Ready for the next session?' : runningTask ? `${runningTask}. Time for a break.` : 'Time for a break.',
    );
  }, [runningEnd, runningKind, runningTask]);

  async function start(kind: 'focus' | 'break', length: number, forTask: string | null) {
    setStarting(true);
    await prepareFocusAlert();
    const deviceId = await getDeviceId();
    await run(() => actions.startFocus({ kind, minutes: length, taskId: forTask, deviceId }));
    setStarting(false);
  }

  const breakLength = nextBreakMinutes(finished);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Focus timer" subtitle={totals.sessions ? `Today: ${minutesWords(totals.minutes)} · ${plural(finished, 'session')} finished` : 'Work on one thing at a time, then take a break.'} />

      {running ? (
        <View style={{ gap: space.md, paddingVertical: space.lg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider }}>
          <Text variant="label" color={running.kind === 'break' ? 'completed' : 'accent'}>
            {running.kind === 'break' ? 'Break' : 'Focus'}
          </Text>
          <Text variant="display" accessibilityRole="timer" accessibilityLabel={`${clock(remainingMs(running, nowMs))} left`}>
            {clock(remainingMs(running, nowMs))}
          </Text>
          <Meter
            percent={100 - (remainingMs(running, nowMs) / (running.plannedMinutes * 60_000)) * 100}
            color={running.kind === 'break' ? colors.completed : colors.accent}
            label="Time passed"
          />
          <Text variant="body">{runningTask ?? (running.kind === 'break' ? 'Step away from the screen.' : 'No task chosen')}</Text>
          <Text variant="small" color="textSecondary">
            {`Ends at ${showTime(hhmm(new Date(plannedEndMs(running)).toISOString()))}. ${
              focusAlertKind === 'alarm' ? 'Your phone rings at the end, even if you close the app.' : 'Keep this tab open: it shows a notification at the end if you allow it.'
            }`}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button variant="secondary" label={running.kind === 'break' ? 'End break' : 'Stop'} onPress={() => void run(() => actions.stopFocus(running.id), running.kind === 'break' ? 'Break ended' : 'Session stopped')} />
            {running.taskId ? <Button variant="quiet" label="Open task" onPress={() => router.push(`/task/${running.taskId}`)} /> : null}
          </View>
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {justEnded ? (
            <View style={{ gap: space.sm, paddingVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider }}>
              <Text variant="heading">{last.kind === 'focus' ? 'Session done' : 'Break over'}</Text>
              <Text variant="small" color="textSecondary">
                {last.kind === 'focus' ? `${minutesWords(last.plannedMinutes)} of focus${taskTitle(last.taskId) ? ` on ${taskTitle(last.taskId)}` : ''}. Take a ${breakLength}-minute break.` : 'Ready for the next one?'}
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                {last.kind === 'focus' ? (
                  <Button label={`Start ${breakLength}-minute break`} busy={starting} busyLabel="Starting…" onPress={() => void start('break', breakLength, null)} />
                ) : (
                  <Button label={`Focus ${minutes} min again`} busy={starting} busyLabel="Starting…" onPress={() => void start('focus', Number(minutes), taskId)} />
                )}
              </View>
            </View>
          ) : null}

          <View>
            <FieldRow label="Task" value={chosen} placeholder="None (optional)" onPress={() => setPicking(true)} last />
          </View>
          <View style={{ gap: space.xs }}>
            <Text variant="caption" color="textSecondary">
              Length in minutes
            </Text>
            <Segmented label="Length in minutes" value={minutes} options={FOCUS_MINUTES.map((m) => ({ value: String(m), label: `${m}` }))} onChange={setMinutes} />
          </View>
          <Button label={`Start ${minutes}-minute focus`} busy={starting} busyLabel="Starting…" onPress={() => void start('focus', Number(minutes), taskId)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <Text variant="small" color="textSecondary">
              Or a break:
            </Text>
            {BREAK_MINUTES.map((m) => (
              <SmallButton key={m} label={`${m} min`} accessibilityLabel={`Start a ${m}-minute break`} onPress={() => void start('break', m, null)} />
            ))}
          </View>
          <Text variant="caption" color="textSecondary">
            {`A long break after every fourth session. ${
              focusAlertKind === 'alarm' ? 'The phone that starts a session rings when it ends.' : 'In a browser, the end is shown while this tab is open.'
            }`}
          </Text>
        </View>
      )}

      {todays.length ? (
        <View>
          <SectionTitle>{`Today · ${todays.length}`}</SectionTitle>
          {todays.map((s) => {
            const live = isRunning(s, nowMs);
            const what = s.kind === 'break' ? 'Break' : taskTitle(s.taskId) ?? 'Focus';
            const how = live ? 'running' : finishedOnTime(s) ? `${minutesWords(spentMinutes(s, nowMs))}` : `stopped after ${minutesWords(spentMinutes(s, nowMs))}`;
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <Text variant="smallStrong" style={{ width: 52 }}>
                  {showTime(hhmm(s.startedAt))}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text variant="body" color={s.kind === 'break' ? 'textSecondary' : 'text'} numberOfLines={1}>
                    {what}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {how}
                  </Text>
                </View>
                {live ? null : <SmallButton label="Remove" accessibilityLabel={`Remove the ${what} session at ${hhmm(s.startedAt)}`} onPress={() => void run(() => actions.deleteFocus(s.id), 'Session removed')} />}
              </View>
            );
          })}
        </View>
      ) : null}

      <TaskPickerSheet
        visible={picking}
        title="Focus on"
        noneLabel="No task"
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setPicking(false);
          setTaskId(id);
        }}
      />
    </Screen>
  );
}
