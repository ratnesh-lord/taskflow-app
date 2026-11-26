# TaskFlow

A personal productivity app: tasks, reminders, projects, recurring work and home-screen widgets on Android, with a web view of the same data and cloud sync through Supabase. Built to run on free tiers.

**Status:** all ten phases are built. Tasks work offline on each device and sync between your devices, live: quick add in plain English, repeats, projects, categories, tags, subtasks, filters, search, export and restore. Reminders and daily summaries arrive as Android notifications with the app closed, and four home-screen widgets show and tick off tasks. Upcoming has day, week, month and agenda calendars where tasks are dragged to a new time. Optional Google integrations put tasks in Google Calendar, show your Google events, import and copy Google Tasks, and attach files from Drive. Under More, Plan my day, a weekly review, analytics, goals, habits, a focus timer, daily notes and an Eisenhower matrix help plan and look back. What has and has not been checked on a real phone is in [docs/PROGRESS.md](docs/PROGRESS.md).

| | |
| --- | --- |
| Android app (latest build) | https://github.com/ratnesh-lord/taskflow-app/releases/download/latest-build/taskflow-latest.apk |
| Web app | https://ratnesh-lord.github.io/taskflow-app/ (live once DEPLOY.md step 3 is done) |
| Install and use | [docs/INSTALL.md](docs/INSTALL.md) |
| First-time setup (Supabase, Google) | [docs/SETUP.md](docs/SETUP.md) |
| Release key and website | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Build and develop | [docs/BUILD.md](docs/BUILD.md) |
| How it is tested | [docs/TESTING.md](docs/TESTING.md) |
| Progress, decisions, what is left | [docs/PROGRESS.md](docs/PROGRESS.md) |
| Architecture and roadmap | https://claude.ai/artifact/VvnH5SCsdabhwWk7RtaeCJ |
| Screens and widgets (design) | https://claude.ai/artifact/VGHJYU7N4Q5gzhTjaMg4ZH |

## What is in the repository

```text
src/app/              screens and navigation (Android and web)
src/core/             pure TypeScript rules, no React: dates, repeats, quick add, Today and
                      Upcoming lists, filters, the edit clock, notifications, widgets,
                      calendar, Google, habits, focus timer, analytics, planning
src/data/             the on-device SQLite database: tables, every edit with undo, sync outbox
src/components/       task rows and lists, quick add, date, repeat and reminder pickers
src/platform/         Supabase client, encrypted session storage, sign-in, device registration
src/state/            session, theme, the current minute, the open database
src/ui/               design tokens and components (square corners, enforced by lint)
supabase/migrations/  tables, access policies, sync functions
supabase/tests/       database tests
scripts/db/           applies migrations to a database
modules/              native Android code: the alarm runtime and widgets, Google access
plugins/              build-time change to the Android project (release signing)
scripts/e2e/          drives the web app in Chrome against a real database; profile; desktop
scripts/ci/           checks used by GitHub Actions: app settings, signing, emulator
scripts/web/          prepares the web build for GitHub Pages
.github/workflows/    tests and APK build, website, migrations, daily maintenance
```

## Getting the app onto your phone

1. Do [docs/SETUP.md](docs/SETUP.md) once (about 30 minutes, all free), then [docs/DEPLOY.md](docs/DEPLOY.md) (about 20 minutes).
2. Install from the link above on the phone. Every merge to `main` publishes a new build. Details are in [docs/INSTALL.md](docs/INSTALL.md).

## Working on it

See [docs/BUILD.md](docs/BUILD.md). In short:

```bash
npm install
cp .env.example .env      # then fill in the two values
npm run web               # the app in a browser
npm run check             # typecheck, lint, unit and screen tests (before every commit)
```
