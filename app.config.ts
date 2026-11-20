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
    [
      'expo-build-properties',
      {
        android: {
          // Release builds are shrunk by R8, which removed the constructor WorkManager
          // (used by expo-background-task) calls by reflection to open its database:
          // the Phase 5 build stopped at launch. Keep Room databases' constructors.
          extraProguardRules: [
            '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
            '-keep class androidx.work.impl.WorkDatabase_Impl { *; }',
          ].join('\n'),
        },
      },
    ],
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
