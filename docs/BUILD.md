# Build and develop

For working on TaskFlow's code. To install and use the app, see [INSTALL.md](INSTALL.md); to publish it, see [DEPLOY.md](DEPLOY.md).

## What you need

- **Node.js** 22 (LTS) and **Git**.
- **The web app:** nothing else.
- **The Android app on your computer:** Android Studio with an emulator or a phone in developer mode. Or let GitHub Actions build the APK; every push does.
- **The database tests:** a Postgres server (17 is what CI uses) and `psql`.
- **The browser tests:** Python 3 with `pip install playwright`, then `python -m playwright install chromium`.

## First run

```bash
git clone https://github.com/ratnesh-lord/taskflow-app
cd taskflow-app
npm install
cp .env.example .env        # fill in the values; see the comments in the file
npm run web                 # the app at http://localhost:8081
```

Android needs a development build, because TaskFlow has its own native code (alarms, widgets, Google), which Expo Go does not contain:

```bash
npx expo run:android        # builds, installs and starts the app on the emulator or phone
```

## Checks

| Command | What it runs | Time |
| --- | --- | --- |
| `npm run check` | typecheck, lint (including the no-rounded-corners rule), unit and screen tests | about 1 minute |
| `npm run test:db` | the database tests and two simulated devices syncing through Postgres (needs `PG*` variables) | about 1 minute |
| `bash scripts/e2e/run.sh` | the web app in headless Chrome against a real database: 103 checks, served below `/taskflow-app` as on GitHub Pages | 3 to 5 minutes |
| `E2E_SCRIPT=profile.py E2E_SQL_TIMING=1 bash scripts/e2e/run.sh` | start-up, scrolling and ticking with a 2,000-task account; prints timings | 2 minutes |
| `E2E_SCRIPT=desktop.py bash scripts/e2e/run.sh` | every screen at desktop width, screenshots for checking by eye | 2 minutes |
| `PERF=1 npx jest src/data/perf` | the same large account in the app's rules and database, with a time budget for each (part of `npm run check`; `PERF=1` prints the times) | 10 seconds |
| `bash modules/taskflow-alarms/test-kotlin.sh` | the alarm and widget rules in Kotlin (needs `kotlinc`) | 1 minute |

Run `npm run check` before every commit; it includes the large-account time budgets. CI runs all of the above on every push, and adds the Android build and an emulator test (see [TESTING.md](TESTING.md)).

## Settings

The app reads these when it is built. Values starting `EXPO_PUBLIC_` end up inside the app, so they must be public ones.

| Name | Where it is set | What it is |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `.env`; GitHub variable | your Supabase project's address |
| `EXPO_PUBLIC_SUPABASE_KEY` | `.env`; GitHub variable | its **publishable** key (never the secret one) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | `.env`; GitHub variable (optional) | the Google Web application client, for Google in the browser |
| `TASKFLOW_WEB_BASE_URL` | CI only | the web app's sub-path, `/taskflow-app` on GitHub Pages; empty serves it at the root |
| `TASKFLOW_VERSION_CODE` | CI only | the Android build number (the CI run number), so each APK counts as an update |
| `TASKFLOW_KEYSTORE_BASE64` and the other three `TASKFLOW_KEY*` | GitHub secrets only | the release signing key (DEPLOY.md, step 2); never in a file in the repository |

## Building by hand

```bash
# The website, as GitHub Pages serves it
TASKFLOW_WEB_BASE_URL=/taskflow-app npx expo export --platform web --output-dir site
bash scripts/web/finish-export.sh site

# A release APK (needs the Android SDK); signed with the development key unless
# the TASKFLOW_UPLOAD_* variables point at a key (plugins/with-release-signing.js)
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

## Rules for the code

The project's rules are in [CLAUDE.md](../CLAUDE.md):

- **Square corners only**, and colours, type and spacing from `src/ui/tokens.ts`.
- **Business rules** go in `src/core`, in plain TypeScript, with tests beside them.
- **Migrations are only ever added,** never edited once applied.
- **No secret** ever goes in the app or the repository.
