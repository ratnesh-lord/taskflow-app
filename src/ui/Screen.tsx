import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/state/theme';

import { MAX_CONTENT_WIDTH, space } from './tokens';

export type ScreenProps = {
  children: ReactNode;
  /** Narrower column for forms. */
  narrow?: boolean;
  /** Leave room for the system navigation bar (screens without the tab bar). */
  bottomInset?: boolean;
  /** Leave room under the content for the floating add button or a toolbar. */
  bottomSpace?: number;
  /** Floating things drawn over the page, such as the add button or the selection toolbar. */
  overlay?: ReactNode;
};

/** Page frame: themed background, safe areas, scrolling, and a centred column on wide screens. */
export function Screen({ children, narrow, bottomInset, bottomSpace = 0, overlay }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: space.xl + bottomSpace + (bottomInset ? insets.bottom : 0) },
        ]}>
        <View style={[styles.column, { maxWidth: narrow ? 440 : MAX_CONTENT_WIDTH }]}>{children}</View>
      </ScrollView>
      {overlay}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg + space.xs, paddingTop: space.lg + space.xs },
  column: { width: '100%', alignSelf: 'center', gap: space.lg },
});
