import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { parseIcon } from '@/core/appearance';
import { CLIPART_BY_KEY, type ClipartElement } from '@/core/clipart';
import { usePictureUrl } from '@/platform/pictures';
import { useTheme } from '@/state/theme';
import { Text } from '@/ui/Text';

/** One clipart drawing, in the app's line style. */
export function ClipartImage({ name, size, color }: { name: string; size: number; color: string }) {
  const art = CLIPART_BY_KEY.get(name);
  if (!art) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="square" strokeLinejoin="miter">
      {art.elements.map((el, i) => shape(el, i))}
    </Svg>
  );
}

function shape([tag, a]: ClipartElement, key: number) {
  switch (tag) {
    case 'path':
      return <Path key={key} d={a.d} />;
    case 'circle':
      return <Circle key={key} cx={a.cx} cy={a.cy} r={a.r} />;
    case 'rect':
      return <Rect key={key} x={a.x} y={a.y} width={a.width} height={a.height} />;
    case 'line':
      return <Line key={key} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />;
    case 'polyline':
      return <Polyline key={key} points={a.points} />;
    case 'polygon':
      return <Polygon key={key} points={a.points} />;
    case 'ellipse':
      return <Ellipse key={key} cx={a.cx} cy={a.cy} rx={a.rx} ry={a.ry} />;
  }
}

/**
 * A task's picture: its emoji, clipart (in the task's colour) or photo.
 * Nothing when it has none. Pictures are decoration: the title says what the
 * task is, so screen readers skip them.
 */
export function TaskPicture({ icon, size, color }: { icon: string | null | undefined; size: number; color?: string | null }) {
  const { colors } = useTheme();
  const parsed = parseIcon(icon);
  const url = usePictureUrl(parsed?.kind === 'image' ? parsed.path : null);
  if (!parsed) return null;
  const box = { width: size, height: size };
  return (
    <View style={[styles.box, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      {parsed.kind === 'emoji' ? (
        <Text style={{ fontSize: Math.round(size * 0.78), lineHeight: size, textAlign: 'center' }}>{parsed.emoji}</Text>
      ) : parsed.kind === 'clipart' ? (
        <ClipartImage name={parsed.key} size={Math.round(size * 0.9)} color={color ?? colors.text} />
      ) : url ? (
        <Image source={{ uri: url }} style={box} resizeMode="cover" />
      ) : (
        <View style={[box, { backgroundColor: colors.divider }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
