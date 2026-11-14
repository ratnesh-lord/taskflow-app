import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { useTheme } from '@/state/theme';

import { Text } from './Text';
import { space, TOUCH, typography } from './tokens';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string | null;
};

/** A labelled input: a single underline that turns accent when focused, red on error. */
export function TextField({ label, error, onFocus, onBlur, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const line = error ? colors.overdue : focused ? colors.accent : colors.divider;

  return (
    <View style={styles.wrap}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.textSecondary}
        selectionColor={colors.accent}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          { color: colors.text, borderBottomColor: line, borderBottomWidth: focused || error ? 2 : 1 },
        ]}
      />
      {error ? (
        <Text variant="caption" color="overdue" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    ...typography.body,
    minHeight: TOUCH,
    paddingVertical: space.sm,
    paddingHorizontal: 0,
  },
});
