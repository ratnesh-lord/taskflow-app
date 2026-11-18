import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space, TOUCH } from '@/ui/tokens';

export type Option<T extends string> = { value: T; label: string; detail?: string };

export type OptionSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly Option<T>[];
  value: T | null;
  onClose: () => void;
  onPick: (value: T) => void;
  /** Offer to create a new option by name. */
  createLabel?: string;
  onCreate?: (name: string) => void;
};

/** Choose one from a list, optionally adding a new entry. */
export function OptionSheet<T extends string>({ visible, title, options, value, onClose, onPick, createLabel, onCreate }: OptionSheetProps<T>) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setName('');
  }

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              aria-checked={selected}
              onPress={() => onPick(o.value)}
              style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <View style={{ flex: 1 }}>
                <Text variant={selected ? 'bodyStrong' : 'body'}>{o.label}</Text>
                {o.detail ? (
                  <Text variant="caption" color="textSecondary">
                    {o.detail}
                  </Text>
                ) : null}
              </View>
              {selected ? <Icon name="check" color={colors.accent} size={20} /> : null}
            </Pressable>
          );
        })}
      </View>
      {onCreate ? (
        <View style={{ gap: space.sm }}>
          <TextField label={createLabel ?? 'New'} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => name.trim() && onCreate(name.trim())} />
          <Button variant="secondary" label={createLabel ?? 'Add'} disabled={!name.trim()} onPress={() => onCreate(name.trim())} />
        </View>
      ) : null}
    </Sheet>
  );
}
