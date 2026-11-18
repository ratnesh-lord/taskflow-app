import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { sendPasswordReset } from '@/platform/auth';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

export default function ResetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  async function submit() {
    if (!emailOk || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const outcome = await sendPasswordReset(email);
    setBusy(false);
    if (!outcome.ok) setError(outcome.message);
    else setNote(outcome.note ?? 'Check your inbox.');
  }

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.xs, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Reset password
        </Text>
        <Text variant="small" color="textSecondary">
          We email you a link. Open it on this device, from the newest email: each link works once, for an hour, and a new request cancels the earlier ones.
        </Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {note ? <Notice tone="success">{note}</Notice> : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />

      <Button label="Send reset link" busyLabel="Sending…" busy={busy} disabled={!emailOk} onPress={submit} />
      <Button variant="quiet" label="Back to sign in" onPress={() => router.back()} />
    </Screen>
  );
}
