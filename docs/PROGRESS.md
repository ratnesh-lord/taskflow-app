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

## Phase 3: tasks on the device (done; checked on the phone 18 November)

### What works

- **Storage on the device.** Each account gets its own SQLite database on the phone (and in the browser), so tasks open instantly and work with no connection. Every change is one transaction that records which fields changed and when, and queues the edit for Phase 4 to send. Nothing is sent yet.
- **Quick add** from Today, Inbox, Upcoming, Projects, a project and All tasks. It reads plain English as you type and shows what it understood; tap a recognised piece to keep it as words. The brief's sentence "Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before" becomes that title, tomorrow at 19:00, and a reminder 30 minutes before. It also reads weekdays, dates such as 25/12, "in 3 days", repeats ("every weekday", "every mon, wed and fri", "every other week"), priorities (p1, !high, "high priority"), #tags, @project and estimates ("45 min").
- **Tasks.** Title, description, notes, status (Inbox, Not started, In progress, Waiting, Completed, Archived), priority (Critical, High, Medium, Low), due date and time, project, category, tags, estimate, subtasks, web and Google Drive links, reminders. Complete, reopen, duplicate, delete, reschedule. The editor saves as you type.
- **Repeats.** Every day, weekday, week, month or year, every N of any of those, chosen weekdays, and an optional last day. Completing one time records it and moves to the next; completing a late one also marks the missed times as skipped, so the list does not fill with old copies. A single time can be skipped or moved without changing the rest. "Every month on the 31st" falls on the last day of shorter months.
- **Screens.** Today (date, scheduled, done, pending, overdue, completion, next reminder; overdue, today and done lists in time order). Inbox. Upcoming for tomorrow, 7 or 30 days, including later repeats. Projects with progress, open and overdue counts and deadline; a project screen to rename, set a deadline, archive or delete (its tasks are kept). All tasks with search, filters (show open, completed or both; due; priority; status; project; category; tags), sorting and saved filters. Search. Completed, by the day each task was done. Categories.
- **Bulk edit.** Long-press a task to select it, tap others to add them, then complete, reschedule, set priority, move to a project or delete them together.
- **Undo** after every change, from the message at the bottom of the screen.
- **Overdue rule (scenario 11).** A task is overdue once its day has passed, or on its day once its time has passed. Today's count of overdue tasks counts earlier days only; a task due earlier today that is late stays in the Today list, marked red.

### Fixed after the Phase 3 phone test

- **Password reset never finished (from Phase 2).** After a reset link signed the user in, the app tried to open the main screen, which stays closed until a new password is set. It fell back to the link screen, which then said "That link did not contain a sign-in code". It now waits for the sign-in to register and opens New password. The web check now runs the whole reset with a stand-in for Supabase's reset service: request, link, new password, old password refused, new one accepted, the same link refused the second time.
- **Errors sent after the # in a link were lost on the phone.** The link screen now reads the whole link. A used or replaced link now says plainly that each link works once, for an hour, that a new request cancels the old ones, and offers "Get a new link".
- **The Show switch in Filter and sort was squeezed to a line on Android.** It now always takes the full width. Without it, "Status: Completed" combined with the default "Show: Open" matched nothing.
- **New: the four counts on Today are filters.** Tap Scheduled, Done, Pending or Overdue to see only those tasks; tap it again, or Show all, for everything.

### How it was checked

- 141 unit tests pass, including 62 quick-add sentences, every repeat rule compared against a brute-force calendar walk over 300 cases, the overdue rule, the Today counts, and the device database (run against real SQLite through Node).
- 57 web end-to-end checks pass in headless Chrome. New in this phase: the brief's quick-add sentence, an overdue task appearing and being completed and undone, a daily repeat completed with its next days still listed, editing a task, filtering by priority and saving the filter, a project reaching 100%, everything still there after a full page reload, the tab bar staying on screen with a long list, and a second browser tab explaining that the tasks are open in the first.
- 197 database assertions still pass; no migration changed.

### Not yet proven

- ~~On the phone.~~ Done: you ran the Phase 3 phone checklist and the fixes checklist on 18 November and both passed.
- **Reminders do not alert yet.** They are saved with each task and shown as "Next reminder" on Today; phone alerts arrive in Phase 5, and the reminder sheet says so.
- ~~Tasks stay on the device where they were made.~~ Phase 4 syncs them.

### Decisions in this phase

- Search looks for every typed word in titles, descriptions and notes on the device, so it works offline. The Phase 1 document planned a full-text index in the database; it is not needed while search runs on the device.
- A repeating task is one task plus one small record per completed, skipped or moved time, so completing a repeat never creates a new task and no future time can be lost. A moved time is stored as "skipped" plus the day it moved to; no table changed.
- New tasks go to the Inbox unless they have a date, project or category. Giving an Inbox task any of those moves it out.
- On the web the tasks can be open in one browser tab at a time (a limit of the browser storage SQLite uses). A second tab says so and offers to reload. No special server headers are needed.

## Phase 4: sync between devices (code complete; needs a phone check)

### What works

- **Everything syncs with your account.** Tasks, projects, categories, tags, subtasks, reminders, repeat records, links and saved filters. Edits made on the phone go up about 1.5 seconds after the last change; edits made elsewhere come down by themselves.
- **Live updates.** The app listens (through Supabase Realtime) for the account's revision number going up. When another device saved the change, this one pulls straight away. As a safety net it also syncs when the app comes back to the front, when a browser comes back online, and every five minutes while open.
- **Offline.** Every edit is saved on the device first and waits in a queue. Today shows "Not synced (No connection). 3 changes will go up when the connection is back." Failed attempts retry after 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min, and at once when you open the app again or tap **Sync now**.
- **Conflicts.** Edits merge field by field. Changing the title on the phone and the priority on the computer keeps both. When both change the same field, the later edit wins on every device, whichever syncs first. A field with an edit still waiting on this device is never overwritten by an incoming change.
- **A device that was away a long time** (more than the 90 days deleted items are kept) first sends what it has, then drops its copy and downloads everything again.
- **Sync status in More.** When it last synced, how many changes are waiting, **Sync now**, and a list of any changes the server refused (for example, a task whose project was deleted on another device), which then stay on that device only.
- **Signing out with unsent changes** asks once more: the changes stay on the device and go up at the next sign-in there.
- **Export and restore (More → Backup).** **Export all data** writes one JSON file (on the phone, through the share sheet, so you can save it to Files or Drive; in a browser, a download). **Restore from a backup** shows what the file holds, then brings each item back to how it was in the file, including ones deleted since. Items made after the backup are left alone. A restore can be undone and syncs like any other change.
- **Time zone.** After the first sync, the account's time zone is set from the device (Phase 5 uses it for summaries).

### How it was checked

- **Two devices against the real database functions** (`src/data/sync.db.test.ts`, 11 tests, run by `npm run test:db` and in CI): every detail of a task arrives on the other device; different fields edited offline on two devices both survive; the later edit to the same field wins in both sync orders; deleting and undoing a delete reach the other device; one repeat ticked on two devices stays one record; a waiting field is not overwritten by a pull; 20 tasks made offline go up together; a device too far behind starts over without losing its own unsent task; a refused edit is listed as a problem; one account never receives another's tasks; and the app's tables match the server's columns, types and required fields exactly. Two deliberate breaks of the merge code were each caught by these tests.
- **Web end-to-end, 65 checks**, now with a second browser signed in to the same account and a stand-in Realtime server: tasks made in the first browser are in the database; the second browser gets all of them; a task added there appears in the first by itself; a task written offline waits, shows the offline line, then goes up and arrives; edits to two fields of one task in two browsers merge; export downloads a complete backup; a task deleted after it comes back on restore and in the database.
- 149 unit tests pass (the 11 two-device tests above run with the database tests), including the sync timing (debounce, one more run after asks during a sync, back-off, Sync now cutting a wait short) and export and restore.

### Not yet proven

- **On the phone, against your real Supabase project.** Realtime has only been tested against the stand-in server; the real one is the same protocol, but only the phone checklist in [TESTING.md](TESTING.md) proves it. The same goes for the share sheet and file picker used by export and restore, which are new Android modules in this APK.
- **Very large accounts.** Tested with dozens of tasks, not thousands. Pages of 1,000 changes and batches of 200 edits are designed for it, but not measured.

### Decisions in this phase

- Deleted items stay on the device (marked deleted) rather than being cleared after 90 days like on the server. They take little space; clearing them can come later.
- A restore merges rather than replacing everything, so nothing made after the backup is lost by mistake.
- The Phase 2 "Check connection" button is gone; the Sync section replaces it.

## Remaining work

- [x] Phase 3: tasks, subtasks, projects, categories, tags, statuses, recurrence rules, quick add with natural language, search, filters, bulk edit, on local SQLite
- [x] Phase 4: outbox, full push and pull, live updates, conflict handling on devices, export and restore
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
