import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { signInWithEmail, signInWithGoogle } from '@/platform/auth';
import { Button } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy('email');
    setError(null);
    const outcome = await signInWithEmail(email, password);
    setBusy(null);
    if (!outcome.ok) setError(outcome.message);
  }

  async function google() {
    if (busy) return;
    setBusy('google');
    setError(null);
    const outcome = await signInWithGoogle();
    setBusy(null);
    if (!outcome.ok && !outcome.cancelled) setError(outcome.message);
  }

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.xs, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          TaskFlow
        </Text>
        <Text variant="small" color="textSecondary">
          Sign in to see your tasks on this device.
        </Text>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}

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
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />

      <Button label="Sign in" busyLabel="Signing in…" busy={busy === 'email'} disabled={!canSubmit || busy === 'google'} onPress={submit} />
      <Button
        variant="secondary"
        label="Continue with Google"
        busyLabel="Waiting for Google…"
        busy={busy === 'google'}
        disabled={busy === 'email'}
        onPress={google}
      />

      <Divider />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Button variant="quiet" label="Create account" onPress={() => router.push('/sign-up')} style={{ paddingHorizontal: 0 }} />
        <Button variant="quiet" label="Forgot password" onPress={() => router.push('/reset-password')} style={{ paddingHorizontal: 0 }} />
      </View>
    </Screen>
  );
}
