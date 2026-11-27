import { useState } from 'react';

import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

/** Ask for one name (a saved filter, a category, a username). */
export function NameSheet({
  visible, title, label, initial = '', saveLabel, onClose, onSave, hint, plain, maxLength = 100,
}: {
  visible: boolean; title: string; label: string; initial?: string; saveLabel: string; onClose: () => void; onSave: (name: string) => void;
  /** A line under the field. */
  hint?: string;
  /** No capital letters or corrections (usernames). */
  plain?: boolean;
  maxLength?: number;
}) {
  const [name, setName] = useState(initial);
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setName(initial);
  }
  const ok = name.trim().length > 0;
  return (
    <Sheet visible={visible} title={title} onClose={onClose} footer={<Button label={saveLabel} disabled={!ok} onPress={() => onSave(name.trim())} />}>
      <TextField
        label={label}
        value={name}
        onChangeText={setName}
        autoFocus
        maxLength={maxLength}
        returnKeyType="done"
        autoCapitalize={plain ? 'none' : undefined}
        autoCorrect={plain ? false : undefined}
        onSubmitEditing={() => ok && onSave(name.trim())}
      />
      {hint ? (
        <Text variant="caption" color="textSecondary">
          {hint}
        </Text>
      ) : null}
    </Sheet>
  );
}
