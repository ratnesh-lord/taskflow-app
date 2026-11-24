import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { addDays, longDate, shortDate } from '@/core/dates';
import { DateSheet } from '@/components/DateSheet';
import { SmallButton } from '@/components/ActionRow';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { EditableText } from '@/ui/EditableText';
import { SectionTitle } from '@/ui/Row';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

/** More → Notes: one note per day, and the notes kept with each weekly review. */
export default function Notes() {
  const { data, actions } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const [day, setDay] = useState(now.date);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const note = data.notes.get(`day:${day}`);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.notes.values()]
      .filter((n) => n.body.trim() && (!q || n.body.toLowerCase().includes(q)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.kind === 'week' ? 1 : -1));
  }, [data.notes, query]);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Notes" subtitle="A note for each day: plans, thoughts, what happened. Saved to your account." />

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <SmallButton label="‹" accessibilityLabel="Previous day" onPress={() => setDay(addDays(day, -1))} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Choose a day, now ${longDate(day)}`} onPress={() => setPicking(true)} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="bodyStrong">{day === now.date ? `Today, ${shortDate(day, now.date)}` : longDate(day)}</Text>
          </Pressable>
          <SmallButton label="›" accessibilityLabel="Next day" onPress={() => setDay(addDays(day, 1))} />
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.sm }}>
          <EditableText
            key={`note-${day}`}
            accessibilityLabel={`Note for ${longDate(day)}`}
            value={note?.body ?? ''}
            multiline
            variant="body"
            placeholder="Write something for this day"
            maxLength={20000}
            onSave={(body) => body !== (note?.body ?? '') && void run(() => actions.saveNote('day', day, body))}
          />
        </View>
        {day !== now.date ? (
          <View style={{ alignItems: 'flex-start' }}>
            <SmallButton label="Back to today" onPress={() => setDay(now.date)} />
          </View>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>{`All notes · ${list.length}`}</SectionTitle>
        <TextField label="Search notes" value={query} onChangeText={setQuery} autoCapitalize="none" returnKeyType="search" />
        {list.length === 0 ? (
          <Text variant="small" color="textSecondary">
            {query ? 'No note matches.' : 'No notes yet.'}
          </Text>
        ) : (
          list.map((n) => (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              onPress={() => (n.kind === 'week' ? router.push('/review') : setDay(n.date))}
              style={{ paddingVertical: space.sm, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <Text variant="smallStrong" color={n.kind === 'day' && n.date === day ? 'accent' : 'text'}>
                {n.kind === 'week' ? `Week of ${shortDate(n.date, now.date)} (weekly review)` : longDate(n.date)}
              </Text>
              <Text variant="small" color="textSecondary" numberOfLines={2}>
                {n.body.trim()}
              </Text>
            </Pressable>
          ))
        )}
      </View>

      <DateSheet
        visible={picking}
        title="Note for"
        today={now.date}
        date={day}
        time={null}
        withTime={false}
        onClose={() => setPicking(false)}
        onPick={(date) => {
          setPicking(false);
          if (date) setDay(date);
        }}
      />
    </Screen>
  );
}
