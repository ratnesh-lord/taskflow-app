# First-time setup

Everything here is free and is done once. You need a computer with a browser; nothing has to be installed. Allow about 30 minutes.

When you finish you will have: a Supabase project holding the database, sign-in by email and by Google, and an APK built by GitHub that talks to it.

## 1. Create the Supabase project

1. Go to https://supabase.com and sign up (the Free plan).
2. Create a new project.
   - **Name:** `taskflow`
   - **Database password:** generate one and save it in your password manager. Use letters and digits only: symbols cause trouble when the password sits inside a connection string.
   - **Region:** the one closest to you. For India that is Mumbai (`ap-south-1`).
3. Wait for the project to finish starting.

## 2. Give GitHub access to the database

GitHub applies the database migrations, and later runs the daily maintenance job.

1. In the Supabase project, click **Connect** (top of the page).
2. Choose **Session pooler** and copy the connection string. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
   Use the session pooler, not the direct connection: GitHub's servers cannot reach the direct one.
3. Replace `[YOUR-PASSWORD]` with the database password from step 1.
4. In the GitHub repository open **Settings > Secrets and variables > Actions > Secrets** and add:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_DB_URL` | the connection string from above |
   | `BACKUP_PASSPHRASE` | a long passphrase of your own, saved in your password manager. Backups are encrypted with it; without it you cannot open them. |

## 3. Create the tables

1. In the GitHub repository open **Actions > Apply database migrations > Run workflow** and run it on `main`.
2. When it turns green, open Supabase **Table Editor**. You should see `tasks`, `projects`, `profiles` and the rest, each marked as protected by row-level security.

Running the workflow again is harmless: each migration is applied once.

## 4. Tell the app where the database is

1. In Supabase click **Connect** again and copy the **Project URL** (`https://abcdefgh.supabase.co`).
2. Open **Settings > API Keys** and copy the **Publishable key** (it starts with `sb_publishable_`).
   If the page only offers legacy keys, the `anon` key works too.
3. In GitHub open **Settings > Secrets and variables > Actions**, choose the **Variables** tab, click **New repository variable** and add these two, one at a time. The names must match exactly.

   | Name | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | the Project URL: only the address, with nothing after `.supabase.co` |
   | `EXPO_PUBLIC_SUPABASE_KEY` | the publishable key |

   If you saved them on the **Secrets** tab instead, that works too.

Every Android build checks these two values first and asks your project whether it accepts the key. A build from `main` with a missing or wrong value stops within a minute, and its error message says which value to fix and how.

Both values are public by design: they ship inside every copy of the app. What protects your data is row-level security in the database. The **secret** key (`sb_secret_...`, or the legacy `service_role` key) must never be put in the app, in these variables or in the repository.

## 5. Allow the app's sign-in links

In Supabase open **Authentication > URL Configuration**.

1. **Redirect URLs:** add `taskflow://auth-callback`. This is where Google sign-in, email confirmation and password-reset links return to on the phone.
2. For developing the web app on your computer, also add `http://localhost:8081/auth-callback`.
3. **Site URL:** leave it for now. It becomes the web app's address in Phase 10.

Email sign-up sends a confirmation link by default, and the free plan sends only a few emails an hour. For a personal app you can turn confirmation off under **Authentication > Sign In / Providers > Email > Confirm email**.

## 6. Turn on Google sign-in (optional)

1. Open https://console.cloud.google.com and create a project named `TaskFlow`.
2. **APIs & Services > OAuth consent screen:** choose External, fill in the app name and your email, and add yourself. Then set the publishing status to **In production**. Left in Testing, Google expires the sign-in every 7 days. An unverified app shows a warning screen once; that is fine for personal use.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID:**
   - **Application type:** Web application
   - **Authorized redirect URIs:** the callback address shown in Supabase under **Authentication > Sign In / Providers > Google**. It looks like `https://abcdefgh.supabase.co/auth/v1/callback`.
4. Copy the Client ID and Client secret into that same Google provider page in Supabase, switch it on and save.

Email and password sign-in works without any of this.

## 7. Build and install

1. Merge to `main`, or open **Actions > CI > Run workflow** and run it on `main`. Either way the build is published when it finishes, about 10 to 25 minutes later.
2. On the phone open this link, which always downloads the newest build:
   https://github.com/ratnesh-lord/taskflow-app/releases/download/latest-build/taskflow-latest.apk
   (or open the repository's **Releases** page and tap **TaskFlow latest build**). Open the download. Android asks once to allow installs from your browser.
   The release notes say which Supabase project the build connects to and whether Google sign-in is on.
3. Open TaskFlow, create an account or sign in.
4. Go to **More > Check connection**. Four green ticks mean sign-in, the access rules and sync all work from your phone.

A new build installs over the previous one; you stay signed in.

If the app opens on a screen titled **Not connected yet**, it was built before the two values from step 4 were set (builds from before 17 November never checked them). Set them and run the workflow again.

## 8. Check the daily maintenance job

Open **Actions > Daily maintenance > Run workflow**. It should finish green and attach an encrypted backup. From then on it runs every night: it keeps the free project from being paused for inactivity, removes rows deleted more than 90 days ago, and saves a backup that is kept for 30 days.

To open a backup: `gpg --decrypt taskflow-backup-DATE.tar.gz.gpg | tar xz` and enter the passphrase.

## What costs money

Nothing above. The limits that matter are listed in the architecture document; the short version is 500 MB of database and 1 GB of files on Supabase, which a single person's tasks will not approach.
