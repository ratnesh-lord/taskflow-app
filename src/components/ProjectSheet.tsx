import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

/** Name and description of a project; used to create one and to rename it. */
export function ProjectSheet({
  visible, title, name, description, saveLabel, onClose, onSave,
}: {
  visible: boolean;
  title: string;
  name?: string;
  description?: string;
  saveLabel: string;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [draftName, setDraftName] = useState(name ?? '');
  const [draftDescription, setDraftDescription] = useState(description ?? '');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setDraftName(name ?? '');
      setDraftDescription(description ?? '');
    }
  }
  const ok = draftName.trim().length > 0;
  const save = () => ok && onSave(draftName.trim(), draftDescription.trim());

  return (
    <Sheet visible={visible} title={title} onClose={onClose} footer={<Button label={saveLabel} disabled={!ok} onPress={save} />}>
      <View style={{ gap: space.lg }}>
        <TextField label="Name" value={draftName} onChangeText={setDraftName} autoFocus maxLength={200} returnKeyType="done" onSubmitEditing={save} />
        <TextField label="Description (optional)" value={draftDescription} onChangeText={setDraftDescription} multiline maxLength={2000} />
      </View>
    </Sheet>
  );
}
