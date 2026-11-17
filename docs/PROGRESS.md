# Progress

Updated at the end of each phase: what works, how it was checked, and what is left.

## Phase 1: architecture and UI design (done)

- Architecture, sync and notification design, database design, screen structure, design tokens and roadmap: https://claude.ai/artifact/VvnH5SCsdabhwWk7RtaeCJ
- Mockups of Today (light and dark), task detail, quick add and the four widgets: https://claude.ai/artifact/VGHJYU7N4Q5gzhTjaMg4ZH

## Phase 2: database and authentication (code complete; needs your setup and phone check)

### What works

- **Database.** Twelve synced tables plus devices, per-user revisions and a 90-day change history. Row-level security on every table. The app can mark rows deleted but cannot remove them.
- **Sync functions.** `sync_push` merges edits field by field using device timestamps. `sync_pull` returns changes after a revision, in pages. `purge_expired` removes old tombstones and history and tells stale devices to resync.
- **Accounts.** A profile is created with each account. Email and password sign-up and sign-in, password reset, and Google sign-in through the browser. The session is stored in Android's encrypted storage.
- **App shell.** Sign-in screens, five tabs with a square tab bar, light and dark themes (System, Light, Dark), a connection check on the More screen. Runs on Android and in a browser from the same code.
- **Design rules in code.** All colour, type and spacing come from `src/ui/tokens.ts`. Lint fails on any border radius.
- **Automation.** CI runs database tests, app tests, a web end-to-end check and an Android build. One workflow applies migrations to your Supabase project; another does the nightly keep-alive, purge and encrypted backup.

### How it was checked

- 197 database assertions pass on Postgres 16 (locally) and are set to run on Postgres 17 in CI.
- 37 unit and screen tests pass.
- 30 web end-to-end checks pass in headless Chrome against a real Postgres.
- 17 checks of the app-settings check, against a stand-in for Supabase's sign-in service.
- The Android JavaScript bundle builds, and `expo prebuild` generates the Android project with the `taskflow://` link registered.

### Not yet proven

- **The APK itself.** It cannot be compiled where the code was written; GitHub Actions does it. The first build may need fixes.
- **Anything that needs your Supabase project:** real sign-in, Google sign-in, the migration workflow against Supabase, the maintenance workflow. Each is a line in the phone checklist in [TESTING.md](TESTING.md) or a step in [SETUP.md](SETUP.md).

### Fixed after release (17 November)

- Manual runs of the CI workflow built an APK but never published it; only pushes to `main` did. Manual runs on `main` now publish too, as the repository's **Latest** release rather than a pre-release.
- Both APKs built so far had an empty Supabase address and key, so they opened on "Not connected yet", and nothing flagged it. The Android build now checks both values first, asks the project whether it accepts the key, and stops a build from `main` within a minute if anything is wrong. It also refuses a secret key outright. The values may be saved as repository variables or as secrets.
- The first migration run failed because its connection string was the direct connection, which GitHub's servers cannot reach; the session pooler string worked, and all five migrations are applied. The nightly job has since purged and saved an encrypted backup.

### Changes from the Phase 1 document

- Row-level security is enabled but not "forced". Forcing it would also bind the database owner, which the profile trigger and purge job run as; the app's roles are restricted either way.
- Screens live in `src/app/` rather than `app/` (the current Expo template's layout).
- Google sign-in uses the browser flow, so no Google client library or signing fingerprint is needed. A native account picker can replace it later.
- `reminders` and other tables carry no rule that compares two columns, because edits merge field by field; those rules live in the app's core.

## Remaining work

- [ ] Phase 3: tasks, subtasks, projects, categories, tags, statuses, recurrence rules, quick add with natural language, search, filters, bulk edit, on local SQLite
- [ ] Phase 4: outbox, full push and pull, live updates, conflict handling on devices, export and restore
- [ ] Phase 5: Kotlin alarm runtime, notification actions, reboot and timezone handling, daily and evening summaries, wake-up push
- [ ] Phase 6: four home-screen widgets
- [ ] Phase 7: calendar views, drag to reschedule, Google Calendar, Drive and Tasks
- [ ] Phase 8: analytics, daily planning, weekly review, goals, habits, focus timer, notes, Eisenhower matrix
- [ ] Phase 9: all twelve scenarios on the phone, performance and battery review, desktop layout polish
- [ ] Phase 10: release signing key, web deployment, final documentation

Smaller items carried forward:

- [ ] Account deletion from inside the app (the database already cascades; the server function and the Settings screen are not written)
- [ ] Attachment uploads (the storage bucket and its policies exist)
- [ ] A native Google account picker in place of the browser tab
- [ ] Embed the fonts at build time so the first launch does not wait for them
