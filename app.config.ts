import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App configuration. Values that differ between builds come from environment
 * variables (see .env.example); everything else is fixed here.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TaskFlow',
  slug: 'taskflow',
  version: '0.2.0',
  orientation: 'portrait',
  scheme: 'taskflow',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  android: {
    package: 'com.ratnesh.taskflow',
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
        dark: { backgroundColor: '#101010', image: './assets/images/splash-icon-dark.png' },
      },
    ],
  ],
});
