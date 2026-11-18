import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/state/theme';

import { Icon } from './Icon';
import { Text } from './Text';
import { space, TOUCH } from './tokens';

/** A label on the left and a value on the right, with a divider below. Tappable when onPress is given. */
export function FieldRow({
  label, value, onPress, placeholder, valueColor, last, children,
}: {
  label: string;
  value?: string | null;
  onPress?: () => void;
  placeholder?: string;
  valueColor?: 'text' | 'textSecondary' | 'overdue' | 'accent';
  last?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      <Text variant="small" color="textSecondary" style={{ width: 104 }}>
        {label}
      </Text>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {children ?? (
          <Text variant="smallStrong" color={value ? valueColor ?? 'text' : 'textSecondary'} numberOfLines={2} style={{ flex: 1 }}>
            {value || placeholder || 'None'}
          </Text>
        )}
      </View>
      {onPress ? <Icon name="chevron" color={colors.textSecondary} size={16} /> : null}
    </>
  );
  const style = {
    minHeight: TOUCH,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.sm,
    borderBottomWidth: last ? 0 : 1,
    borderBottomColor: colors.divider,
    paddingVertical: space.xs,
  };
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder || 'None'}`} onPress={onPress} style={style}>
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

/** A tappable line in a menu, with an optional count. */
export function MenuRow({ label, detail, onPress, icon, danger }: { label: string; detail?: string; onPress: () => void; icon?: Parameters<typeof Icon>[0]['name']; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1,
        borderBottomColor: colors.divider, opacity: pressed ? 0.6 : 1,
      })}>
      {icon ? <Icon name={icon} color={danger ? colors.overdue : colors.text} size={20} /> : null}
      <Text variant="bodyStrong" color={danger ? 'overdue' : 'text'} style={{ flex: 1 }}>
        {label}
      </Text>
      {detail ? (
        <Text variant="small" color="textSecondary">
          {detail}
        </Text>
      ) : null}
      <Icon name="chevron" color={colors.textSecondary} size={16} />
    </Pressable>
  );
}

export function SectionTitle({ children, color = 'textSecondary' }: { children: string; color?: 'textSecondary' | 'overdue' }) {
  return (
    <Text variant="label" color={color} accessibilityRole="header" style={{ paddingTop: space.md, paddingBottom: space.xs }}>
      {children}
    </Text>
  );
}
