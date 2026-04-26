# Safe Photo Browser

A local Google Drive media shuffler. Give it a Drive folder URL or ID and it lazily discovers images and videos from that folder and its subfolders while you watch, without crawling the whole tree up front.

## Features

- Google OAuth sign-in for private Drive folders.
- Random, lazy media queue with no repeats within a session.
- Images and videos served through the local backend.
- Folder navigation tree with include/exclude toggles.
- Configurable session limit, defaulting to 100 items.

## Setup

1. Install Node.js 20 or newer.
2. Create a Google OAuth client for a desktop/local web app.
3. Add `http://localhost:5174/auth/google/callback` as an authorized redirect URI.
4. Copy `.env.example` to `.env` and fill in:

```env
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

5. Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, sign in, paste a Drive folder URL or ID, and start a session.

## Scripts

- `npm run dev` starts the API and Vite frontend.
- `npm run build` builds the frontend.
- `npm test` runs unit tests for folder parsing and lazy sampling.

OAuth tokens are stored locally under `data/tokens.json`, which is ignored by git.
