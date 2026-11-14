import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { signUpWithEmail } from '@/platform/auth';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

const MIN_PASSWORD = 8;

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const canSubmit = emailOk && passwordOk;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const outcome = await signUpWithEmail(name, email, password);
    setBusy(false);
    if (!outcome.ok) setError(outcome.message);
    else if (outcome.note) setNote(outcome.note);
  }

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.xs, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          Create account
        </Text>
        <Text variant="small" color="textSecondary">
          Your tasks sync to every device you sign in on.
        </Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {note ? <Notice tone="success">{note}</Notice> : null}

      <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" returnKeyType="next" />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        error={email.length > 0 && !emailOk ? 'Enter a full email address.' : null}
      />
      <TextField
        label={`Password (at least ${MIN_PASSWORD} characters)`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={password.length > 0 && !passwordOk ? `${MIN_PASSWORD - password.length} more to go.` : null}
      />

      <Button label="Create account" busyLabel="Creating account…" busy={busy} disabled={!canSubmit} onPress={submit} />
      <Button variant="quiet" label="Back to sign in" onPress={() => router.back()} />
    </Screen>
  );
}
