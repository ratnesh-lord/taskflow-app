import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { completeAuthFromUrl } from '@/platform/auth';
import { isConfigured } from '@/platform/env';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/**
 * Where Supabase sends the user back to after Google sign-in, an email
 * confirmation or a password-reset link: taskflow://auth-callback on the
 * phone, /auth-callback on the web.
 */
export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [error, setError] = useState<string | null>(null);

  // The address is read once, when the screen opens.
  const [url] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.href;
    const query = Object.entries(params)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `taskflow://auth-callback?${query}`;
  });

  useEffect(() => {
    let alive = true;
    if (!isConfigured) {
      router.replace('/');
      return;
    }
    completeAuthFromUrl(url).then((outcome) => {
      if (!alive) return;
      if (outcome.ok) router.replace('/');
      else setError(outcome.message);
    });
    return () => {
      alive = false;
    };
  }, [router, url]);

  return (
    <Screen narrow bottomInset>
      <View style={{ gap: space.lg, paddingTop: space.xxl }}>
        <Text variant="title" accessibilityRole="header">
          {error ? 'Sign-in did not finish' : 'Signing you in…'}
        </Text>
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <Button label="Back to sign in" onPress={() => router.replace('/')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
