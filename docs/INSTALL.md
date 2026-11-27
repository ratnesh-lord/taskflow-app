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

## Sharing tasks with other people

1. **Choose a username.** Open **More**, then under your account tap **Choose a username**. It is 3 to 20 lower-case letters, digits or `_`. Other people find you by it. They see your username and your name, never your email address.
2. **Make a group.** Open **More > Groups > New group** and give it a name, such as *Flat 4*. You own it.
3. **Invite people.** In the group, tap **Invite someone by username**. The other person sees the invitation under **More > Groups** and taps **Join**. Until they do, they see nothing of the group.
4. **Add tasks to it.** Tap **+** on the group's screen. Or, in a task of your own, tap **Share with a group**. A shared task loses its project, goal and tags, because those stay personal.
5. **Assign a task.** In the task, tap **Assigned to** and pick someone. It moves into their Today, Upcoming and widgets, and they get its reminders; you no longer do. Their phone tells them with a notification: within seconds if TaskFlow is open, otherwise at its next background sync, which Android usually runs within 30 to 60 minutes. A task assigned to nobody stays with whoever created it.
6. **Keep one private.** Tap **Who sees it** and choose **Only its creator and the person it is assigned to**. The rest of the group then does not see it at all.

**Who can do what:**

- Only a task's creator and the person it is assigned to can change, complete or delete it. Everyone else in the group can look, and can time a focus session on it.
- The person it is assigned to can tap **Hand back to …** to return it to its creator.
- The group's owner invites and removes people, and can make someone an admin. Admins can invite people and remove ordinary members. Anyone except the owner can **Leave group**. The owner can **Delete group**, which deletes every task in it for everyone.
- When someone leaves or is removed, tasks assigned to them go back to whoever created them.

**Limits:**

- Making groups, inviting, joining and leaving need a connection. Once you are in, group tasks work offline like your own.
- Tags, links and files on a group task stay personal; you cannot add them.
- A task picture made from a photo shows only for the person who added it.
- A task cannot be moved out of its group or to another group.
- Backups (**Export all data**) hold your own tasks, not group tasks.

## Your data

- **Where it lives:** your tasks live in your Supabase project, and a copy on each device you sign in on. Only your account can read them; tasks you put in a group can also be read by its members.
- **Export:** **More > Export all data** saves a backup file; **Restore from a backup** brings one back.
- **Backups:** each night, GitHub makes an encrypted backup of the whole database and keeps it for 30 days (SETUP.md, step 8).
