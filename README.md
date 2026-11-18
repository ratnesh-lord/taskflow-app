# TaskFlow

A personal productivity app: tasks, reminders, projects, recurring work and home-screen widgets on Android, with a web view of the same data and cloud sync through Supabase. Built to run on free tiers.

**Status:** Phase 3 of 10. Tasks work fully on one device, offline: quick add in plain English, repeats, projects, categories, tags, subtasks, filters and search. Syncing them between devices is Phase 4, and phone alerts for reminders are Phase 5. See [docs/PROGRESS.md](docs/PROGRESS.md).

| | |
| --- | --- |
| Architecture and roadmap | https://claude.ai/artifact/VvnH5SCsdabhwWk7RtaeCJ |
| Screens and widgets (design) | https://claude.ai/artifact/VGHJYU7N4Q5gzhTjaMg4ZH |
| First-time setup | [docs/SETUP.md](docs/SETUP.md) |
| How it is tested | [docs/TESTING.md](docs/TESTING.md) |

## What is in the repository

```text
src/app/              screens and navigation (Android and web)
src/core/             pure TypeScript rules, no React: dates, repeats, quick add, Today and
                      Upcoming lists, filters, the edit clock, sign-in link parsing
src/data/             the on-device SQLite database: tables, every edit with undo, sync outbox
src/components/       task rows and lists, quick add, date, repeat and reminder pickers
src/platform/         Supabase client, encrypted session storage, sign-in, device registration
src/state/            session, theme, the current minute, the open database
src/ui/               design tokens and components (square corners, enforced by lint)
supabase/migrations/  tables, access policies, sync functions
supabase/tests/       database tests
scripts/db/           applies migrations to a database
scripts/e2e/          drives the web app in Chrome against a real database
.github/workflows/    tests and APK build, migrations, daily maintenance
```

## Getting the app onto your phone

1. Follow [docs/SETUP.md](docs/SETUP.md) once (about 30 minutes, all free).
2. Every push to `main`, and every manual run of the CI workflow on `main`, publishes an APK. On the phone, open
   https://github.com/ratnesh-lord/taskflow-app/releases/download/latest-build/taskflow-latest.apk
   and open the download.

## Working on it

```bash
npm install
cp .env.example .env      # then fill in the two values
npm run web               # the app in a browser
npm run check             # typecheck, lint, unit and screen tests
npm run test:db           # database tests (needs a local Postgres; see docs/TESTING.md)
```

Android needs a development build, because the app uses native code that Expo Go does not contain: `npx expo run:android` with Android Studio installed, or let GitHub Actions build the APK.
