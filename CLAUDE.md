# CLAUDE.md

Notes for future Claude sessions working in this repo. Read before making non-trivial changes.

## What this app is

A **single-user, local** Google Drive media shuffler. Two processes:

- Express API in `server/` on port 5174.
- Vite-served React SPA in `src/` on port 5173, proxying `/api` and `/auth` to 5174 (`vite.config.js`).

`npm run dev` runs both via `concurrently`. The frontend uses same-origin fetches (`API = ""` in `src/main.jsx`) and relies on the proxy.

## Design assumptions to respect

1. **Single user, single session.** `server/index.js` holds one module-level `sessionManager` and one `oauthClient`. Starting a session replaces the old one. Do not introduce per-user session maps, session IDs in requests, or auth middleware unless the user explicitly asks — the singleton is intentional.
2. **Tokens on disk.** OAuth tokens are persisted to `data/tokens.json` (gitignored) and reloaded on startup in `createOAuthClient`. Don't move them to a database or in-memory only.
3. **Folders eager, media lazy.** Session start does a BFS over the whole folder tree (folders only, no media metadata) via `SessionManager.discoverFolderTree` so the user can pre-filter the tree before any media is fetched. **Media** discovery stays lazy — `SessionManager.fillQueue` only pulls another folder page when the queue dips below `QUEUE_TARGET` (5). Don't blur this distinction: don't make media eager, and don't move folder discovery back to lazy.
4. **Two-phase session lifecycle.** `start()` does folder discovery only and returns with `current === null` and an empty queue. The first `next()` is what triggers media fetching. `setFolderIncluded` deliberately **skips** its `fillQueue` step while `current === null` so the user can toggle filters pre-viewing without any wasted Drive calls. Treat `current === null && shownCount === 0` as the "configuring filters" pre-viewing state.
5. **Tree expand/collapse is UI-only.** `toggleExpanded` in the frontend just updates the local `expanded: Set<string>` — no API call. The server's `/api/session/expand` endpoint validates the folder ID and echoes state without any side effects. Folder children are already known from the eager `discoverFolderTree`, and media will be fetched lazily by `discoverOneStep` if/when the tree-walk picks the folder. Don't reintroduce side effects in the expand path — chevron clicks must never block on the network.

## Session model (server/sessionManager.js)

The session shape is non-obvious. Key fields:

- `frontier`: array of folder IDs still to explore *for media*. Populated eagerly at session start by `discoverFolderTree`. A folder is "eligible" if its parent path is included AND (it isn't yet exhausted OR its `mediaBuffer` still has items).
- Each folder has a `mediaBuffer: MediaItem[]`. `discoverOneStep` picks a folder via tree-walk, then **drains every remaining page** of that folder into the buffer in one shot before sampling. This is the only way to get truly random sampling — a folder of 500 photos sorted by date paginated 50-at-a-time would otherwise rotate only the earliest 50 (all from January) until exhausted, since `QUEUE_TARGET = 5` is reached after page 1 and `fillQueue` stops calling `discoverOneStep`. `PAGE_SIZE` is set to **1000** (Drive's max) so most folders fit in one call. `discoverOneStep` picks **one** random item from a random eligible folder per call, which guarantees consecutive items rotate across folders.
- `folders`: Map of folder ID → `{ parentId, children, included, discovered, exhausted, nextPageToken }`. Each folder is paginated independently via its own `nextPageToken`.
- `queue`: pre-fetched media items, target length 5.
- `seenFileIds`: Set used to enforce no-repeats within a session.
- `history` + `forwardStack`: browser-style back/forward. `previous()` pops `history` onto `forwardStack`; `next()` consumes `forwardStack` first before pulling from `queue`. Forward-stack replays don't re-fetch and don't increment `shownCount` (so they don't burn through `maxItems`). Both are filtered against `isMediaEligible` when a folder is excluded; `history` is left untouched (going back can land on items in now-excluded folders, which matches pre-change behavior).

Inclusion is **transitive through parents**: `isFolderPathIncluded` walks up the parent chain, so excluding a folder excludes all descendants. When toggling exclusion, `setFolderIncluded` re-filters the queue and skips the current item if it became ineligible.

`discoverOneStep` returns one item via a **recursive tree walk** starting at the root: at each level, the cursor folder and its eligible direct children are equally-weighted options. If "stay" is chosen, fetch a page if needed and pick one random item from the cursor's `mediaBuffer`. If a child is chosen, descend and repeat. This means upper folders (especially the root) get materially higher selection probability than they would under flat-uniform-folder selection — root files are guaranteed to appear in the rotation as long as root has media. The tree walk skips any subtree where every reachable folder is exhausted-and-empty (`subtreeHasPickableMedia`), so it doesn't dead-end on barren branches. Selection randomness is at three levels: which child to descend into, when to stop descending, and which buffered item to pick.

## Format gotchas — not every `image/*` or `video/*` plays in browsers

`SessionManager.isSupportedMedia` keeps an explicit `UNPLAYABLE_MIMES` blocklist for formats that pass the broad `image/*` / `video/*` test but can't be decoded natively by Chrome / modern browsers. Notable entries: `video/mp2t` (AVCHD `.MTS`/`.M2TS` from camcorders — the original failure), `video/x-msvideo` (`.avi`), `video/x-ms-wmv`, `video/x-flv`, `image/heic`/`heif` (iPhone defaults). Files matching the blocklist never enter `mediaBuffer`. There's also a client-side `onError` fallback in `MediaStage` for anything that slips past — videos auto-skip on `MEDIA_ERR_DECODE` (3) or `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) but stay on screen for network errors (2). Don't broaden the filter without checking real browser support — many container formats look playable but aren't.

## Drive API gotchas (server/driveService.js)

- `listFolderPage` uses `supportsAllDrives` + `includeItemsFromAllDrives` — needed for shared drives, keep both.
- The query escapes single quotes in folder IDs (`replaceAll("'", "\\'")`). Don't drop this; folder IDs can theoretically contain `'`.
- `streamFile` passes the client `Range` header through to Drive and the response copies `content-length`, `content-range`, `accept-ranges` back. **This is what makes video scrubbing work.** If you touch `/api/media/:fileId`, preserve the range passthrough and the 206 status when `content-range` is present.
- Drive `files.list` is filtered to folders + `image/*` + `video/*` server-side — don't re-filter on the client.

## Frontend layout — switch toggle scroll gotcha

The folder-tree include/exclude switch wraps a hidden checkbox in a label. The hidden input **must** stay positioned inside `.switch` (which is `position: relative`) and use the proper visually-hidden pattern (`clip: rect(0,0,0,0)`, `opacity: 0`, 1px size). Without those, the input was `position: absolute` without an offset and `.switch` had no positioning context, so on click the browser focused the input and scrolled the page to bring it into view — which dragged `body.scrollTop` to ~1070px, shoving all the visible content off-screen and leaving an apparently blank page. `test/mediaLayout.test.js` pins this with two CSS regex assertions ("switch toggle — must not scroll the page when clicked"). If you're tempted to redesign the toggle, make sure the input never has on-screen geometry and `.switch` stays positioned.

## Frontend layout — image cropping gotcha

`.media-frame` **must use `display: flex`**, not `display: grid`. Grid with auto track sizing creates a cell sized to the item's max-content; an image with `max-height: 100%` then has a circular constraint (cell sizes to item, item wants 100% of cell) and falls back to intrinsic size, overflowing the frame. Combined with `overflow: hidden`, vertical images get visibly cropped. Flex sizes children against the container directly, so the percentage caps resolve correctly. `test/mediaLayout.test.js` pins this — if you change the rule to grid (or remove `max-width`/`max-height`/`object-fit`), the regex lint tests will fail.

## Frontend (src/main.jsx)

- Single file, no router. All UI state is `useState` in `App`.
- `MediaStage` decides image vs. video by `mimeType.startsWith("video/")`.
- Auto-advance is **state-driven, not event-driven**. `MediaStage` runs `runAutoAdvanceEffect` (in `src/autoAdvance.js`) inside a `useEffect` keyed on `item.id`, `item.mimeType`, `autoAdvance`, `autoAdvanceSeconds`, and `autoAdvanceVideos`. Toggling `autoAdvance` while an item is already showing immediately starts a fresh timer because the effect re-runs. The earlier event-based version (`setTimeout` inside `img.onLoad` / `video.onPlay`) was buggy: those events only fire on first load, so toggling after the image had already loaded did nothing. **Do not** revert to event-based timing. The seconds and the "apply to videos too" boolean are user-configurable via the sidebar's Auto advance panel and persisted to `localStorage` (`autoAdvanceSeconds`, `autoAdvanceVideos`).
- `runAutoAdvanceEffect` **must return undefined**, never `null`, in its no-timer branches. React's useEffect cleanup does roughly `if (cleanup !== undefined) cleanup()` — returning `null` makes React try to invoke `null()` on the next effect re-run, throwing a TypeError that unmounts the whole tree (symptom: the page goes blank when typing in the seconds input). `test/autoAdvance.test.js` has a "never returns null (page-blank regression)" block that pins this.
- The OAuth callback redirects to `?signedIn=1` but nothing reads that query param — sign-in status comes from polling `/api/auth/status` on mount. Don't add code that reads `?signedIn=1` expecting it to be wired up.
- `reset()` calls `POST /api/session/end` and then clears local UI state. Errors from the end call are swallowed (the server may have no active session).
- **Drive folder picker** (`FolderPicker` component) hits `GET /api/drive/folders?parentId=…` for one level of children at a time. It maintains a breadcrumb stack as the user descends. Picker is gated on `signedIn`; the trigger button is disabled until OAuth completes.
- **Full path under each item** is built by `buildItemPath(item, folders)` which walks `state.folders` up from `item.parentIds[0]` via each folder's `parentId` until null, then joins with ` › ` (matching the picker breadcrumbs). Falls back to just `item.name` if folders haven't loaded yet.
- **Resizable sidebar** is driven by a CSS variable. App owns `sidebarWidth` state, applies it as `style={{ "--sidebar-width": ... }}` on `.app-shell`, and persists it to `localStorage`. The handle (`<div className="resize-handle">`) attaches document-level mousemove/up listeners on mousedown to drive the drag. Bounds are `SIDEBAR_MIN`=240 / `SIDEBAR_MAX`=640. The responsive `@media (max-width: 820px)` rule overrides the grid template to a single column and hides the handle.

## Tests (test/, vitest)

- Run with `npm test` (one-shot) or `npm run test:watch`.
- Four test files:
  - `folderId.test.js` — `parseFolderId` URL/ID parsing.
  - `sessionManager.test.js` — session lifecycle, forward-stack symmetry, max-items cap, `end()`, format filter (`isSupportedMedia`), MTS file rejection, multi-page folder draining, cross-folder rotation across runs, exclusion behavior. Uses a hand-rolled `fakeDrive` and `folder()`/`image()` factories at the bottom of the file. `Math.random` is stubbed with `vi.spyOn` only for tests that need determinism — always `mockRestore()` after.
  - `mediaLayout.test.js` — CSS regex lints (no grid in `.media-frame`, max-width/height/object-fit on img+video) plus a layout-math simulation for various large image sizes.
  - `autoAdvance.test.js` — `runAutoAdvanceEffect` decision logic, the toggle-on-while-showing regression, the never-returns-null page-blank regression. Uses `vi.useFakeTimers` to simulate React's effect-cleanup-then-re-run lifecycle.
- New tests for randomness should run multiple sessions and assert across the union (probabilistic asserts) — see "rotates files across folders and gives varied sequences across runs" and "samples across ALL pages of a multi-page folder" for the pattern. Document the math in the test comment so a flaky-looking test is explainable.

## Things that look like bugs but aren't

- `MAX_ITEMS` clamp is `[1, 5000]` in `SessionManager.start` and `[1, 5000]` in the input field — keep them in sync if either changes.
- The OAuth callback only updates credentials in place and persists them; it does **not** rebuild `driveService`/`sessionManager`. This is intentional: the `OAuth2Client` is captured by reference, so `setCredentials` propagates automatically, and reusing the existing `sessionManager` lets an in-flight session survive a re-auth.

## Conventions

- ESM throughout (`"type": "module"`). Use `.js` extensions in imports.
- No TypeScript, no linter config — match the existing plain-JS style.
- React 18, function components + hooks only.
- Icons from `lucide-react`.
- No CSS framework; styles in `src/styles.css`.
