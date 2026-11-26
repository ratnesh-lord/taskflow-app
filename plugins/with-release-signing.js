// Signs release builds with TaskFlow's own key when one is provided.
//
// The Android project is generated (npx expo prebuild), and its template signs
// release builds with React Native's shared debug key, which anyone can use.
// This plugin rewrites android/app/build.gradle so that a release build:
//   - is signed with the key in TASKFLOW_UPLOAD_STORE_FILE, when that variable
//     is set at build time, using TASKFLOW_UPLOAD_STORE_PASSWORD,
//     TASKFLOW_UPLOAD_KEY_ALIAS and TASKFLOW_UPLOAD_KEY_PASSWORD;
//   - otherwise keeps the debug key (builds of pull requests, the emulator
//     test, a build on your computer).
// The values are read by Gradle when it builds, so no password or key path is
// ever written into a file. CI decodes the key from the TASKFLOW_KEYSTORE_BASE64
// secret (docs/DEPLOY.md).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// TaskFlow release signing';

function patch(gradle) {
  if (gradle.includes(MARK)) return gradle;

  const signingConfigs = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
  if (!signingConfigs.test(gradle)) throw new Error('with-release-signing: no signingConfigs { debug { … } } block in app/build.gradle');
  gradle = gradle.replace(
    signingConfigs,
    `$1
        ${MARK}: used only when TASKFLOW_UPLOAD_STORE_FILE is set (see plugins/with-release-signing.js).
        release {
            if (System.getenv('TASKFLOW_UPLOAD_STORE_FILE')) {
                storeFile file(System.getenv('TASKFLOW_UPLOAD_STORE_FILE'))
                storePassword System.getenv('TASKFLOW_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('TASKFLOW_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('TASKFLOW_UPLOAD_KEY_PASSWORD')
            }
        }`,
  );

  const releaseSigning = /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/;
  if (!releaseSigning.test(gradle)) throw new Error('with-release-signing: no "signingConfig signingConfigs.debug" in the release build type');
  gradle = gradle.replace(
    releaseSigning,
    `$1signingConfig System.getenv('TASKFLOW_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
  );
  return gradle;
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('with-release-signing: app/build.gradle is not Groovy');
    mod.modResults.contents = patch(mod.modResults.contents);
    return mod;
  });

module.exports = withReleaseSigning;
module.exports.patch = patch;
