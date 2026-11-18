import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { normaliseTagName } from '@/core/ids';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

/** Pick tags for a task from the ones in use, or type new ones. */
export function TagSheet({
  visible, all, selected, onClose, onSave,
}: {
  visible: boolean;
  all: string[];
  selected: string[];
  onClose: () => void;
  onSave: (names: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [name, setName] = useState('');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setChosen(selected);
      setName('');
    }
  }
  const options = [...new Set([...all, ...chosen])].sort();
  const addTyped = () => {
    const tag = normaliseTagName(name);
    if (tag && !chosen.includes(tag)) setChosen((cur) => [...cur, tag]);
    setName('');
  };

  return (
    <Sheet visible={visible} title="Tags" onClose={onClose} footer={<Button label="Save tags" onPress={() => onSave(chosen)} />}>
      {options.length ? (
        <View style={styles.wrap}>
          {options.map((t) => (
            <Chip
              key={t}
              label={`#${t}`}
              selected={chosen.includes(t)}
              onPress={() => setChosen((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
            />
          ))}
        </View>
      ) : (
        <Text variant="small" color="textSecondary">
          No tags yet. Type one below, or add #words in quick add.
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <TextField label="New tag" value={name} onChangeText={setName} autoCapitalize="none" returnKeyType="done" onSubmitEditing={addTyped} maxLength={50} />
        </View>
        <Button variant="secondary" label="Add" disabled={!normaliseTagName(name)} onPress={addTyped} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } });
