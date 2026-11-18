import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setWebFocusStyle } from '@/platform/focus-style';
import { SessionProvider, useSession } from '@/state/session';
import { ThemeProvider, useTheme } from '@/state/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <RootNavigator fontsReady={fontsLoaded || fontError != null} />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Which screens exist depends on the session:
 *   signed in      the app
 *   signed out     sign in, create account, reset password
 *   recovery       set a new password (arrived through a reset link)
 *   unconfigured   an explanation of what the build is missing
 * A screen whose guard is false cannot be reached, even by a deep link.
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useSession();
  const { colors, scheme } = useTheme();
  const ready = fontsReady && status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  useEffect(() => {
    setWebFocusStyle(colors.accent);
  }, [colors.accent]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
          contentStyle: { backgroundColor: colors.background },
        }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'recovery'}>
          <Stack.Screen name="update-password" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'unconfigured'}>
          <Stack.Screen name="setup" />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" />
      </Stack>
    </>
  );
}
