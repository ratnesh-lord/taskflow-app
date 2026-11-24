import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/state/theme';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const LABEL_WIDTH = 40;

export type Bar = { key: string; /** Under the bar (may be empty to thin out labels). */ label: string; value: number; /** Read aloud and shown when tapped. */ detail: string };

/**
 * One series of square bars from a zero baseline. Tapping a bar shows its
 * value above the chart; each bar is also read out with its value, and the
 * highest value is written on the axis, so nothing depends on colour.
 */
export function BarChart({ title, bars, height = 120, color, empty }: { title: string; bars: readonly Bar[]; height?: number; color?: string; empty?: string }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(0, ...bars.map((b) => b.value));
  const fill = color ?? colors.accent;
  const shown = bars.find((b) => b.key === picked);
  const gap = bars.length > 14 ? 2 : 4;

  return (
    <View accessibilityLabel={title} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
        <Text variant="label" color="textSecondary">
          {title}
        </Text>
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite" numberOfLines={1} style={{ flexShrink: 1 }}>
          {shown ? shown.detail : max > 0 ? 'Tap a bar for its value' : ''}
        </Text>
      </View>
      {max === 0 ? (
        <View style={{ height, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider }}>
          <Text variant="small" color="textSecondary">
            {empty ?? 'Nothing yet.'}
          </Text>
        </View>
      ) : (
        <View>
          <Text variant="caption" color="textSecondary">
            {String(max)}
          </Text>
          <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap, borderBottomWidth: 1, borderBottomColor: colors.textSecondary }}>
            {bars.map((b) => {
              const h = b.value === 0 ? 0 : Math.max(2, Math.round((b.value / max) * height));
              const on = b.key === picked;
              return (
                <Pressable
                  key={b.key}
                  accessibilityRole="button"
                  accessibilityLabel={b.detail}
                  onPress={() => setPicked(on ? null : b.key)}
                  hitSlop={{ top: height }}
                  style={{ flex: 1, height, justifyContent: 'flex-end' }}>
                  <View style={{ height: h, backgroundColor: fill, opacity: picked && !on ? 0.45 : 1 }} />
                </Pressable>
              );
            })}
          </View>
          {/* Labels are centred under their bar but may be wider than it (30 thin bars). */}
          <View style={{ flexDirection: 'row', gap, height: 20, marginTop: space.xs }}>
            {bars.map((b) => (
              <View key={b.key} style={{ flex: 1, alignItems: 'center' }}>
                {b.label ? (
                  <Text variant="caption" color="textSecondary" style={{ position: 'absolute', width: LABEL_WIDTH, textAlign: 'center' }}>
                    {b.label}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** A big number with a label under it, in a row of up to four. */
export function Stat({ value, label, tone }: { value: string; label: string; tone?: 'overdue' | 'completed' }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, minWidth: 72, gap: 2 }}>
      <Text variant="title" color={tone ?? 'text'}>
        {value}
      </Text>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>{children}</View>;
}

/** A thin progress bar. */
export function Meter({ percent, color, label }: { percent: number; color?: string; label: string }) {
  const { colors } = useTheme();
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: p }} style={{ height: 4, backgroundColor: colors.divider }}>
      <View style={{ width: `${p}%`, height: 4, backgroundColor: color ?? colors.completed }} />
    </View>
  );
}
