import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/state/theme";

import { Icon } from "./Icon";
import { Text } from "./Text";
import { MAX_CONTENT_WIDTH, space, TOUCH } from "./tokens";

export type SheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Shown pinned under the scrolling content (main buttons). */
  footer?: ReactNode;
};

/** A panel that rises from the bottom over a dimmed screen. Square, like everything else. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
}: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.fill}
      >
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.fill, styles.scrim]}
        />
        {/* Full-screen and see-through to taps, so the panel can sit centred on wide screens. */}
        <View pointerEvents="box-none" style={styles.frame}>
          <View
            accessibilityViewIsModal
            aria-modal
            role="dialog"
            aria-label={title}
            style={[
              styles.panel,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.divider,
                paddingBottom: insets.bottom + space.md,
              },
            ]}
          >
            <View style={styles.head}>
              <Text
                variant="label"
                color="textSecondary"
                accessibilityRole="header"
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={styles.close}
              >
                <Icon name="close" color={colors.text} size={20} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: "rgba(17, 17, 17, 0.45)" },
  frame: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  panel: {
    maxHeight: "88%",
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    borderTopWidth: 1,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space.xl - space.xs,
    paddingRight: space.sm,
  },
  close: {
    width: TOUCH,
    height: TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: space.xl - space.xs,
    paddingBottom: space.md,
    gap: space.md,
  },
  footer: {
    paddingHorizontal: space.xl - space.xs,
    paddingTop: space.sm,
    gap: space.sm,
  },
});
