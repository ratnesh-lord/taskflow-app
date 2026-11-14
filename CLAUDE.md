# TaskFlow: notes for Claude

Personal productivity app. Expo SDK 58 (React Native 0.88, TypeScript) for Android and web, Supabase backend. Built phase by phase; `docs/PROGRESS.md` says where things stand and must be updated at the end of every phase.

## Commands

```bash
npm run check                 # typecheck + lint + jest (run before every commit)
npm run test:db               # database tests; needs PG* variables and a Postgres server
bash scripts/e2e/run.sh       # web end-to-end in headless Chrome against real Postgres
EXPO_OFFLINE=1 npx expo install <pkg>   # add a dependency at the SDK-compatible version
```

The sandbox cannot reach Google's Android SDK or Maven hosts, so Android is compiled only by GitHub Actions (`.github/workflows/ci.yml`). Read CI results with `gh run list` / `gh run view --log-failed`.

## Rules

- **Square corners.** No `borderRadius` anywhere; lint enforces it. Colours, type and spacing come from `src/ui/tokens.ts` only.
- **`src/core` is pure TypeScript**: no React, no Expo, no platform imports. Business rules go there with tests beside them.
- **Tests do not live under `src/app/`**: every file there is a route.
- **Expo APIs change every SDK.** Read the installed package's `.d.ts` in `node_modules` before using an API; do not rely on memory.
- **Migrations are append-only once applied to a real project.** Add a new file; never edit an old one. Each must pass `npm run test:db`.
- **Synced tables** carry `id, user_id, created_at, updated_at, deleted_at, rev, field_ts`, get `private.sync_enable()`, and are listed in `public.sync_tables()`. No constraint may compare two columns (edits merge per field).
- **Sync contract.** Edit timestamps are `<15-digit ms>:<5-digit counter>:<device uuid>`; `src/core/hlc.ts` and `sync_push` must agree on the format.
- Never put a secret key in the app, in `EXPO_PUBLIC_*`, or in the repository.
- User-facing documents are plain English for a non-specialist; say what was verified and what was not.
