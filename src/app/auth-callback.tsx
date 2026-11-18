import * as Linking from 'expo-linking';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { completeAuthFromUrl } from '@/platform/auth';
import { isConfigured } from '@/platform/env';
import { useSession } from '@/state/session';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/**
 * Where Supabase sends the user back to after Google sign-in, an email
 * confirmation or a password-reset link: taskflow://auth-callback on the
 * phone, /auth-callback on the web.
 *
 * Supabase puts some answers after a # (errors, and sign-ins without a code).
 * The router's parameters drop that part, so on the phone the screen reads the
 * whole link the app was opened with.
 */
export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const linkingUrl = Linking.useLinkingURL();
  const { status, beginRecovery } = useSession();
  const [signedIn, setSignedIn] = useState(false);
  const [result, setResult] = useState<{ url: string; message: string; newLink: boolean } | null>(null);

  // On the web the page address is read once: signing in changes it afterwards.
  const [webUrl] = useState(() => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null));

  const url = useMemo(() => {
    if (webUrl) return webUrl;
    if (linkingUrl && linkingUrl.includes('auth-callback')) return linkingUrl;
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `taskflow://auth-callback?${query}`;
  }, [webUrl, linkingUrl, params]);

  useEffect(() => {
    let alive = true;
    if (!isConfigured) {
      router.replace('/');
      return;
    }
    completeAuthFromUrl(url).then((outcome) => {
      if (!alive) return;
      if (outcome.ok) {
        if (outcome.recovery) beginRecovery();
        setSignedIn(true);
      } else {
        setResult({ url, message: outcome.message, newLink: !!outcome.newLink });
      }
    });
    return () => {
      alive = false;
    };
  }, [router, url, beginRecovery]);

  // A newer link replaces the message about an older one.
  const error = result && result.url === url ? result : null;

  // Leave only once the session says where to go, so the screen guards in
  // _layout.tsx already let the user in: a reset link leads to New password.
  if (signedIn && status === 'recovery') return <Redirect href="/update-password" />;
  if (signedIn && status === 'signedIn') return <Redirect href="/" />;

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.lg, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          {error ? 'That link did not work' : 'Signing you in…'}
        </Text>
        {error ? (
          <>
            <Notice tone="error">{error.message}</Notice>
            {error.newLink ? <Button label="Get a new link" onPress={() => router.replace('/reset-password')} /> : null}
            <Button variant={error.newLink ? 'secondary' : 'primary'} label="Back to sign in" onPress={() => router.replace('/')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
