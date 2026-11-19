# Testing

Seven layers of automated checks run on every push (GitHub Actions, workflow **CI**). After them comes a short checklist on the real phone, because some things only a phone can prove.

| Layer | What it proves | Run it yourself |
| --- | --- | --- |
| Database tests | Access rules, merging, paging, purge, concurrency, on a real Postgres with the project's migrations; then the app's sync engine with two devices against those same functions | `npm run test:db` (after `npm ci`) |
| Unit and screen tests | Dates, repeats, quick add, overdue and the Today counts, filters, the device database with undo, when to sync, export and restore, notification planning, Mark completed from a notification, the edit clock, sign-in link parsing, session storage, the sign-in and sign-up screens | `npm test` |
| Typecheck and lint | Types are sound; no rounded corner anywhere in the code | `npm run typecheck`, `npm run lint` |
| Web end-to-end | The built web app, driven in Chrome: sign in, password reset, quick add, overdue, complete and undo, repeats, editing, filters, projects, storage across a reload, a second browser syncing live, offline and back, a two-device merge, export and restore, dark mode, sign out | `bash scripts/e2e/run.sh` |
| App-settings check | The Android build's check of the Supabase address and key: missing, malformed, secret, or refused by the project | `bash scripts/ci/check-app-settings.test.sh` |
| Alarm runtime rules | The Kotlin alarm runtime's time-zone, due, late and summary rules, on an ordinary JVM | `bash modules/taskflow-alarms/test-kotlin.sh` (needs `kotlinc`) |
| Android build | The app, including the Kotlin alarm runtime, compiles and packages into an installable APK | GitHub Actions only |

## What the database tests cover

`supabase/tests/` holds four SQL files and one shell script. They run against a throwaway database created from a small stand-in for Supabase's roles and `auth` schema (`support/supabase_shim.sql`) plus every migration.

- **`01_access.test.sql`** is scenario 12 of the brief. For every synced table it checks that user A sees none of user B's rows, cannot update them, cannot insert rows owned by B, cannot attach rows to B's tasks or projects, and cannot hard-delete anything. It checks a signed-out visitor can read nothing. It ends by comparing a checksum of all of B's rows before and after.
- **`02_merge.test.sql`** is the database half of scenario 8. Two devices edit different fields (both survive), then the same field (the later edit wins, whichever arrives first, and the loser is kept in the history). It also covers deletes and restores, a phone with a wrong clock, invalid edits, a recurring occurrence completed on two devices, and the same tag created on two devices.
- **`03_pull.test.sql`** pages through changes ten at a time and checks every row arrives exactly once, then covers incremental pulls, tombstones, the 90-day purge and the forced resync that follows it.
- **`04_accounts.test.sql`** covers profile creation, device registration and account deletion.
- **`concurrency.sh`** runs two writers at the same moment and a reader between them, twice. It checks revisions are committed in order and the reader's cursor skips nothing.
- **`src/data/sync.db.test.ts`** (run last, through Jest) gives two simulated devices their own SQLite databases and syncs them through `sync_push` and `sync_pull` in the same throwaway database, as the signed-in user. It covers the cases listed under Phase 4 in [PROGRESS.md](PROGRESS.md), and checks the app's tables match the server's exactly.

To run them you need `psql` and a Postgres server you can create databases on:

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm run test:db
```

## What the web end-to-end check covers

`scripts/e2e/run.sh` builds the web app, starts a throwaway database, and starts `mock-supabase.mjs`: a stand-in sign-in service whose database calls are forwarded to that real Postgres as the signed-in user, with a small stand-in Realtime server that announces changes to the account. Headless Chrome then uses the app like a person would. Among its checks: the brief's quick-add sentence becomes the right title, time and reminder; a task dated three days ago is overdue and can be completed and undone; a daily repeat keeps its next seven days after one is ticked; filters and saved filters work; tasks survive a full reload; a second browser signed in to the same account gets every task and sees new ones appear by itself; a task written offline goes up when the connection is back; two browsers editing different fields of one task both keep both; export downloads a backup and restore brings back a deleted task; a wrong password is explained, dark mode survives a reload, signing out removes the device, and no element on any screen has a rounded corner.

It needs Chrome and `pip install playwright` in addition to the database requirements above. Screenshots are written to `/tmp/taskflow-e2e`.

It does not cover Google sign-in, the real Supabase sign-in service or the real Realtime service; the phone checklist does.

## Phone checklist for Phase 5

Install the newest APK over the old one and open it once.

- [ ] **More → Reminders and summaries.** Notifications, On-time alarms and Battery each show a tick, or a button: tap it and allow. For Battery choose Unrestricted. Planned shows a number of notifications.
- [ ] Tap **Send a test reminder in 10 seconds**, then close the app completely (swipe it away from recent apps). The test notification arrives.
- [ ] Quick add a task due about 5 minutes from now with a reminder 2 minutes before, for example *Stretch today at 6:45pm and remind me 2 minutes before*. Close the app. The reminder arrives on time with Mark completed and two Snooze buttons.
- [ ] Tap **Mark completed** on it. Open the app: the task is under Done today, and on the computer too.
- [ ] Do the same with another task and tap **Snooze 10 min**: it comes back 10 minutes later.
- [ ] Set a reminder about 10 minutes ahead, then restart the phone and do not open the app. The reminder still arrives.
- [ ] Set the **Morning plan** to the next half hour (More → Reminders and summaries). At that time a notification lists today's and overdue tasks.
- [ ] On the computer, add a task due in two hours with a reminder 1 hour before. Leave the phone app closed. Note when (or whether) the phone's reminder arrives; this shows how often your phone lets the background sync run.
- [ ] Optional: in Android settings turn off automatic time zone and pick another zone. A reminder set for a clock time arrives at that clock time in the new zone.

## Phone checklist for Phase 4

Install the newest APK over the old one. For the two-device steps, run the web app on your computer (`npm run web`, as in [SETUP.md](SETUP.md)) and sign in with the same account.

- [ ] Open the app and go to **More**. Within a few seconds the Sync section says "Synced with your account at …" and "Every change on this device has been sent." (Your Phase 3 tasks have just gone up.)
- [ ] Sign in on the computer: the phone's tasks are all there, with the same dates, times and completions.
- [ ] With both open, add a task on the computer. Without touching the phone, it appears there within a few seconds. Then the other way round.
- [ ] Turn on aeroplane mode, add a task on the phone: Today says it is not synced and the change will go up later. Turn aeroplane mode off and come back to the app: within a few seconds the task is on the computer.
- [ ] Open the same task on both. Change its priority on the phone and its notes on the computer: after a few seconds both show both changes.
- [ ] **More → Export all data**: the share sheet opens; save the file to Files or Drive. Delete a task, then **Restore from a backup** with that file: the task comes back, on the computer too.

## Phone checklist for the fixes after Phase 3

- [ ] Sign out, tap **Forgot password**, send a link, and open the email on the phone. Tap its button once: the app opens **New password**. Save one, and you are signed in.
- [ ] Tap the same email's button again: the app says the link no longer works and offers **Get a new link**.
- [ ] On Today, tap **Done**: only "Done today" is listed. Tap **Show all** to see everything again.
- [ ] In All tasks, open **Filter and sort**: the Open / Completed / Both switch shows three readable options.

## Phone checklist for Phase 3

Install the newest APK (it installs over the old one). Each line is something only the phone can show.

- [ ] Tap **+** on Today and type: *Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before*. The preview shows tomorrow, 7 pm and "30 min before". Add it: it appears in Upcoming under tomorrow.
- [ ] Turn on aeroplane mode, add two tasks, complete one, close the app completely and reopen it: both are there, one done.
- [ ] Type *Water the plants every day*, add it, tick it on Today. It moves to "Done today", and Upcoming still lists it for each of the next days.
- [ ] Long-press a task, tap two more, and use the bar at the bottom to move all three to tomorrow. Undo puts them back.
- [ ] Open a task, type in Notes, press the phone's back button straight away, open the task again: the note is kept.
- [ ] Rotate the phone, and use it in dark mode: nothing is cut off or unreadable.

## Phone checklist for Phase 2

Run these on the phone after [setup](SETUP.md). Each line is something no automated check here can reach.

- [ ] The APK installs and opens to the sign-in screen, with square corners and the Inter typeface.
- [ ] Create an account with email and password. If email confirmation is on, the link in the email opens the app and signs you in.
- [ ] Sign out, then sign in with the same email and password.
- [ ] **Continue with Google** opens a browser tab, and choosing an account returns to the app signed in.
- [ ] **Forgot password** sends an email; its link opens the app on the New password screen; the new password works.
- [ ] **More > Check connection** shows four green ticks.
- [ ] Close the app completely and reopen it: still signed in.
- [ ] Switch the phone to dark mode: the app follows. Choose Light in More: the app stays light.
- [ ] Sign in on the web build or a second device with the same account, run the connection check there, and confirm both show the same account.

## The brief's twelve scenarios

| # | Scenario | Status |
| --- | --- | --- |
| 1 to 3 | Notifications: delivery, app closed, after restart | Planning and the runtime's rules tested now; firing only on the phone (checklist above) |
| 4, 5 | Complete from the widget; widget changes sync | Phase 6 |
| 6, 7 | Create offline; sync on reconnect | Tested now: sync engine against the database, and two browsers in the web check; phone checklist below |
| 8 | Edit the same task on two devices | Tested now: database rules, sync engine with two devices, two browsers; phone checklist below |
| 9 | Recurring tasks | Repeat rules, completing, skipping and moving one time tested now (unit and web); calendar views in Phase 7 |
| 10 | Timezone change | Runtime rules tested now (wall-clock times, fixed zones, daylight-saving gap); on the phone in the checklist above |
| 11 | Overdue calculation | Tested now: unit tests of the rule and the Today counts, and the web check |
| 12 | Users cannot access other users' tasks | Tested now, automatically, on every push |
