import { useState } from 'react';
import { View } from 'react-native';

import { signOut, updatePassword } from '@/platform/auth';
import { useSession } from '@/state/session';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

const MIN_PASSWORD = 8;

/** Reached only through a password-reset link. */
export default function UpdatePassword() {
  const { finishRecovery, user } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = password.length >= MIN_PASSWORD;

  async function submit() {
    if (!passwordOk || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await updatePassword(password);
    setBusy(false);
    if (!outcome.ok) setError(outcome.message);
    else finishRecovery();
  }

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.xs, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          New password
        </Text>
        <Text variant="small" color="textSecondary">
          {user?.email ? `For ${user.email}.` : 'Choose a new password.'}
        </Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <TextField
        label={`New password (at least ${MIN_PASSWORD} characters)`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      <Button label="Save password" busyLabel="Saving…" busy={busy} disabled={!passwordOk} onPress={submit} />
      <Button variant="quiet" label="Cancel and sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
