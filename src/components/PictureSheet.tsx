import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatIcon, isEmoji, parseIcon, SUGGESTED_EMOJI } from '@/core/appearance';
import { CLIPART } from '@/core/clipart';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space, TOUCH } from '@/ui/tokens';

import { ClipartImage } from './TaskPicture';

type Tab = 'emoji' | 'clipart' | 'photo';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'emoji', label: 'Emoji' },
  { value: 'clipart', label: 'Clipart' },
  { value: 'photo', label: 'Photo' },
];

/**
 * A task's picture: an emoji (suggested, or any typed), a clipart drawing, or
 * a photo. Optional; "No picture" takes it away.
 */
export function PictureSheet({
  visible, value, onClose, onPick, onPhoto, photoBusy,
}: {
  visible: boolean;
  value: string | null;
  onClose: () => void;
  /** The new picture (as stored), or null for none. */
  onPick: (icon: string | null) => void;
  /** Choose and upload a photo. Without it, only emoji and clipart are offered. */
  onPhoto?: () => void;
  photoBusy?: boolean;
}) {
  const { colors } = useTheme();
  const current = parseIcon(value);
  const [tab, setTab] = useState<Tab>('emoji');
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setTab(current?.kind === 'clipart' ? 'clipart' : current?.kind === 'image' ? 'photo' : 'emoji');
      setTyped('');
    }
  }
  const typedOk = isEmoji(typed);

  return (
    <Sheet
      visible={visible}
      title="Picture"
      onClose={onClose}
      footer={current ? <Button variant="secondary" label="No picture" onPress={() => onPick(null)} /> : undefined}>
      <Segmented label="Kind of picture" value={tab} options={onPhoto ? TABS : TABS.filter((t) => t.value !== 'photo')} onChange={setTab} />

      {tab === 'emoji' ? (
        <>
          <View style={styles.grid}>
            {SUGGESTED_EMOJI.map((e) => {
              const chosen = current?.kind === 'emoji' && current.emoji === e;
              return (
                <Pressable
                  key={e}
                  role="radio"
                  aria-checked={chosen}
                  accessibilityLabel={`Emoji ${e}`}
                  onPress={() => onPick(formatIcon({ kind: 'emoji', emoji: e }))}
                  style={[styles.cell, { borderColor: chosen ? colors.text : 'transparent' }]}>
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Or type any emoji"
                value={typed}
                onChangeText={setTyped}
                maxLength={16}
                error={typed && !typedOk ? 'Type one emoji, without words.' : undefined}
              />
            </View>
            <Button label="Use" disabled={!typedOk} onPress={() => onPick(formatIcon({ kind: 'emoji', emoji: typed.trim() }))} />
          </View>
        </>
      ) : tab === 'clipart' ? (
        <View style={styles.grid}>
          {CLIPART.map((c) => {
            const chosen = current?.kind === 'clipart' && current.key === c.key;
            return (
              <Pressable
                key={c.key}
                role="radio"
                aria-checked={chosen}
                accessibilityLabel={`Clipart: ${c.label}`}
                onPress={() => onPick(formatIcon({ kind: 'clipart', key: c.key }))}
                style={[styles.clip, { borderColor: chosen ? colors.text : 'transparent' }]}>
                <ClipartImage name={c.key} size={28} color={colors.text} />
                <Text variant="caption" color="textSecondary" numberOfLines={1}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Text variant="small" color="textSecondary">
            Choose a photo from this device. It is cropped square, made smaller, and kept in your private storage, so only you see it. Adding one needs a connection.
          </Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button label={current?.kind === 'image' ? 'Choose another photo' : 'Choose a photo'} busy={photoBusy} busyLabel="Uploading…" onPress={() => onPhoto?.()} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  cell: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  emoji: { fontSize: 26, lineHeight: 32 },
  clip: { width: 72, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 2, paddingVertical: space.xs },
});
