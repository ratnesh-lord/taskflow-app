# Release and deploy

How TaskFlow is published: the Android app as a signed APK on the repository's Releases page, and the web app on GitHub Pages. Both are built by GitHub Actions from `main`. Nothing here costs money.

Do [SETUP.md](SETUP.md) first: it creates the Supabase project, the database and the two app settings. This guide adds the release key and the website. Allow about 20 minutes.

| What | Where it ends up |
| --- | --- |
| Android app | https://github.com/ratnesh-lord/taskflow-app/releases/download/latest-build/taskflow-latest.apk |
| Web app | https://ratnesh-lord.github.io/taskflow-app/ |

## 1. What happens on each merge to `main`

1. **Apply database migrations** runs if the database changed, and updates your Supabase project.
2. **CI** runs every test, builds the APK, signs it with the release key (step 2), checks the signature, and replaces the **TaskFlow latest build** release.
3. When CI has passed, **Publish the web app** builds the website and publishes it on GitHub Pages (step 3).

If a test fails, nothing is published, and the previous APK and website stay as they were.

## 2. Release signing key (once)

Android lets an app be updated only by an APK signed with the same key. Until now, builds were signed with React Native's shared development key, which anyone can use. Your own key means only your builds can update TaskFlow on your phone.

You received two files with this change: `taskflow-release-key.txt` and `taskflow-release.jks`.

1. Save **both** in a safe, private place, such as your password manager. Do not put them in the repository, an email or a chat.
2. In GitHub open **Settings > Secrets and variables > Actions**, the **Secrets** tab, and add four **repository secrets**. The names and values are in `taskflow-release-key.txt`:

   | Secret | Value |
   | --- | --- |
   | `TASKFLOW_KEYSTORE_BASE64` | the long line (5,756 characters): copy all of it, with no spaces or line breaks |
   | `TASKFLOW_KEYSTORE_PASSWORD` | the password |
   | `TASKFLOW_KEY_ALIAS` | `taskflow` |
   | `TASKFLOW_KEY_PASSWORD` | the same password |

3. Run **Actions > CI > Run workflow** on `main`. When it is green, the release notes say **Signed with TaskFlow's release key** and show its SHA-1 fingerprint.

If a secret is wrong, the build stops at **Use the release signing key** with a message naming the secret to fix. Without the four secrets, builds still work, signed with the development key, and the release notes say so.

**Losing the key** is not a disaster for a personal app. Make a new one (ask, or see `scripts/ci/release-key.sh`), replace the secrets, and reinstall TaskFlow once as in step 5.

## 3. Turn on the website (once)

1. In GitHub open **Settings > Pages**.
2. Under **Build and deployment > Source**, choose **GitHub Actions**. There is nothing else to fill in.
3. Open **Actions > Publish the web app > Run workflow** and run it on `main`. When it is green, the site is at https://ratnesh-lord.github.io/taskflow-app/.

The website uses the same two Supabase values as the APK (SETUP.md, step 4). For the Google integrations in the browser, also add a repository **variable** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` with your Web application client's ID (step 4 below).

The repository is public, so the website is public too: anyone can open the sign-in page. Your tasks stay private, because only your account can read them (row-level security, checked by the database tests on every push).

## 4. Let sign-in links and Google return to the website and the release build (once)

**Supabase:** open **Authentication > URL Configuration**.

1. **Site URL:** `https://ratnesh-lord.github.io/taskflow-app/`
2. **Redirect URLs:** add `https://ratnesh-lord.github.io/taskflow-app/auth-callback`. Keep `taskflow://auth-callback` for the phone.

Without these, email confirmation, password reset and Google sign-in on the website return to the wrong address.

**Google Cloud** (only if you use Google sign-in or the Google integrations), at https://console.cloud.google.com:

1. **Google Auth Platform > Clients:** open your **Web application** client. Under **Authorized JavaScript origins**, add `https://ratnesh-lord.github.io`, the site's address with no path. Save.
2. **Create client:** choose **Android**, package name `com.ratnesh.taskflow`, and the **SHA-1** from `taskflow-release-key.txt` (also shown in the release notes). Keep the existing Android client with the development fingerprint until you have switched phones over.

## 5. Move your phone to the release build (once)

Android will not install an APK signed with the release key over one signed with the development key. It says **App not installed** or **conflicts with an existing package**. Reinstall once:

1. Open TaskFlow and go to **More**. Wait until it says **Every change on this device has been sent.** Everything you have is then safe in your account.
2. Uninstall TaskFlow: hold its icon, then **App info > Uninstall**.
3. Install the new APK from the link at the top of this page, open it and sign in. Your tasks, projects, habits, goals and notes come back from your account.
4. Set up again what belongs to the phone itself:
   - allow notifications;
   - **More > Reminders and summaries > Battery**: Change;
   - add the home-screen widgets again;
   - reconnect Google under **More > Google Calendar, Tasks and Drive**.

From then on, each new build installs over the previous one as before.

## 6. If something goes wrong

- **A bad build reached the phone:** open **Actions > CI**, pick the last good run on `main`, and **Re-run all jobs**. Its APK replaces the latest build. Or download the APK attached to that run under **Artifacts**.
- **The website is broken:** re-run **Publish the web app** from the last good run in the same way.
- **The database:** migrations only add things, and the daily maintenance job keeps 30 days of encrypted backups (SETUP.md, step 8).

## What was checked

- **Signing:** every emulator test signs the app with a throwaway key made in the job and checks the APK carries that key. This proves the release-signing path works without touching your real key. The real key has been checked to open with the values in `taskflow-release-key.txt`.
- **Website:** the web end-to-end test (103 checks) builds the app for `/taskflow-app` and serves it the way GitHub Pages does: unknown addresses get the `404.html` copy of the app, with a 404 status. It also checks the app's code loads from below that path and that sign-in links return to `/taskflow-app/auth-callback`.

**Not checked yet:** the first real run of **Publish the web app**, which needs step 3, and a release-signed build on your phone, which needs steps 2 and 5.
