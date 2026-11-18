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

### Fixed after the first phone test

- **Password reset never finished (from Phase 2).** After a reset link signed the user in, the app tried to open the main screen, which stays closed until a new password is set. It fell back to the link screen, which then said "That link did not contain a sign-in code". It now waits for the sign-in to register and opens New password. The web check now runs the whole reset with a stand-in for Supabase's reset service: request, link, new password, old password refused, new one accepted, the same link refused the second time.
- **Errors sent after the # in a link were lost on the phone.** The link screen now reads the whole link. A used or replaced link now says plainly that each link works once, for an hour, that a new request cancels the old ones, and offers "Get a new link".
- **The Show switch in Filter and sort was squeezed to a line on Android.** It now always takes the full width. Without it, "Status: Completed" combined with the default "Show: Open" matched nothing.
- **New: the four counts on Today are filters.** Tap Scheduled, Done, Pending or Overdue to see only those tasks; tap it again, or Show all, for everything.

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

## Phase 3: tasks on the device (code complete; needs a phone check)

### What works

- **Storage on the device.** Each account gets its own SQLite database on the phone (and in the browser), so tasks open instantly and work with no connection. Every change is one transaction that records which fields changed and when, and queues the edit for Phase 4 to send. Nothing is sent yet.
- **Quick add** from Today, Inbox, Upcoming, Projects, a project and All tasks. It reads plain English as you type and shows what it understood; tap a recognised piece to keep it as words. The brief's sentence "Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before" becomes that title, tomorrow at 19:00, and a reminder 30 minutes before. It also reads weekdays, dates such as 25/12, "in 3 days", repeats ("every weekday", "every mon, wed and fri", "every other week"), priorities (p1, !high, "high priority"), #tags, @project and estimates ("45 min").
- **Tasks.** Title, description, notes, status (Inbox, Not started, In progress, Waiting, Completed, Archived), priority (Critical, High, Medium, Low), due date and time, project, category, tags, estimate, subtasks, web and Google Drive links, reminders. Complete, reopen, duplicate, delete, reschedule. The editor saves as you type.
- **Repeats.** Every day, weekday, week, month or year, every N of any of those, chosen weekdays, and an optional last day. Completing one time records it and moves to the next; completing a late one also marks the missed times as skipped, so the list does not fill with old copies. A single time can be skipped or moved without changing the rest. "Every month on the 31st" falls on the last day of shorter months.
- **Screens.** Today (date, scheduled, done, pending, overdue, completion, next reminder; overdue, today and done lists in time order). Inbox. Upcoming for tomorrow, 7 or 30 days, including later repeats. Projects with progress, open and overdue counts and deadline; a project screen to rename, set a deadline, archive or delete (its tasks are kept). All tasks with search, filters (show open, completed or both; due; priority; status; project; category; tags), sorting and saved filters. Search. Completed, by the day each task was done. Categories.
- **Bulk edit.** Long-press a task to select it, tap others to add them, then complete, reschedule, set priority, move to a project or delete them together.
- **Undo** after every change, from the message at the bottom of the screen.
- **Overdue rule (scenario 11).** A task is overdue once its day has passed, or on its day once its time has passed. Today's count of overdue tasks counts earlier days only; a task due earlier today that is late stays in the Today list, marked red.

### How it was checked

- 141 unit tests pass, including 62 quick-add sentences, every repeat rule compared against a brute-force calendar walk over 300 cases, the overdue rule, the Today counts, and the device database (run against real SQLite through Node).
- 57 web end-to-end checks pass in headless Chrome. New in this phase: the brief's quick-add sentence, an overdue task appearing and being completed and undone, a daily repeat completed with its next days still listed, editing a task, filtering by priority and saving the filter, a project reaching 100%, everything still there after a full page reload, the tab bar staying on screen with a long list, and a second browser tab explaining that the tasks are open in the first.
- 197 database assertions still pass; no migration changed.

### Not yet proven

- **On the phone.** The screens have been driven only in a browser. The APK now includes the SQLite module; GitHub Actions builds it. The phone checklist in [TESTING.md](TESTING.md) covers what to try.
- **Reminders do not alert yet.** They are saved with each task and shown as "Next reminder" on Today; phone alerts arrive in Phase 5, and the reminder sheet says so.
- **Tasks stay on the device where they were made** until Phase 4. Signing in on a second device shows that device's own (empty) list.

### Decisions in this phase

- Search looks for every typed word in titles, descriptions and notes on the device, so it works offline. The Phase 1 document planned a full-text index in the database; it is not needed while search runs on the device.
- A repeating task is one task plus one small record per completed, skipped or moved time, so completing a repeat never creates a new task and no future time can be lost. A moved time is stored as "skipped" plus the day it moved to; no table changed.
- New tasks go to the Inbox unless they have a date, project or category. Giving an Inbox task any of those moves it out.
- On the web the tasks can be open in one browser tab at a time (a limit of the browser storage SQLite uses). A second tab says so and offers to reload. No special server headers are needed.

## Remaining work

- [x] Phase 3: tasks, subtasks, projects, categories, tags, statuses, recurrence rules, quick add with natural language, search, filters, bulk edit, on local SQLite
- [ ] Phase 4: outbox, full push and pull, live updates, conflict handling on devices, export and restore
- [ ] Phase 5: Kotlin alarm runtime, notification actions, reboot and timezone handling, daily and evening summaries, wake-up push
- [ ] Phase 6: four home-screen widgets
- [ ] Phase 7: calendar views, drag to reschedule, Google Calendar, Drive and Tasks
- [ ] Phase 8: analytics, daily planning, weekly review, goals, habits, focus timer, notes, Eisenhower matrix
- [ ] Phase 9: all twelve scenarios on the phone, performance and battery review, desktop layout polish
- [ ] Phase 10: release signing key, web deployment, final documentation

Smaller items carried forward:

- [ ] Drag to reorder tasks within a list (the order is stored; there is no drag handle yet)
- [ ] Colours for projects and categories (stored; no picker yet)

- [ ] Account deletion from inside the app (the database already cascades; the server function and the Settings screen are not written)
- [ ] Attachment uploads (the storage bucket and its policies exist)
- [ ] A native Google account picker in place of the browser tab
- [ ] Embed the fonts at build time so the first launch does not wait for them
