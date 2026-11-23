import { type ComponentRef, useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { type CalendarDay, type CalendarEntry, canDrag, inMonth } from '@/core/calendar';
import { dayLabel, type LocalDate, minutesToTime, type Now, parts } from '@/core/dates';
import { useTheme } from '@/state/theme';
import { shortTime } from '@/ui/format';
import { Text } from '@/ui/Text';
import { space, TOUCH } from '@/ui/tokens';

import { ACTIVATE, entryTitle, useOpenEntry } from './Block';
import { type DragPoint, Draggable } from './Draggable';
import { measure, type Rect } from './TimeGrid';
import { useMoveTask } from './useMoveTask';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Six weeks of days with a mark for each task. Tap a day to list it below;
 * touch and hold a task in that list and drag it onto another day.
 */
export function MonthView({
  days, anchor, now, selected, onSelect, wide, onScrollLock,
}: {
  days: CalendarDay[];
  anchor: LocalDate;
  now: Now;
  selected: LocalDate;
  onSelect: (date: LocalDate) => void;
  wide: boolean;
  onScrollLock: (locked: boolean) => void;
}) {
  const { colors } = useTheme();
  const open = useOpenEntry();
  const move = useMoveTask();
  const grid = useRef<ComponentRef<typeof View>>(null);
  const gridRect = useRef<Rect | null>(null);
  const dragged = useRef<CalendarEntry | null>(null);
  const [target, setTarget] = useState<LocalDate | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const cellAt = useCallback(
    (p: DragPoint): LocalDate | null => {
      const r = gridRect.current;
      if (!r || p.x < r.x || p.x > r.x + r.width || p.y < r.y || p.y > r.y + r.height) return null;
      const col = Math.min(6, Math.floor(((p.x - r.x) / r.width) * 7));
      const row = Math.min(5, Math.floor(((p.y - r.y) / r.height) * 6));
      return days[row * 7 + col]?.date ?? null;
    },
    [days],
  );

  const finish = useCallback(
    (p: DragPoint | null) => {
      const entry = dragged.current;
      dragged.current = null;
      setDraggingKey(null);
      setTarget(null);
      onScrollLock(false);
      if (!entry || entry.kind !== 'task' || !p) return;
      const date = cellAt(p);
      if (date) move(entry.item, { date, time: entry.item.time ?? null });
    },
    [cellAt, move, onScrollLock],
  );
  const startDrag = useCallback(
    (entry: CalendarEntry) => {
      void measure(grid.current).then((r) => {
        gridRect.current = r;
        dragged.current = entry;
        setDraggingKey(entry.key);
        onScrollLock(true);
      });
    },
    [onScrollLock],
  );
  const moveDrag = useCallback(
    (p: DragPoint) => {
      if (!dragged.current) return;
      const next = cellAt(p);
      setTarget((t) => (t === next ? t : next));
    },
    [cellAt],
  );
  const cancelDrag = useCallback(() => {
    if (dragged.current) finish(null);
  }, [finish]);

  const dragProps = (entry: CalendarEntry) => ({
    enabled: canDrag(entry),
    onTap: () => open(entry),
    onStart: () => startDrag(entry),
    onMove: moveDrag,
    onDrop: finish,
    onCancel: cancelDrag,
  });

  const day = days.find((d) => d.date === selected);
  const list = day ? [...day.allDay, ...day.timed] : [];

  return (
    <View style={{ gap: space.lg }}>
      <View>
        <View style={styles.row}>
          {WEEKDAYS.map((w) => (
            <Text key={w} variant="caption" color="textSecondary" style={styles.head}>
              {wide ? w : w[0]}
            </Text>
          ))}
        </View>
        <View ref={grid} collapsable={false} style={[styles.grid, { borderColor: colors.divider }]}>
          {days.map((d) => {
            const entries = [...d.allDay, ...d.timed];
            const dim = !inMonth(d.date, anchor);
            const isSelected = d.date === selected;
            const isTarget = d.date === target;
            const isToday = d.date === now.date;
            return (
              <Pressable
                key={d.date}
                accessibilityRole="button"
                accessibilityLabel={`${dayLabel(d.date, now.date)}, ${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
                aria-selected={isSelected}
                onPress={() => onSelect(d.date)}
                style={[
                  styles.cell,
                  { height: wide ? 96 : 56, borderColor: colors.divider },
                  isSelected && { backgroundColor: colors.divider },
                  isTarget && { borderColor: colors.accent, borderWidth: 2 },
                ]}>
                <Text variant={isToday ? 'smallStrong' : 'caption'} style={{ color: isToday ? colors.accent : dim ? colors.textSecondary : colors.text }}>
                  {parts(d.date).day}
                </Text>
                {wide ? (
                  entries.slice(0, 3).map((e) => (
                    <Text key={e.key} variant="caption" numberOfLines={1} style={{ color: markColor(e, colors) }}>
                      {entryTitle(e)}
                    </Text>
                  ))
                ) : (
                  <View style={styles.marks}>
                    {entries.slice(0, 4).map((e) => (
                      <View key={e.key} style={[styles.mark, { backgroundColor: markColor(e, colors) }]} />
                    ))}
                  </View>
                )}
                {entries.length > (wide ? 3 : 4) ? (
                  <Text variant="caption" color="textSecondary">{`+${entries.length - (wide ? 3 : 4)}`}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text variant="label" color="textSecondary" style={{ paddingBottom: space.sm }}>
          {`${dayLabel(selected, now.date)} · ${list.length}`}
        </Text>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
          {list.length === 0 ? (
            <Text variant="small" color="textSecondary" style={{ paddingVertical: space.lg }}>
              Nothing on this day.
            </Text>
          ) : (
            list.map((entry) => (
              <Draggable
                key={entry.key}
                {...dragProps(entry)}>
                <View collapsable={false}>
                  <EntryRow entry={entry} inDrag dragging={draggingKey === entry.key} onPress={() => open(entry)} />
                </View>
              </Draggable>
            ))
          )}
        </View>
        {list.some(canDrag) ? (
          <Text variant="caption" color="textSecondary" style={{ paddingTop: space.sm }}>
            Touch and hold a task, then drag it onto another day.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function markColor(e: CalendarEntry, colors: { accent: string; overdue: string; textSecondary: string; divider: string }): string {
  if (e.kind === 'event') return colors.textSecondary;
  if (e.done) return colors.divider;
  return e.item.overdue ? colors.overdue : colors.accent;
}

/**
 * A task or event as one line: time, title, and where an event comes from.
 * Inside a Draggable it leaves taps to the Draggable ([inDrag]).
 */
export function EntryRow({ entry, dragging, onPress, inDrag }: { entry: CalendarEntry; dragging?: boolean; onPress: () => void; inDrag?: boolean }) {
  const { colors } = useTheme();
  const done = entry.kind === 'task' && entry.done;
  const overdue = entry.kind === 'task' && entry.item.overdue;
  const time = entry.start != null ? shortTime(minutesToTime(entry.start)) : entry.kind === 'event' ? 'All day' : 'Any time';
  const label = `${entryTitle(entry)}, ${time}${done ? ', completed' : overdue ? ', overdue' : ''}${entry.kind === 'event' ? `, ${entry.event.calendarName} event` : ''}`;
  const body = (
    <>
      <Text variant="caption" numberOfLines={1} style={[styles.entryTime, { color: overdue ? colors.overdue : colors.textSecondary }]}>
        {time}
      </Text>
      <View style={[styles.swatch, entry.kind === 'event' ? { borderWidth: 1, borderColor: colors.textSecondary } : { backgroundColor: done ? colors.divider : overdue ? colors.overdue : colors.accent }]} />
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={2} style={done ? { color: colors.textSecondary, textDecorationLine: 'line-through' } : undefined}>
          {entryTitle(entry)}
        </Text>
        {entry.kind === 'event' ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {entry.event.calendarName}
          </Text>
        ) : null}
      </View>
    </>
  );
  const rowStyle = [styles.entry, { borderBottomColor: colors.divider, opacity: dragging ? 0.35 : 1 }];
  if (inDrag) {
    return (
      <View accessible accessibilityRole="button" accessibilityLabel={label} accessibilityActions={ACTIVATE} onAccessibilityAction={onPress} style={rowStyle}>
        {body}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [rowStyle, pressed && { opacity: 0.7 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  head: { flex: 1, textAlign: 'center', paddingBottom: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderLeftWidth: 1 },
  cell: { width: `${100 / 7}%`, borderRightWidth: 1, borderBottomWidth: 1, padding: 3, gap: 2, overflow: 'hidden' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  mark: { width: 6, height: 6 },
  entry: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: 1, paddingVertical: space.sm },
  entryTime: { width: 56 },
  swatch: { width: 8, height: 8 },
});
