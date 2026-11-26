import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The web app's sub-path, for hosting it below a site's root, e.g.
 * "/taskflow-app" on GitHub Pages. Empty (the default) serves it at the root.
 */
function webBaseUrl(): string | undefined {
  const value = (process.env.TASKFLOW_WEB_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!value) return undefined;
  if (!/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(value)) {
    throw new Error(`TASKFLOW_WEB_BASE_URL must look like /taskflow-app (got "${value}").`);
  }
  return value;
}

/**
 * App configuration. Values that differ between builds come from environment
 * variables (see .env.example); everything else is fixed here.
 */
function versionCode(): number {
  const n = Number(process.env.TASKFLOW_VERSION_CODE ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 2_100_000_000) throw new Error(`TASKFLOW_VERSION_CODE must be a whole number from 1 (got "${process.env.TASKFLOW_VERSION_CODE}").`);
  return n;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TaskFlow',
  slug: 'taskflow',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'taskflow',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  android: {
    package: 'com.ratnesh.taskflow',
    // Each published build gets a higher number (CI passes its run number), so
    // Android always treats a new APK as an update.
    versionCode: versionCode(),
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  experiments: { baseUrl: webBaseUrl() },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    './plugins/with-release-signing',
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
