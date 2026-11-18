import { useEffect, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { useTheme } from '@/state/theme';

import { typography, type TextVariant } from './tokens';

type Props = Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> & {
  value: string;
  /** Called a moment after typing stops, when the field loses focus, and when the screen closes. */
  onSave: (value: string) => void;
  variant?: TextVariant;
  /** Text that may not be empty (a title): an empty field goes back to the saved value. */
  required?: boolean;
};

const DELAY = 700;

/** A text field that saves itself; there is no Save button to forget. */
export function EditableText({ value, onSave, variant = 'body', required, onFocus, onBlur, ...input }: Props) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saved, setSaved] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);

  // A change from elsewhere (undo, another device) shows up unless this field is being edited.
  if (value !== saved) {
    setSaved(value);
    if (!focused) setDraft(value);
  }

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    if (required && !next.trim()) return;
    save.current(next);
  };

  useEffect(
    () => () => {
      // Closing the screen saves what was typed.
      if (timer.current) clearTimeout(timer.current);
      const next = pending.current;
      if (next !== null && (!required || next.trim())) save.current(next);
    },
    [required],
  );

  return (
    <TextInput
      {...input}
      value={draft}
      onChangeText={(t) => {
        setDraft(t);
        pending.current = t;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, DELAY);
      }}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        flush();
        if (required && !draft.trim()) setDraft(value);
        onBlur?.(e);
      }}
      placeholderTextColor={colors.textSecondary}
      selectionColor={colors.accent}
      style={[
        typography[variant],
        { color: colors.text, paddingHorizontal: 0, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: focused ? colors.accent : 'transparent' },
      ]}
    />
  );
}
