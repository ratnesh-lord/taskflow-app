# Install and use

TaskFlow runs as an Android app and in any modern browser. Both use the same account, and changes on one appear on the other.

Before the first install, the project needs its one-time setup: [SETUP.md](SETUP.md) and then [DEPLOY.md](DEPLOY.md).

## On an Android phone

1. On the phone, open
   https://github.com/ratnesh-lord/taskflow-app/releases/download/latest-build/taskflow-latest.apk
   and open the download. The first time, Android asks you to allow installs from your browser.
2. Open TaskFlow and sign in, or create an account.
3. Allow notifications when asked.
4. Open **More > Reminders and summaries**. Every line should be green. If **Battery** says **Optimised**, tap **Change**: some phone makers stop background apps, and this keeps reminders on time.
5. Optional:
   - **More > Widgets** adds the four home-screen widgets.
   - **More > Google Calendar, Tasks and Drive** connects Google.

**Updating:** open the same link and install. A new build installs over the old one, and you stay signed in. Android 7 and later are supported.

**Moving from a development build to a release build:** this has to be done once (DEPLOY.md, step 5). If Android says **App not installed**, that is the reason.

## In a browser

Open https://ratnesh-lord.github.io/taskflow-app/ and sign in. It works in current Chrome, Edge, Firefox and Safari, at phone size or full screen. On a wide window, the tabs move to a sidebar on the left.

- Your tasks are kept in that browser and synced with your account. They are still there offline; edits made offline go up when the connection is back.
- Use one tab at a time. A second TaskFlow tab in the same browser says **TaskFlow is open in another tab**; close the other tab and reload.
- **The browser cannot:**
  - ring reminders, which only the Android app does (they are still saved and synced to the phone);
  - show home-screen widgets.

  The focus timer shows a browser notification at the end only while its tab is open.
- Signing out removes the browser's copy of your data. Your account keeps everything.

## Your data

- **Where it lives:** your tasks live in your Supabase project, and a copy on each device you sign in on. Only your account can read them.
- **Export:** **More > Export all data** saves a backup file; **Restore from a backup** brings one back.
- **Backups:** each night, GitHub makes an encrypted backup of the whole database and keeps it for 30 days (SETUP.md, step 8).
