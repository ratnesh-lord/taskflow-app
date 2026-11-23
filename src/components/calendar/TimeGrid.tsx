import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, View } from 'react-native';

import { type CalendarDay, type CalendarEntry, canDrag, type Drop, dropFor, layoutTimed, minutesAt } from '@/core/calendar';
import { minutesToTime, type Now, parts, WEEKDAY_SHORT, weekday } from '@/core/dates';
import { useTheme } from '@/state/theme';
import { shortTime } from '@/ui/format';
import { Text } from '@/ui/Text';
import { calendarGrid, space } from '@/ui/tokens';

import { Block, entryTitle, useOpenEntry } from './Block';
import { type DragPoint, Draggable } from './Draggable';
import { useMoveTask } from './useMoveTask';

const H = calendarGrid.hourHeight;
const GUTTER = calendarGrid.gutter;
const EDGE = 48;

export type Rect = { x: number; y: number; width: number; height: number };

type ViewRef = ComponentRef<typeof View>;

export function measure(view: ViewRef | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

type Drag = {
  entry: CalendarEntry & { kind: 'task' };
  grabY: number;
  content: Rect;
  allDay: Rect;
  viewport: Rect;
  scrollAtStart: number;
};

/**
 * The day and week views: an all-day row, then 24 hours with tasks and events
 * as blocks. Touch and hold a task, then drag it to another time or day; drop
 * it in the all-day row to take its time off.
 */
export function TimeGrid({ days, now }: { days: CalendarDay[]; now: Now }) {
  const { colors } = useTheme();
  const open = useOpenEntry();
  const move = useMoveTask();
  const [width, setWidth] = useState(0);
  const [target, setTarget] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState<{ key: string; minutes: number; title: string } | null>(null);
  const draggingKey = dragging?.key ?? null;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const content = useRef<ViewRef>(null);
  const allDayRow = useRef<ViewRef>(null);
  const viewport = useRef<ViewRef>(null);
  const scrollY = useRef(0);
  const drag = useRef<Drag | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null>(null);
  const lastPoint = useRef<DragPoint | null>(null);

  const columns = days.length;
  const colWidth = width > GUTTER ? (width - GUTTER) / columns : 0;
  const dates = useMemo(() => days.map((d) => d.date), [days]);
  const key = dates.join(',');

  // Open at the first timed entry, or 07:00, once per range.
  const firstStart = useMemo(() => {
    const starts = days.flatMap((d) => d.timed.map((e) => e.start ?? 0));
    return starts.length ? Math.min(...starts) : 7 * 60;
  }, [days]);
  useEffect(() => {
    const y = Math.max(0, ((Math.min(firstStart, 7 * 60) - 30) / 60) * H);
    const t = setTimeout(() => scroll.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(t);
    // Only when the shown days change, not on every data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const targetAt = useCallback(
    (p: DragPoint): Drop | null => {
      const d = drag.current;
      if (!d || colWidth === 0) return null;
      const col = Math.max(0, Math.min(columns - 1, Math.floor((p.x - d.content.x - GUTTER) / colWidth)));
      const date = dates[col];
      if (p.y < d.viewport.y) return dropFor(date, null);
      const contentTop = d.content.y - (scrollY.current - d.scrollAtStart);
      return dropFor(date, minutesAt(p.y - d.grabY - contentTop, H));
    },
    [colWidth, columns, dates],
  );

  const stopAutoScroll = () => {
    if (autoScroll.current) {
      clearTimeout(autoScroll.current);
      clearInterval(autoScroll.current);
    }
    autoScroll.current = null;
  };

  const onMove = useCallback(
    (p: DragPoint) => {
      const d = drag.current;
      if (!d) return;
      lastPoint.current = p;
      const next = targetAt(p);
      setTarget((t) => (t && next && t.date === next.date && t.time === next.time ? t : next));
      const bottom = d.viewport.y + d.viewport.height;
      const dir = p.y > bottom - EDGE ? 1 : p.y > d.viewport.y && p.y < d.viewport.y + EDGE ? -1 : 0;
      if (dir === 0) return stopAutoScroll();
      if (autoScroll.current) return;
      // Scrolls only after the finger rests near the edge, not when it passes through.
      autoScroll.current = setTimeout(() => {
        autoScroll.current = setInterval(tick, 40);
      }, 250);
      const tick = () => {
        const y = Math.max(0, Math.min(24 * H - d.viewport.height, scrollY.current + dir * 12));
        scroll.current?.scrollTo({ y, animated: false });
        scrollY.current = y;
        if (lastPoint.current) {
          const again = targetAt(lastPoint.current);
          setTarget(again);
        }
      };
    },
    [targetAt],
  );

  const onStart = useCallback(
    (entry: CalendarEntry, grab: DragPoint) => {
      if (entry.kind !== 'task') return;
      void Promise.all([measure(content.current), measure(allDayRow.current), measure(viewport.current)]).then(([c, a, v]) => {
        if (!c || !a || !v) return;
        // An all-day item is held near its top; a timed one where the finger is.
        drag.current = { entry, grabY: entry.start == null ? 4 : grab.y, content: c, allDay: a, viewport: v, scrollAtStart: scrollY.current };
        const minutes = entry.start != null && entry.end != null ? entry.end - entry.start : 30;
        setDragging({ key: entry.key, minutes, title: entryTitle(entry) });
      });
    },
    [],
  );

  const finish = useCallback(
    (p: DragPoint | null) => {
      stopAutoScroll();
      const d = drag.current;
      const drop = d && p ? targetAt(p) : null;
      drag.current = null;
      lastPoint.current = null;
      setDragging(null);
      setTarget(null);
      if (d && drop) move(d.entry.item, drop);
    },
    [move, targetAt],
  );

  const handlers = (entry: CalendarEntry) => ({
    enabled: canDrag(entry),
    onTap: () => open(entry),
    onStart: (_: DragPoint, grab: DragPoint) => onStart(entry, grab),
    onMove,
    onDrop: (p: DragPoint) => finish(p),
    onCancel: () => {
      if (drag.current) finish(null);
    },
  });

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const nowTop = (now.minutes / 60) * H;
  const allDayRows = Math.max(1, Math.min(3, ...days.map((d) => d.allDay.length)));

  return (
    <View style={styles.fill} onLayout={onLayout}>
      {columns > 1 ? (
        <View style={[styles.headRow, { borderBottomColor: colors.divider }]}>
          <View style={{ width: GUTTER }} />
          {days.map((d) => {
            const isToday = d.date === now.date;
            return (
              <View key={d.date} style={[styles.headCell, { width: colWidth }]}>
                <Text variant="caption" color={isToday ? 'accent' : 'textSecondary'}>
                  {WEEKDAY_SHORT[weekday(d.date)]}
                </Text>
                <Text variant="smallStrong" color={isToday ? 'accent' : 'text'}>
                  {parts(d.date).day}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View ref={allDayRow} collapsable={false} style={[styles.allDay, { borderBottomColor: colors.divider, minHeight: allDayRows * (calendarGrid.allDayItem + 2) + space.xs }]}>
        <View style={[styles.gutterLabel, { width: GUTTER }]}>
          <Text variant="caption" color="textSecondary">
            All day
          </Text>
        </View>
        {days.map((d) => {
          const highlighted = draggingKey && target?.date === d.date && target.time === null;
          return (
            <View key={d.date} style={[styles.allDayCell, { width: colWidth, backgroundColor: highlighted ? colors.divider : 'transparent' }]}>
              {d.allDay.slice(0, 3).map((entry, i) =>
                i === 2 && d.allDay.length > 3 ? (
                  <Text key="more" variant="caption" color="textSecondary">{`+${d.allDay.length - 2} more`}</Text>
                ) : (
                  <View key={entry.key} style={{ height: calendarGrid.allDayItem, marginBottom: 2 }}>
                    <Draggable {...handlers(entry)}>
                      <View style={styles.fill} collapsable={false}>
                        <Block entry={entry} compact dragging={draggingKey === entry.key} onPress={() => open(entry)} />
                      </View>
                    </Draggable>
                  </View>
                ),
              )}
            </View>
          );
        })}
      </View>

      <View ref={viewport} collapsable={false} style={styles.fill}>
        <ScrollView
          ref={scroll}
          scrollEventThrottle={16}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEnabled={!draggingKey}>
          <View ref={content} collapsable={false} style={{ height: 24 * H }}>
            {Array.from({ length: 24 }, (_, h) => (
              <View key={h} style={[styles.hour, { top: h * H, borderTopColor: colors.divider }]}>
                <Text variant="caption" color="textSecondary" style={[styles.hourLabel, { width: GUTTER }]}>
                  {h === 0 ? '' : shortTime(minutesToTime(h * 60))}
                </Text>
              </View>
            ))}

            {days.map((d, col) => {
              const placed = new Map(
                layoutTimed(d.timed.map((e) => ({ key: e.key, start: e.start!, end: e.end! }))).map((p) => [p.key, p]),
              );
              return d.timed.map((entry) => {
                const p = placed.get(entry.key)!;
                const left = GUTTER + col * colWidth + (p.column * colWidth) / p.columns;
                const w = colWidth / p.columns - 2;
                return (
                  <View key={entry.key} style={{ position: 'absolute', top: (p.start / 60) * H + 1, height: ((p.end - p.start) / 60) * H - 2, left, width: w }}>
                    <Draggable {...handlers(entry)}>
                      <View style={styles.fill} collapsable={false}>
                        <Block entry={entry} compact={w < 60 || p.end - p.start < 45} dragging={draggingKey === entry.key} onPress={() => open(entry)} />
                      </View>
                    </Draggable>
                  </View>
                );
              });
            })}

            {dates.includes(now.date) ? (
              <View
                pointerEvents="none"
                style={[styles.nowLine, { top: nowTop, left: GUTTER + dates.indexOf(now.date) * colWidth, width: colWidth, backgroundColor: colors.overdue }]}
              />
            ) : null}

            {draggingKey && target && target.time ? (
              <View
                pointerEvents="none"
                style={[
                  styles.ghost,
                  {
                    top: (minutesOf(target.time) / 60) * H,
                    height: ((dragging?.minutes ?? 30) / 60) * H,
                    left: GUTTER + dates.indexOf(target.date) * colWidth,
                    width: colWidth - 2,
                    borderColor: colors.accent,
                  },
                ]}>
                <Text variant="caption" color="accent" numberOfLines={1}>
                  {shortTime(target.time)}
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>

      {draggingKey && target ? (
        <View pointerEvents="none" style={[styles.dropLabel, { backgroundColor: colors.text }]}>
          <Text variant="caption" style={{ color: colors.background }} numberOfLines={1}>
            {`${dragging?.title ?? ''} → ${WEEKDAY_SHORT[weekday(target.date)]} ${parts(target.date).day}${target.time ? `, ${shortTime(target.time)}` : ', all day'}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}


const styles = StyleSheet.create({
  fill: { flex: 1 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, paddingBottom: space.xs },
  headCell: { alignItems: 'center' },
  allDay: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 2 },
  gutterLabel: { justifyContent: 'center' },
  allDayCell: { paddingHorizontal: 1 },
  hour: { position: 'absolute', left: 0, right: 0, height: H, borderTopWidth: 1, flexDirection: 'row' },
  hourLabel: { marginTop: -8, paddingRight: space.xs, textAlign: 'right' },
  nowLine: { position: 'absolute', height: 2 },
  ghost: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', paddingHorizontal: space.xs },
  dropLabel: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg, padding: space.sm },
});
