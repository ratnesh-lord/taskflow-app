# Testing

Six layers of automated checks run on every push (GitHub Actions, workflow **CI**). After them comes a short checklist on the real phone, because some things only a phone can prove.

| Layer | What it proves | Run it yourself |
| --- | --- | --- |
| Database tests | Access rules, merging, paging, purge, concurrency, on a real Postgres with the project's migrations | `npm run test:db` |
| Unit and screen tests | Dates, repeats, quick add, overdue and the Today counts, filters, the device database with undo, the edit clock, sign-in link parsing, session storage, the sign-in and sign-up screens | `npm test` |
| Typecheck and lint | Types are sound; no rounded corner anywhere in the code | `npm run typecheck`, `npm run lint` |
| Web end-to-end | The built web app, driven in Chrome: sign in, quick add, overdue, complete and undo, repeats, editing, filters, projects, storage across a reload, dark mode, sign out, and a real push and pull through the database | `bash scripts/e2e/run.sh` |
| App-settings check | The Android build's check of the Supabase address and key: missing, malformed, secret, or refused by the project | `bash scripts/ci/check-app-settings.test.sh` |
| Android build | The app compiles and packages into an installable APK | GitHub Actions only |

## What the database tests cover

`supabase/tests/` holds four SQL files and one shell script. They run against a throwaway database created from a small stand-in for Supabase's roles and `auth` schema (`support/supabase_shim.sql`) plus every migration.

- **`01_access.test.sql`** is scenario 12 of the brief. For every synced table it checks that user A sees none of user B's rows, cannot update them, cannot insert rows owned by B, cannot attach rows to B's tasks or projects, and cannot hard-delete anything. It checks a signed-out visitor can read nothing. It ends by comparing a checksum of all of B's rows before and after.
- **`02_merge.test.sql`** is the database half of scenario 8. Two devices edit different fields (both survive), then the same field (the later edit wins, whichever arrives first, and the loser is kept in the history). It also covers deletes and restores, a phone with a wrong clock, invalid edits, a recurring occurrence completed on two devices, and the same tag created on two devices.
- **`03_pull.test.sql`** pages through changes ten at a time and checks every row arrives exactly once, then covers incremental pulls, tombstones, the 90-day purge and the forced resync that follows it.
- **`04_accounts.test.sql`** covers profile creation, device registration and account deletion.
- **`concurrency.sh`** runs two writers at the same moment and a reader between them, twice. It checks revisions are committed in order and the reader's cursor skips nothing.

To run them you need `psql` and a Postgres server you can create databases on:

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm run test:db
```

## What the web end-to-end check covers

`scripts/e2e/run.sh` builds the web app, starts a throwaway database, and starts `mock-supabase.mjs`: a stand-in sign-in service whose database calls are forwarded to that real Postgres as the signed-in user. Headless Chrome then uses the app like a person would. Among its checks: the brief's quick-add sentence becomes the right title, time and reminder; a task dated three days ago is overdue and can be completed and undone; a daily repeat keeps its next seven days after one is ticked; filters and saved filters work; tasks survive a full reload; a wrong password is explained, the connection check on the More screen passes, the pushed edit is really in the database with a history entry, dark mode survives a reload, signing out removes the device, and no element on any screen has a rounded corner.

It needs Chrome and `pip install playwright` in addition to the database requirements above. Screenshots are written to `/tmp/taskflow-e2e`.

It does not cover Google sign-in or the real Supabase sign-in service; the phone checklist does.

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
| 1 to 3 | Notifications: delivery, app closed, after restart | Phase 5 |
| 4, 5 | Complete from the widget; widget changes sync | Phase 6 |
| 6, 7 | Create offline; sync on reconnect | Phase 4 |
| 8 | Edit the same task on two devices | Database rules tested now; on devices in Phase 4 |
| 9 | Recurring tasks | Repeat rules, completing, skipping and moving one time tested now (unit and web); calendar views in Phase 7 |
| 10 | Timezone change | Phase 5 |
| 11 | Overdue calculation | Tested now: unit tests of the rule and the Today counts, and the web check |
| 12 | Users cannot access other users' tasks | Tested now, automatically, on every push |
