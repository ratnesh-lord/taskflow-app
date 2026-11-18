import { useState } from 'react';

import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { TextField } from '@/ui/TextField';

/** Ask for one name (a saved filter, a category). */
export function NameSheet({
  visible, title, label, initial = '', saveLabel, onClose, onSave,
}: { visible: boolean; title: string; label: string; initial?: string; saveLabel: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setName(initial);
  }
  const ok = name.trim().length > 0;
  return (
    <Sheet visible={visible} title={title} onClose={onClose} footer={<Button label={saveLabel} disabled={!ok} onPress={() => onSave(name.trim())} />}>
      <TextField label={label} value={name} onChangeText={setName} autoFocus maxLength={100} returnKeyType="done" onSubmitEditing={() => ok && onSave(name.trim())} />
    </Sheet>
  );
}
