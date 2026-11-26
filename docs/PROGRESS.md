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

## Phase 4: sync between devices (done; checked on the phone 20 November)

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

## Phase 5: reminders and notifications (done; checked on the phone, one issue fixed in Phase 6)

### What works

- **An alarm runtime in Kotlin** (`modules/taskflow-alarms`), inside the app. Reminders are exact Android alarms that go off with the app closed, offline, in Doze, and after a restart. Only the next alarm is registered with Android at a time; when it goes off, everything due is shown and the next one is registered.
- **What gets planned.** The app plans every notification for the next 30 days whenever data changes (and when it starts, comes to the front, or runs in the background): each reminder before a due time (or before 09:00 on a day with no time), reminders set for an exact moment from quick add, every time of a repeating task, a **morning plan** (default 08:00: what is due today and anything overdue) and an **evening check** (default 21:00: today's tasks still open; skipped when there are none). At most 500 at a time.
- **Notification buttons.** Reminders have **Mark completed**, **Snooze 10 min** and **Snooze 30 min**; tapping the notification opens the task. Kotlin handles a button at once (the notification goes, a snooze is armed, later notifications about that task are dropped from the summaries) and queues a completion for the app, which saves it next time it runs, for exactly the day the notification was for. A second tap, or a tap after the task was done elsewhere, changes nothing.
- **Restarts, app updates, time and time zone changes** re-arm the alarms with no JavaScript involved. Times are wall-clock times, so a 7 PM task reminds at 7 PM in a new time zone. An alarm missed while the phone was off is shown if it is less than six hours late.
- **Background sync.** About every half hour, when Android allows (often less often while the phone is idle), the app syncs and replans with the app closed, so a reminder added on the computer reaches the phone's alarms without opening the app.
- **More → Reminders and summaries.** Whether notifications, on-time alarms and battery settings let reminders through, each with a button to fix it; how many notifications are planned and when the next one is; **Send a test reminder in 10 seconds**; the morning and evening times (or Off), kept in the profile so every device uses them. The notification permission is asked for when the first reminder is set.
- **Two notification channels**, Reminders and Daily summaries, so each can be silenced separately in Android's settings.

### How it was checked

- **The Kotlin runtime compiles into the APK** in GitHub Actions. Its rules (when an alarm goes off in which time zone, daylight-saving gaps, what is due, shown twice, too late, next, and the wording of summaries as tasks are ticked off) are plain Kotlin with 19 tests that run on an ordinary JVM, here and in CI (`bash modules/taskflow-alarms/test-kotlin.sh`). Breaking the six-hour rule on purpose was caught.
- **Planning** (`src/core/alarms.test.ts`, 11 tests): the brief's example (tomorrow 19:00, 30 minutes before, with project and buttons), Due now and Due tomorrow wording, no-time tasks, midnight and month ends, 30 daily reminders each tied to its own day, a repeat done today, completed and switched-off and passed reminders planning nothing, exact-moment reminders, morning and evening contents, settings, ordering and the 500 cap.
- **Mark completed from a notification** (5 tests): once only, the right day of a repeat, nothing for a deleted task; summary settings saved in the profile with undo.
- **Web check, 68 checks**, now including the Reminders page in a browser and the summary times reaching the account's database.

### Fixed after the first phone install

- **The app stopped at launch ("TaskFlow keeps stopping").** Release builds are shrunk by R8, which removed a constructor that WorkManager (brought in for background sync) calls by reflection, so the app failed before any of its own code ran. Keep rules for it are now added at build time. Found and confirmed with a new check: the release app is started on an Android 15 emulator in GitHub Actions on every pull request, sent the restart, time-zone and alarm signals the runtime listens for, and must still be running afterwards.

### Fixed after the Phase 5 phone test

- **A snoozed reminder still arrived after its task was completed or deleted.** A snooze was kept apart from the plan so that it would survive replanning, and nothing cancelled it. Now, whenever the app replans, it checks each waiting snooze and cancels it when the task was completed, deleted or archived, when that day of a repeating task was completed or skipped, or when the reminder itself was removed or switched off (4 new tests). Ticking the task on a notification or a widget cancels it straight away, with the app closed. One case remains: a task completed on the computer while the phone app has not run since; the snooze is cancelled at the phone's next sync.
- **Signing out now stops the account's reminders and clears the widgets.** Before, a signed-out phone kept the last plan of reminders. Found while fixing the snooze.

### Not yet proven

- **How often Android runs the background sync** on your phone. Android decides; Nothing OS may hold it back more than stock Android. The phone checklist measures it.

### Decisions in this phase

- **Wake-up push (Firebase) is not built yet.** It would make a reminder added on the computer reach the phone within seconds even when the phone app has not run for a while; today it takes until the next background run (about 30 minutes or more) or until the app is opened. It needs a free Firebase project and three secrets from you, plus a small server function. See Remaining work.
- Two notification channels instead of the four sketched in Phase 1: deadlines and overdue items are covered by the morning plan, and fewer channels are simpler to manage.
- A snooze stays on the phone that snoozed it; it is not synced.

## Phase 6: home-screen widgets (code complete; needs a phone check)

### What works

- **Four widgets**, as in the Phase 1 design, light and dark, square corners, Inter:
  - **Today's tasks** (4 × 2, can be made taller): the date, how many are left today and how many are overdue, then overdue tasks and today's in the Today screen's order, each with its time (or "Any", or the day it was due) and a priority mark. Tick a box to complete that task; tap a task to open it; **+** opens quick add; the arrows sync now.
  - **Pending** (2 × 2): tasks left today, then overdue, high priority, and the next deadline.
  - **Productivity** (2 × 2): today's percentage, done and left, a bar for each day of this week (today in blue), and the week's total.
  - **Next reminder** (4 × 1): the next reminder's task, time and day. It counts snoozes and skips anything ticked off.
- **The counts are the Today screen's.** Pending is open today, overdue is open from an earlier day, done is completed today, and the percentage is worked out the same way, so the widgets and the app never disagree.
- **With the app closed.** The app works out what the widgets show for today and tomorrow whenever its data changes and hands it to Kotlin. The widgets then draw on their own: just after midnight they switch to the next day, after each deadline they move on to the next one, and after each reminder they show the one after. They also redraw every 30 minutes, and whenever the background sync runs.
- **Ticking a task on the widget** works like Mark completed on a notification. The row disappears and the counts change at once, the task's reminders and snoozes stop, and the tick is saved and synced. With the app open this happens straight away. With the app closed, the tick starts the app's background work, which saves it and syncs it within seconds when the phone is online (or when it next is).
- **More → Home-screen widgets** describes the four widgets, shows which are on the home screen, and has **Add to home screen** buttons. Android then asks you to confirm and place the widget.
- **Appearance.** The widgets follow the app's Light, Dark or System setting. On System they switch with the phone's dark mode.
- **Signed out**, or before the app has run once, the widgets show a short message instead of tasks.

### How it was checked

- **Drawn by Android on an emulator.** The Android smoke test now draws every widget inside the release app, in light and dark, with and without data, the same way a launcher does, and saves pictures of them. The pictures were checked by eye: square corners, Inter, the Today screen's colours, rows lined up, and the overdue row in red. The test also checks that Android lists the four widgets. Finally it ticks a task on a widget with the app closed and checks that the tick was queued for the app and that the background work started (it did, within seconds) with no crash.
- **The widget rules in Kotlin** (`WidgetMath.kt`, 23 tests on an ordinary JVM): picking today or tomorrow after midnight, rows disappearing and counts moving when ticked (only the right day of a repeat), the percentage, the next deadline, when to redraw, the next reminder (skipping summaries, the test, past and ticked-off reminders, counting snoozes), and 12- and 24-hour times.
- **What the app sends** (`src/core/widgets.test.ts`, 6 tests): the Today screen's counts, overdue first, repeats, tomorrow as it will look after midnight, the week from Monday to Sunday, 12-hour times, and at most 20 rows.
- **Colours and sizes** are copied into Kotlin from `src/ui/tokens.ts`, and a test fails if the copy differs.
- Unit tests 178, web check 68, database tests all pass. The web app is unchanged apart from the Widgets page, which says widgets are part of the Android app.

### Not yet proven

- **On your phone's home screen.** No widget has been placed on a real launcher yet. The emulator check draws them inside the app, not on a home screen. Still to check on the phone: placing and resizing them, ticking a task, how soon the tick reaches the computer with the app closed, and the midnight switch.
- **Rounded corners from the launcher.** Android 12 and later can round widget corners. TaskFlow's widgets do not ask for it, but some launchers round every widget anyway. If yours does, that is the launcher and cannot be turned off from the app.
- **Nothing OS** may hold back the background work a tick starts. The tick is never lost: it waits in a queue until the app or the background sync runs.

### Decisions in this phase

- **The Next reminder widget shows the day ("Today", "Tomorrow", "Sat 28 Nov") instead of "in 5 h 50 min".** Widgets cannot redraw every minute without draining the battery, so a countdown would usually be wrong.
- **Overdue rows show the day they were due ("20 Nov")** in the time column. A fixed-width column keeps the titles lined up.
- The widgets are drawn by the same Kotlin module as the reminders, so a tick on a widget and Mark completed on a notification share one queue and one done list.

## Phase 7: calendar views, drag to reschedule, Google (code complete; needs your Google setup and a phone check)

### What works

- **Calendar views** under **Upcoming → Calendar**:
  - **Day:** an hour grid with an all-day row above it.
  - **Week:** Monday to Sunday in the same grid.
  - **Month:** six weeks with a mark for each task; tap a day to list it below.
  - **Agenda:** the next 30 days as a list.

  Tasks show as blue blocks, red when overdue, and grey and struck through when done. A task's length is its estimate (30 minutes if it has none). Overlapping tasks share the width, and a red line marks the current time.
- **Drag to reschedule.** Touch and hold a task (on a computer, press and hold the mouse), then drag it:
  - to another time (it snaps to quarter hours) or another day in the week view;
  - onto the all-day row to take its time off;
  - in the month view, from the day's list onto another day.

  A repeating task moves only that day, as when you move it in the editor. Undo puts it back. The grid scrolls when you hold the task near its top or bottom edge.
- **Tasks in Google Calendar** (one way). Tasks with a date appear in a calendar named **TaskFlow** that the app creates in your Google Calendar:
  - All-day tasks are all-day events. Timed tasks last their estimate.
  - Completed tasks stay, with a ✓.
  - Each day of a repeating task is its own event, so skipped, moved and completed days show exactly as in TaskFlow.
  - The calendar updates about 15 seconds after your tasks change, while TaskFlow is open on a device connected to Google. It covers 30 days back to 90 days ahead. With the app closed, the next update happens the next time it is opened.
  - Each event's id is made from the task (and day), so the same task never makes two events, whichever device sends it (test scenario 9).
- **Your Google events** appear, read-only, in the calendar views, from the calendars you show in Google Calendar. Tap one to open it in Google Calendar.
- **Google Tasks:**
  - **Import:** your first list goes to the Inbox, and each other list becomes a project of the same name. Dates, notes, completion and subtasks come across, and importing again adds only new tasks.
  - **Copy:** your open tasks go to a **TaskFlow** list. Copying again updates that list: new tasks are added, completed ones ticked and deleted ones removed. Tasks that came from Google Tasks are not copied back.
- **Drive attachments.** On a task, **Attach a file** uploads a file from the device (up to 25 MB) into a **TaskFlow attachments** folder in your Drive, and links it to the task. TaskFlow can see only the files it uploaded.
- **More → Google Calendar, Tasks and Drive** holds the switches, shows which Google account this device uses, and has **Disconnect**.
- **Your Google access stays on your devices.** The app asks Google for access on each device and keeps no token: Google Play services keeps it on the phone, and the browser keeps it in memory only. Nothing goes to Supabase or any other server. Each feature asks only for the narrowest permission it needs.

### How it was checked

- **Calendar rules** (`src/core/calendar.test.ts`, 16 tests): what each day holds, including repeats with skipped, moved and completed days; overlap columns; snapping a drop to quarter hours; and the ranges and steps of each view.
- **Moving one day of a repeat** from the calendar, against the device database (1 new test): it leaves the current day and the series alone, and refuses a day that is not part of the series or is already done.
- **Google rules** (`src/core/google.test.ts`, 15 tests): events for one-off and repeating tasks, ids Google accepts, which tasks are left out, sending only differences, placing your events in the phone's time zone, and Google Tasks import and copy.
- **Google service against an in-memory Google** (`src/data/google.test.ts`, 18 tests). The stand-in follows Google's documented answers: 409 for an event id that exists, 410 for a deleted event, paging, two-step uploads, expired tokens and a busy service. The tests cover:
  - creating the calendar once and then sending only changes;
  - a deleted task brought back with Undo, and two devices sending the same task;
  - recreating the calendar if you delete it, and leaving events older than 30 days alone;
  - your events, and import and copy for Google Tasks;
  - Drive uploads, the 25 MB limit, and disconnecting.

  Changing the code to drop the 409 handling or the 30-day limit made these tests fail.
- **In Chrome** (the web check, 78 checks, 10 new):
  - the day, week, month and agenda views;
  - dragging a task up three hours (16:00), then Undo;
  - dragging a repeating task from the all-day row onto 17:00;
  - dragging a task to the next day in the week view.

  The database was checked to hold the results. The web check also covers the Google page saying it is not set up when no web client ID is given.
- **Android build:** the new Google module compiles in CI, and the emulator check still starts the app and draws the widgets.

### Not yet proven

- **Anything against the real Google.** These checks cannot reach Google, and the tests use a stand-in. The first real run needs your Google Cloud setup ([SETUP.md](SETUP.md), section 6b) and the phone checklist in [TESTING.md](TESTING.md). The stand-in follows Google's documentation, which may differ from Google's actual answers in details.
- **Dragging on the phone.** Dragging was checked in Chrome with a mouse. Touch and hold on Android uses the same gesture library, but no drag has been tried there yet.
- **The web version's Google sign-in** (a pop-up) has not run, and needs a web client ID (SETUP.md 6b).
- **Two devices turning on "Tasks in Google Calendar" within the same few seconds** could each create a TaskFlow calendar before they sync. Delete the spare one in Google Calendar; the next update uses the remaining one.

### Decisions in this phase

- **One event per day of a repeating task**, not one repeating event: TaskFlow's repeats move a missing day (31 January → 28 February) where Google's rules would skip it, and skipped or moved days then need no exceptions.
- **One way only.** An event changed in Google Calendar is put back at the next update; TaskFlow is where tasks are edited. Likewise, the TaskFlow list in Google Tasks is a copy.
- **No calendar link rows for events.** Each update compares the calendar itself with what it should hold, which also cleans up after a device that went offline mid-update. The `calendar_links` table holds the Google Tasks links instead, so a second import or copy updates rather than duplicates.
- **The APK is still signed with the standard development key**, so the Android client uses that key's public fingerprint. Phase 10's release key needs its own Android client.

## Added after Phase 7: colour-coded tasks and task pictures (code complete; needs a phone check)

### What works

- **Colours.**
  - Each priority has a colour. The defaults are critical red, high orange, medium blue and low grey.
  - Each project can have a colour, chosen on its page; it also shows in the Projects list.
  - **More → Colours** sets what a task's colour follows (its priority, its project, or nothing) and lets you change each priority's colour.
  - A task shows its colour as a bar on the left of its row, as its block colour in the calendar, as its mark in the month view, and as a bar in the Today's tasks widget.
  - The priority square next to each task now uses the priority's colour. It is filled for critical and high, outlined for medium and low, so the difference does not depend on colour alone.
  - There are 11 colours to choose from. Each is checked to be readable with white text (light mode) or dark text (dark mode), and to stand out from the page.
  - The settings are saved to your account, so every device shows the same colours.
- **Pictures** (optional, one per task). On the task screen, **Picture** offers:
  - **Emoji:** 56 suggestions, or type any emoji.
  - **Clipart:** 49 simple drawings, such as Home, Work, Gym, Medicine, Bill, Study, Birthday and Travel. They are drawn in the task's colour. The drawings come from Lucide (ISC licence).
  - **Photo:** a photo from the device, cropped square and shrunk to 512 pixels. It is stored in your private Supabase Storage folder, which only your account can read, and shown through short-lived signed links.

  The picture shows before the title in lists and on the task screen.
- **The emoji goes where the title goes.** The emoji (or a clipart's own emoji, e.g. 🏋️ for Gym) starts the title in:
  - reminder notifications;
  - morning and evening summaries;
  - the Today's tasks widget;
  - the calendar views;
  - Google Calendar events.

  A photo has no emoji, so these show the plain title.

### How it was checked

- **Rules** (`src/core/appearance.test.ts`, 8 tests): default and chosen colours, priority versus project colouring, recognising emoji (including sequences, flags, keycaps and skin tones) and rejecting words, reading and writing the three kinds of picture, refusing malformed or foreign photo paths, and every clipart having a name, an emoji and a drawing.
- **Colours** (`src/ui/task-colors.test.ts`, 12 tests): every colour has 4.5:1 contrast with its text and 3:1 with the page, in light and dark.
- **Emoji in titles** (4 new tests): reminders, summaries, widget rows and Google events start with the emoji; a photo adds nothing. **Widget colours** (2 tests): each row carries its bar and priority colours for light and dark.
- **Device database** (4 new tests):
  - a task takes, changes and loses its picture, and nonsense is refused;
  - a project keeps its colour;
  - a database from before this change gains the new column and keeps its tasks;
  - a new install ends up with the same columns as an upgraded one.

  The database tests also pass with the new migration.
- **In Chrome** (84 checks, 6 new):
  - choosing an emoji, then a clipart, then a real JPEG through the file chooser, which is uploaded and shown through a signed link;
  - changing the high-priority colour, switching to colour by project, and giving a project a colour;
  - the database holding all of it.

  Screenshots were checked by eye.
- **Android:** the APK build and emulator check are in CI. The widget check draws rows with colour bars and emoji.

### Not yet proven

- **On the phone:**
  - The photo picker and the cropping screen (Android's own).
  - How emoji look in notifications and widgets (Android draws them in its own emoji style).
- **Photos need a connection to add.** Without one, TaskFlow says so and nothing changes. A photo already added shows a grey square while offline, until its link loads.
- **Replaced photos stay in storage.** They are kept so Undo and other devices still work; at about 50 KB each this costs little. A clean-up is in Remaining work.

### Before installing

This change adds a column to the database (migration 6). Merging the pull request runs **Apply database migrations** automatically. Wait for it to turn green before installing the new APK. Otherwise the phone's edits wait, unsent, with a sync problem shown, until it does.

## Phase 8: planning, review and productivity tools (code complete; needs a phone check)

Everything is under **More → Plan and review**. The Today screen is unchanged, as the roadmap required.

### What works

- **Plan my day.** Four steps on one page:
  1. Tasks overdue from earlier days, each with **Today** or **Move**.
  2. Today's tasks, with the total of their time estimates.
  3. Tasks to add to today: those without a date first (most important first), then the next seven days.
  4. A note for the day.

  **Done planning** marks the day as planned. The morning summary notification now opens this page.
- **Weekly review.** The last seven days: what got done (with a chart per day), the share of what was due that got done, focus time, and what slipped (each with **Tomorrow** or **Move**). Then each goal's progress, each habit's days met, the next seven days, and notes for the week. **Done reviewing** marks the week as reviewed.
- **Analytics.** Done today, this week (from Monday) and this month, and the overdue count. For the last 7 or 30 days:
  - the completion rate, meaning the share of tasks due in the period that were done;
  - charts of tasks completed and focus minutes per day (tap a bar for its number);
  - the busiest weekday;
  - tasks done by project and by priority;
  - each habit's current and best streak.

  The productivity widget now opens this page.
- **Goals.** A goal has a name, a note, an optional target date, a picture and a status (Active, Achieved or Dropped). Tasks link to it from the goal's page (**Link existing tasks**, or **+** for a new task) or from the new **Goal** row on each task. Its progress is the share of linked tasks that are done. A goal past its date with tasks still open shows in red. Deleting a goal keeps its tasks.
- **Habits.** A habit has a name, an emoji, a schedule and a target per day, such as "8 glasses". The schedule is every day, chosen weekdays, or "N days a week".
  - Tap **+1** (or **Done**) each time you do it, and **−** to take one back. A day counts once it reaches the target.
  - Each habit shows its last seven days as squares: full when done, half when partly done, red when missed, dashed on a rest day. It also shows its streak and how long ago it was last done.
  - An optional reminder time rings on the Android app, on each day the habit still needs doing. It stops for the day once you reach the target, and for the week once an "N days a week" habit is met.
  - Habits can be archived (history kept) or deleted (history removed).
- **Focus timer.** Choose a task (optional) and a length (15, 25, 45, 60 or 90 minutes), then start. A long break is suggested after every fourth session.
  - The clock counts down to the second. **Stop** ends a session early, and the time spent is recorded.
  - When a session ends, the page offers the next break, and breaks of 5, 10, 15 or 30 minutes can be started at any time.
  - **On Android**, the phone that started the session rings at the end, even with the app closed.
  - **In a browser**, the open tab shows a notification at the end, if you allow notifications.
  - Each task's page has **Focus on this task**.
- **Notes.** One note per day. Move between days with the arrows or a date picker, and search all notes. The weekly review's notes are listed here too.
- **Eisenhower matrix.** Open tasks are sorted into four boxes: Do now, Schedule, Delegate and Drop.
  - **Urgent** means overdue or due within two days. **Important** means critical or high priority.
  - **Move** sends a task to another box and says what will change. Moving into Important makes it high priority, and out of it makes it medium. Moving into Urgent makes it due today, and out of it due in a week.
  - Each move can be undone.
  - On a wide screen the boxes sit two by two.
- **Everything syncs.** Goals, habits, notes and focus sessions sync between devices and are included in export and restore, like tasks.

### How it was checked

- **Rules** (46 new tests in `src/core`):
  - Habits (19): schedules match exactly what the database accepts; done, partly done, missed and rest days; days before a habit was created are not counted as missed; streaks over days and over weeks; completion rates; reminder days; "time since".
  - Focus timer (8): running and finished sessions without any further write; stopping early; the clock; breaks; totals.
  - Matrix (4): the boxes, repeating tasks, and what each move changes.
  - Analytics (7): done counts, the completion rate, including repeats that were skipped or moved, and the per-project, per-priority and per-weekday figures.
  - Planning, review and goals (4).
  - Notifications (4): habit reminders, the focus end on the right phone only, and the morning summary opening Plan my day.

  Two of these rules were broken on purpose to confirm the tests catch it; they did.
- **Device database** (11 new tests): goals with Undo, habit logs adding up and being taken back, notes keeping one row per day, starting a session stopping the previous one, a matrix move undone in one step, and a backup that brings back a deleted goal, habit and its logs, and a note.
- **Server database** (new `05_productivity.test.sql`, plus additions to the access test):
  - each new table is private to its owner, and A cannot link to B's goal, log B's habit or time B's task;
  - two phones logging the same habit offline both count;
  - one day's note edited on two devices merges field by field;
  - schedules, targets and session lengths are checked;
  - the 90-day purge removes a deleted habit's logs and unlinks a deleted goal's tasks.
- **In Chrome** (102 checks, 18 new): a person's run through every new page, ending with a check that everything reached the database. Screenshots of each page were checked by eye, which found and fixed three things: days before a habit existed showing as missed, cut-off dates under the 30-day chart, and a "no sessions" message shown after a short session.
- **Android:** the APK build and emulator check run in CI.

### Not yet proven

- **On the phone:**
  - The focus timer ringing with the app closed.
  - Habit reminders.
  - The morning summary and the productivity widget opening their new pages.
  - The layout of the new pages on a real screen.
- **Habits cannot be ticked from a notification.** Tapping a habit reminder opens Habits.
- **A focus session started in a browser** rings only while that tab is open; no phone rings for it.
- **The matrix moves tasks with Move, not by dragging** between boxes.

### Decisions in this phase

- **One row per habit log, not a count per day.** Two devices adding glasses of water offline would otherwise overwrite each other's count. With one row each, they simply add up.
- **Notes are keyed by account and date.** Every device works out the same id for a day's note, so a note started offline on two devices becomes one note.
- **A focus session needs no write to finish.** Its end is worked out from its start and length. A phone that is off or offline at the end still records the session correctly, and the alarm plan knows when to ring.
- **The matrix stores nothing of its own.** Urgency and importance come from each task's date and priority, so a task's box is always consistent with what the rest of the app shows.

### Before installing

This phase adds five tables and one task field to the database (migration 7). Merging the pull request runs **Apply database migrations** automatically. Wait for it to turn green before installing the new APK.

## Phase 9: testing and optimisation (code complete; needs your 12-scenario phone run)

### What was done

- **Profiles with a large account.** 2,000 tasks with a year of daily repeats, habits and focus sessions. They are measured three ways, each with time budgets so a slowdown fails a check:
  - the app's rules and device database (`src/data/perf.test.ts`, part of `npm run check`);
  - the web app in Chrome (`scripts/e2e/profile.py`, its own CI job);
  - Android start-up on the emulator (`scripts/ci/android-startup.sh`).
- **What the profiles found, and the fixes:**
  - *Every edit re-read every table.* Ticking one task re-read 2,000 tasks and, for a repeating task, 15,000 to 29,000 repeat records. Now the database keeps a list of which rows changed, and the screens re-read only those.
  - *Sync wrote rows one at a time.* A first sign-in on a big account ran about 29,000 separate database statements in the browser. Rows now go in batches: about 300 statements.
  - *Screens were rebuilt after every page a sync brought down.* Refreshes caused by syncing now happen at most every 1.5 seconds; your own edits still show at once.
  - *Counting today's or this week's done tasks went through all history.* Only the days needed are read now.
  - *A long list was blank until every row was drawn.* The first 40 rows now show at once, and the rest a frame later.
- **Battery review.** Everything that could wake the phone or keep it busy was checked:
  - **Reminders:** one exact alarm at a time, for the next reminder only. This was already right.
  - **Background sync:** every 30 minutes, through Android's job scheduler, which holds it while the phone dozes and batches it with other apps. Kept: it keeps notifications and widgets current when another device changes something.
  - **Widgets:** each kind asked Android to update it every 30 minutes, which wakes a sleeping phone. That is up to about 190 wake-ups a day with all four placed. It is now off. The widgets still redraw on new data, at midnight, at the next deadline, after each reminder, after a restart and after an update, using an alarm that waits for the phone to be awake anyway.
  - **The minute clock and the focus timer's clock** kept running in the background, redrawing the screens for nobody. They now stop.
  - **The live-updates connection** stayed open in the background, with a heartbeat every 30 seconds keeping the radio awake. It now closes in the background and reopens on return, followed by the usual catch-up sync.
- **Desktop layout.** Every screen was captured at 1440 pixels wide and checked by eye.
  - On a wide window (1,024 pixels and up), the five tabs are now a **sidebar** on the left rather than a bar stretched along the bottom.
  - The time or day beside each task was cut off on every screen size ("Yester…", "12:30 …", "Mon 2…"). The column is now wider, and days use short forms: "Yesterday", "Wed", "23 Nov".
  - CI now captures every screen at desktop width on each push, and checks nothing is wider than the window and nothing has rounded corners.
- **The 12 scenarios:** a single phone run with one step per scenario, in [TESTING.md](TESTING.md), "Phase 9 phone run".

### Measurements

In Chrome, with 2,040 tasks and 14,600 repeat records (the "after" figures were measured both on the build machine and in CI):

| Step | Before | After |
| --- | --- | --- |
| Sign in until Today shows | 0.9 s | 0.9 s |
| ... until the whole account has arrived | 27 s | 15 to 17 s (about 10 s of it is the browser writing to disk) |
| Reload until Today's tasks show | 1.2 s | 1.1 to 1.6 s |
| Open a 400-task Inbox until the first task shows | 0.7 s | 0.4 to 0.7 s |
| Scrolling that list | 95% of frames within 21 ms | within 17 ms, no frame over 50 ms |
| Tick a task until Today shows it | 0.9 s | 0.5 to 0.6 s |
| Tick a repeating task until Today shows it | 1.7 s | 0.5 to 0.6 s |

In the app's rules and database (Node, same machine), with 2,000 tasks and 29,000 repeat records:

| Step | Before | After |
| --- | --- | --- |
| First load from the database | 279 ms | 139 to 155 ms |
| Reload after ticking a task | 279 ms | 30 to 44 ms |
| Today's lists | 27 ms | 5 ms |
| Widget data | 86 ms | 9 ms |
| Weekly review | 54 ms | 15 ms |

On the Android 15 emulator in CI (x86_64, signed out):

| Measure | Result |
| --- | --- |
| Cold start until Android's first frame, median of five | 391 ms (runs: 473, 392, 391, 385, 381) |
| Memory in use 20 seconds after a start | about 79 MB (PSS) |
| Alarms, background jobs and wake locks while idle | none |

These are for the signed-out app on an emulator. Android's "first frame" is the splash screen, before your task list is loaded. A signed-out app also schedules no reminders or background sync. Signed-in start-up and background activity are measured on the phone, in the Phase 9 phone run.

A phone may run the app's JavaScript several times slower than these machines (an estimate, not measured), so these figures are a guide, not phone numbers.

### How it was checked

- **New tests:**
  - a random sequence of 300 edits, undos, server changes and clears, after each of which the screens' copy of the data must equal a fresh read;
  - server rows in large batches, a row listed twice, and a field with an unsent edit;
  - days counted correctly across time zones (India, +5:30, and Hawaii, −10:00);
  - the label beside each task never longer than "Yesterday".

  Two deliberate breakages of the new caching were caught by the tests.
- **Totals:** 326 unit tests and the database tests pass, including two simulated devices syncing through Postgres. The web end-to-end test passes (103 checks), and so do the profile and desktop job and the Android build and emulator test, all in CI.
- **A flaky Phase 8 test fixed:** a database test sent three changes with the same edit time, so on a fast machine one could be counted as stale. It passed before by timing luck; each change now has its own time.

### Not yet proven

- **Everything in the Phase 9 phone run:** the brief's 12 scenarios, start-up and scrolling on your phone, and TaskFlow's share in Android's battery screen after a normal day.
- **Big accounts in the browser:** the first sign-in on a new computer takes about 15 to 20 seconds to bring down a year of history. Today shows within about 3 seconds while the rest arrives.

## Phase 10: deployment and documentation (code complete; needs your one-time setup)

### What was done

- **Release signing.**
  - A release key was made for TaskFlow and given to you as `taskflow-release-key.txt` and `taskflow-release.jks`. It is not in the repository.
  - With its four values saved as GitHub secrets, every build is signed with it. The build checks the signature, and the release notes give its SHA-1 fingerprint. Without the secrets, builds keep the development key and the release notes say so.
  - Each build also gets a higher build number, so Android always treats it as an update. The version is now 1.0.0.
- **The website.** After CI passes on `main`, the workflow **Publish the web app** builds the web app and publishes it on GitHub Pages, at https://ratnesh-lord.github.io/taskflow-app/. That needs no hosting account, because the repository is public.
  - The site lives below `/taskflow-app`, so the app was taught to build for a sub-path, and sign-in links now return there.
  - Opening any address directly works: Pages serves a copy of the app as its 404 page, and the app shows the right screen.
- **Guides:**
  - [INSTALL.md](INSTALL.md): install and use;
  - [BUILD.md](BUILD.md): develop and check;
  - [DEPLOY.md](DEPLOY.md): the release key, the website, sign-in addresses, moving the phone to the release build, and what to do if something goes wrong.
  
  README, SETUP, TESTING and `.env.example` are updated.

### How it was checked

- **Signing:** each emulator run builds the app signed with a throwaway key made in that job, checks the APK carries that key, and then runs the start-up and widget tests on it. The real key was checked to open with the values in your file.
- **Website:** the web end-to-end test now builds for `/taskflow-app` and serves it the way GitHub Pages does. All 103 checks pass there. That includes the app's code loading from below the sub-path, opening a deep address directly, and sign-in links returning to `/taskflow-app/auth-callback`.

### Not yet proven

- **The real deploy steps.** The first real run of **Publish the web app**, and a release-signed build on your phone. Both wait for your setup in DEPLOY.md.
- **The switch to the release key.** Moving from a development build to a release build means uninstalling once. Everything synced comes back on sign-in, but notification permission, battery settings, widgets and the Google connection must be set up again.

### Before installing

Do [DEPLOY.md](DEPLOY.md) steps 2 to 5, in order. This change adds nothing to the database.

## Remaining work

- [x] Phase 3: tasks, subtasks, projects, categories, tags, statuses, recurrence rules, quick add with natural language, search, filters, bulk edit, on local SQLite
- [x] Phase 4: outbox, full push and pull, live updates, conflict handling on devices, export and restore
- [x] Phase 5: Kotlin alarm runtime, notification actions, reboot and timezone handling, daily and evening summaries, background sync
- [ ] Remove replaced task photos from storage (kept for now so Undo works)
- [ ] Wake-up push through Firebase (needs your Firebase project; see Phase 5 decisions)
- [x] Phase 6: four home-screen widgets, ticking tasks from the widget, quick add from the widget
- [x] Phase 7: calendar views, drag to reschedule, Google Calendar, Drive and Tasks
- [x] Phase 8: analytics, daily planning, weekly review, goals, habits, focus timer, notes, Eisenhower matrix
- [x] Phase 9: profiles and speed-ups, battery review, desktop layout (code complete)
- [ ] Phase 9 phone run: the brief's twelve scenarios on your phone (docs/TESTING.md)
- [x] Phase 10: release signing, web deployment, guides (code complete)
- [ ] Phase 10 setup: signing secrets, GitHub Pages, sign-in addresses, reinstall once (docs/DEPLOY.md)
- [ ] Earlier phone checklists still open: Phase 6 (widgets), Phase 7 (calendar and Google), Phase 8, colours and pictures

Smaller items carried forward:

- [ ] Drag to reorder tasks within a list (the order is stored; there is no drag handle yet)
- [ ] Colours for categories (stored; no picker yet; projects have one since the colours change)
- [ ] Tick a habit from its reminder notification
- [ ] Drag tasks between boxes of the Eisenhower matrix (Move works today)

- [ ] Account deletion from inside the app (the database already cascades; the server function and the Settings screen are not written)
- [ ] Attachment uploads (the storage bucket and its policies exist)
- [ ] A native Google account picker in place of the browser tab
- [ ] Embed the fonts at build time so the first launch does not wait for them
