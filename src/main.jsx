import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Folder,
  Image,
  Loader2,
  LogIn,
  RotateCcw,
  SkipBack,
  SkipForward,
  Video,
  X
} from "lucide-react";
import "./styles.css";

const API = "";

function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [folderIdOrUrl, setFolderIdOrUrl] = useState("");
  const [maxItems, setMaxItems] = useState(100);
  const [state, setState] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/auth/status")
      .then((data) => setSignedIn(data.signedIn))
      .catch(() => setSignedIn(false));
  }, []);

  async function startSession(event) {
    event.preventDefault();
    await run(async () => {
      const nextState = await api("/api/session/start", {
        method: "POST",
        body: { folderIdOrUrl, maxItems }
      });
      setState(nextState);
      setExpanded(new Set([nextState.rootFolderId]));
    });
  }

  async function next() {
    await run(async () => setState(await api("/api/session/next", { method: "POST" })));
  }

  async function previous() {
    await run(async () => setState(await api("/api/session/previous", { method: "POST" })));
  }

  async function reset() {
    setState(null);
    setError("");
    setAutoAdvance(false);
  }

  async function toggleFolder(folderId, included) {
    await run(async () => {
      setState(
        await api("/api/session/filter", {
          method: "POST",
          body: { folderId, included }
        })
      );
    });
  }

  async function toggleExpanded(folderId) {
    const nextExpanded = new Set(expanded);
    if (nextExpanded.has(folderId)) {
      nextExpanded.delete(folderId);
      setExpanded(nextExpanded);
      return;
    }

    nextExpanded.add(folderId);
    setExpanded(nextExpanded);
    await run(async () => {
      setState(
        await api("/api/session/expand", {
          method: "POST",
          body: { folderId }
        })
      );
    });
  }

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const current = state?.current ?? null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Image size={20} aria-hidden="true" />
          </div>
          <div>
            <h1>Safe Photo Browser</h1>
            <p>Local Drive media shuffle</p>
          </div>
        </div>

        <section className="panel">
          <div className="auth-row">
            <span className={signedIn ? "status signed-in" : "status"} />
            <span>{signedIn ? "Google Drive connected" : "Google Drive not connected"}</span>
          </div>
          <a className="primary-button" href="/auth/google/start">
            <LogIn size={18} aria-hidden="true" />
            Sign in
          </a>
        </section>

        <form className="panel session-form" onSubmit={startSession}>
          <label>
            Drive folder
            <input
              value={folderIdOrUrl}
              onChange={(event) => setFolderIdOrUrl(event.target.value)}
              placeholder="Folder URL or ID"
              required
            />
          </label>
          <label>
            Session limit
            <input
              type="number"
              min="1"
              max="5000"
              value={maxItems}
              onChange={(event) => setMaxItems(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <CirclePlay size={18} />}
            Start
          </button>
        </form>

        {state ? (
          <section className="tree-panel">
            <div className="section-title">
              <Folder size={17} aria-hidden="true" />
              Folders
            </div>
            <FolderTree
              state={state}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onToggleFolder={toggleFolder}
            />
          </section>
        ) : null}
      </aside>

      <section className="viewer-area">
        <div className="toolbar">
          <div className="counter">
            <strong>{state ? `${state.shownCount} / ${state.maxItems}` : "0 / 100"}</strong>
            <span>{state ? `${state.queueLength} queued` : "No session"}</span>
          </div>
          <div className="controls">
            <IconButton label="Previous" onClick={previous} disabled={!state || busy}>
              <SkipBack size={20} />
            </IconButton>
            <IconButton
              label={autoAdvance ? "Pause auto advance" : "Auto advance"}
              onClick={() => setAutoAdvance((value) => !value)}
              disabled={!state}
            >
              {autoAdvance ? <CirclePause size={20} /> : <CirclePlay size={20} />}
            </IconButton>
            <IconButton label="Next" onClick={next} disabled={!state || busy}>
              <SkipForward size={20} />
            </IconButton>
            <IconButton label="Reset" onClick={reset} disabled={!state}>
              <RotateCcw size={20} />
            </IconButton>
          </div>
        </div>

        {error ? (
          <div className="error-banner">
            <X size={18} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <MediaStage
          item={current}
          exhausted={state?.exhausted}
          autoAdvance={autoAdvance}
          onEnded={next}
        />
      </section>
    </main>
  );
}

function MediaStage({ item, exhausted, autoAdvance, onEnded }) {
  if (!item) {
    return (
      <div className="empty-stage">
        <p>{exhausted ? "No more eligible media." : "Start a session to begin."}</p>
      </div>
    );
  }

  const src = `${API}/api/media/${encodeURIComponent(item.id)}`;
  const isVideo = item.mimeType.startsWith("video/");

  return (
    <div className="media-stage">
      <div className="media-frame">
        {isVideo ? (
          <video
            key={item.id}
            src={src}
            controls
            autoPlay={autoAdvance}
            onEnded={autoAdvance ? onEnded : undefined}
          />
        ) : (
          <img
            key={item.id}
            src={src}
            alt={item.name}
            onLoad={() => {
              if (autoAdvance) {
                window.setTimeout(onEnded, 6000);
              }
            }}
          />
        )}
      </div>
      <div className="caption">
        {isVideo ? <Video size={18} aria-hidden="true" /> : <Image size={18} aria-hidden="true" />}
        <span title={item.name}>{item.name}</span>
      </div>
    </div>
  );
}

function FolderTree({ state, expanded, onToggleExpanded, onToggleFolder }) {
  const foldersById = useMemo(
    () => new Map(state.folders.map((folder) => [folder.id, folder])),
    [state.folders]
  );
  const root = foldersById.get(state.rootFolderId);

  if (!root) {
    return null;
  }

  return (
    <div className="folder-tree">
      <FolderNode
        folder={root}
        foldersById={foldersById}
        expanded={expanded}
        depth={0}
        onToggleExpanded={onToggleExpanded}
        onToggleFolder={onToggleFolder}
      />
    </div>
  );
}

function FolderNode({
  folder,
  foldersById,
  expanded,
  depth,
  onToggleExpanded,
  onToggleFolder
}) {
  const isExpanded = expanded.has(folder.id);
  const children = folder.children.map((id) => foldersById.get(id)).filter(Boolean);

  return (
    <div>
      <div className="folder-row" style={{ "--depth": depth }}>
        <button
          className="icon-button small"
          type="button"
          title={isExpanded ? "Collapse" : "Expand"}
          onClick={() => onToggleExpanded(folder.id)}
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <Folder size={16} aria-hidden="true" />
        <span title={folder.name}>{folder.name}</span>
        <label className="switch" title={folder.included ? "Included" : "Excluded"}>
          <input
            type="checkbox"
            checked={folder.included}
            onChange={(event) => onToggleFolder(folder.id, event.target.checked)}
          />
          <span />
        </label>
      </div>
      {isExpanded
        ? children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              foldersById={foldersById}
              expanded={expanded}
              depth={depth + 1}
              onToggleExpanded={onToggleExpanded}
              onToggleFolder={onToggleFolder}
            />
          ))
        : null}
    </div>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" type="button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

createRoot(document.getElementById("root")).render(<App />);
