# Safe Photo Browser

A local Google Drive media shuffler. Point it at a Drive folder and it browses through images and videos at random, lazily, without crawling the whole tree up front.

## Features

- Google OAuth sign-in for private Drive folders. Tokens persist locally between runs.
- **In-app folder picker** — browse your Drive in a modal and click a folder; no need to paste URLs or IDs.
- **Recursive tree-walk randomness.** At each level the algorithm picks the current folder or one of its subfolders with equal weight, then descends. Root files and deep-nested files all get fair representation.
- Folders eager, media lazy: subfolders are discovered up front so you can include / exclude branches before any photo is fetched. Media discovery only kicks in when you click Next.
- Browser-style back/forward — `Previous` doesn't lose items.
- **Auto-advance** with a configurable seconds-per-image and an opt-in checkbox to apply the same timer to videos (off by default — videos play to natural end).
- **Resizable sidebar.** Drag the divider to give the picture more room; the chosen width persists across sessions.
- Full Drive path shown under each item (e.g. `My Drive › Photos › 2024 › Beach.jpg`).
- Range-passthrough video streaming — scrubbing works on long clips.
- Filters out formats that browsers can't decode natively (MTS/M2TS, AVI, WMV, HEIC, HEIF) so you don't get stuck on a frozen frame.

## Setup

1. Install Node.js 20 or newer.
2. **Create a Google OAuth client** for a desktop/local web app:
   - https://console.cloud.google.com/ → new project → enable **Google Drive API**.
   - **OAuth consent screen** → External → add your own Google account under **Test users**.
   - **Credentials → Create OAuth client ID** → Web application.
   - Add `http://localhost:5174/auth/google/callback` as an Authorized redirect URI.
3. Copy `.env.example` to `.env` and fill in the Client ID and Secret:

```env
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

4. Install dependencies and start the app:

```bash
npm install
npm run dev
```

5. Open `http://localhost:5173`, click **Sign in**, then **Browse Drive...** and pick a folder. The folder tree appears in the sidebar — toggle anything you don't want included and click **Next** to begin.

### Windows shortcut

Double-click `start.bat` to run dependency check + install + dev server in one step. It opens the browser automatically once Vite is up.

## Scripts

- `npm run dev` — runs the Express API (port 5174) and Vite frontend (port 5173) concurrently.
- `npm run build` — builds the frontend to `dist/`.
- `npm test` — runs the unit and behaviour test suites.
- `npm run test:watch` — same, in watch mode.

## What plays / what doesn't

Browser-native playback is the constraint. Reliable: `.jpg`, `.png`, `.gif`, `.webp`, `.mp4` (H.264/AAC — the universal phone default), `.webm`, most `.mov`. Filtered out at the server (so they don't appear in the rotation): `.MTS`/`.M2TS` (AVCHD camcorder format), `.avi`, `.wmv`, `.flv`, `.heic`/`.heif`. To browse those, transcode them outside the app first (e.g. `ffmpeg -i in.MTS -c:v libx264 -c:a aac out.mp4`).

## Where things live

- `server/` — Express API, Drive client, session manager.
- `src/` — React SPA (single-file component tree, plain CSS).
- `data/tokens.json` — OAuth tokens (gitignored, auto-created on first sign-in; refreshed tokens are saved back too).
- `test/` — Vitest test suites covering folder ID parsing, session manager logic, auto-advance timer, media-frame layout, and Drive format filtering.
