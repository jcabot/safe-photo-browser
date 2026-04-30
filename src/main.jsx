import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { runAutoAdvanceEffect } from "./autoAdvance.js";

const API = "";
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 320;

function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [maxItems, setMaxItems] = useState(100);
  const [state, setState] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [error, setError] = useState("");
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(() => {
    if (typeof window === "undefined") return 6;
    const stored = Number(window.localStorage.getItem("autoAdvanceSeconds"));
    return Number.isFinite(stored) && stored >= 1 && stored <= 600 ? stored : 6;
  });
  const [autoAdvanceVideos, setAutoAdvanceVideos] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("autoAdvanceVideos") === "true";
  });
  const [mediaTypes, setMediaTypes] = useState(() => {
    if (typeof window === "undefined") return "both";
    const stored = window.localStorage.getItem("mediaTypes");
    return stored === "images" || stored === "videos" ? stored : "both";
  });

  useEffect(() => {
    window.localStorage.setItem("autoAdvanceSeconds", String(autoAdvanceSeconds));
  }, [autoAdvanceSeconds]);

  useEffect(() => {
    window.localStorage.setItem("autoAdvanceVideos", String(autoAdvanceVideos));
  }, [autoAdvanceVideos]);

  useEffect(() => {
    window.localStorage.setItem("mediaTypes", mediaTypes);
  }, [mediaTypes]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT;
    const stored = Number(window.localStorage.getItem("sidebarWidth"));
    const fromStorage =
      Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX
        ? stored
        : SIDEBAR_DEFAULT;
    const maxForViewport = Math.max(SIDEBAR_MIN, window.innerWidth - 320);
    return Math.min(fromStorage, maxForViewport);
  });

  useEffect(() => {
    window.localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + delta)
      );
      setSidebarWidth(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    api("/api/auth/status")
      .then((data) => setSignedIn(data.signedIn))
      .catch(() => setSignedIn(false));
  }, []);

  async function startSession(event) {
    event.preventDefault();
    if (!selectedFolder) {
      setError("Pick a Drive folder first.");
      return;
    }
    await run(async () => {
      const nextState = await api("/api/session/start", {
        method: "POST",
        body: { folderIdOrUrl: selectedFolder.id, maxItems, mediaTypes }
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
    setBusy(true);
    setError("");
    try {
      await api("/api/session/end", { method: "POST" });
    } catch {
      // server may have no active session — clearing local state regardless
    } finally {
      setBusy(false);
      setState(null);
      setAutoAdvance(false);
    }
  }

  async function changeMediaTypes(value) {
    if (value === mediaTypes) return;
    setMediaTypes(value);
    if (!state) return;
    await run(async () => {
      setState(
        await api("/api/session/media-types", {
          method: "POST",
          body: { mediaTypes: value }
        })
      );
    });
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

  function toggleExpanded(folderId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
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
    <main className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` }}>
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
            <button
              type="button"
              className="folder-picker-trigger"
              onClick={() => setPickerOpen(true)}
              disabled={!signedIn}
              title={signedIn ? "Browse your Drive" : "Sign in first"}
            >
              <Folder size={16} aria-hidden="true" />
              <span>{selectedFolder ? selectedFolder.name : "Browse Drive..."}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
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
          <button className="primary-button" type="submit" disabled={busy || !selectedFolder}>
            {busy ? <Loader2 className="spin" size={18} /> : <CirclePlay size={18} />}
            Start
          </button>
        </form>

        {pickerOpen ? (
          <FolderPicker
            onPick={(folder) => {
              setSelectedFolder(folder);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        <section className="panel">
          <div className="section-title">
            <Image size={17} aria-hidden="true" />
            Media types
          </div>
          <div className="segmented" role="radiogroup" aria-label="Media types">
            <button
              type="button"
              role="radio"
              aria-checked={mediaTypes === "both"}
              className={mediaTypes === "both" ? "seg active" : "seg"}
              onClick={() => changeMediaTypes("both")}
            >
              Both
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mediaTypes === "images"}
              className={mediaTypes === "images" ? "seg active" : "seg"}
              onClick={() => changeMediaTypes("images")}
            >
              Pictures
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mediaTypes === "videos"}
              className={mediaTypes === "videos" ? "seg active" : "seg"}
              onClick={() => changeMediaTypes("videos")}
            >
              Videos
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="section-title">
            <CirclePlay size={17} aria-hidden="true" />
            Auto advance
          </div>
          <label>
            Seconds per image
            <input
              type="number"
              min="1"
              max="600"
              value={autoAdvanceSeconds}
              onChange={(event) => {
                const value = Number(event.target.value);
                setAutoAdvanceSeconds(
                  Number.isFinite(value) && value >= 1 ? Math.min(value, 600) : 1
                );
              }}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoAdvanceVideos}
              onChange={(event) => setAutoAdvanceVideos(event.target.checked)}
            />
            Use timer for videos too
          </label>
        </section>

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

      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startResize}
      />

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
          folders={state?.folders}
          hasSession={state !== null}
          exhausted={state?.exhausted}
          busy={busy}
          autoAdvance={autoAdvance}
          autoAdvanceSeconds={autoAdvanceSeconds}
          autoAdvanceVideos={autoAdvanceVideos}
          onEnded={next}
        />
      </section>
    </main>
  );
}

function FolderPicker({ onPick, onClose }) {
  const [stack, setStack] = useState([{ id: "root", name: "My Drive" }]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const current = stack[stack.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api(`/api/drive/folders?parentId=${encodeURIComponent(current.id)}`)
      .then((data) => {
        if (cancelled) return;
        setFolders(data.files ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setFolders([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current.id]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function navigateInto(folder) {
    setStack((prev) => [...prev, folder]);
  }

  function navigateTo(index) {
    setStack((prev) => prev.slice(0, index + 1));
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Pick a Drive folder</h2>
          <button
            type="button"
            className="icon-button small"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="breadcrumbs">
          {stack.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 ? (
                <ChevronRight size={14} className="crumb-sep" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                className="crumb"
                onClick={() => navigateTo(index)}
                disabled={index === stack.length - 1}
              >
                {item.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="folder-list">
          {loading ? (
            <div className="folder-list-message">
              <Loader2 className="spin" size={18} />
              Loading...
            </div>
          ) : null}
          {error ? <div className="folder-list-message error">{error}</div> : null}
          {!loading && !error && folders.length === 0 ? (
            <div className="folder-list-message">No subfolders here.</div>
          ) : null}
          {!loading && !error
            ? folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="folder-list-item"
                  onClick={() => navigateInto(folder)}
                >
                  <Folder size={16} aria-hidden="true" />
                  <span title={folder.name}>{folder.name}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))
            : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onPick(current)}
          >
            Pick "{current.name}"
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaStage({
  item,
  folders,
  hasSession,
  exhausted,
  busy,
  autoAdvance,
  autoAdvanceSeconds,
  autoAdvanceVideos,
  onEnded
}) {
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  // Auto-advance timer — driven by state, not events. The effect re-runs when
  // autoAdvance, autoAdvanceSeconds, autoAdvanceVideos, or item change, so
  // toggling auto-advance ON while an item is already showing immediately
  // starts a fresh timer (this was the bug — the old code ran setTimeout
  // inside img.onLoad / video.onPlay, neither of which re-fires on toggle).
  useEffect(() => {
    return runAutoAdvanceEffect({
      item,
      autoAdvance,
      autoAdvanceSeconds,
      autoAdvanceVideos,
      onEnded: () => onEndedRef.current?.()
    });
  }, [
    item?.id,
    item?.mimeType,
    autoAdvance,
    autoAdvanceSeconds,
    autoAdvanceVideos
  ]);

  const fullPath = useMemo(
    () => (item ? buildItemPath(item, folders) : ""),
    [item, folders]
  );

  if (!item) {
    if (hasSession && !exhausted) {
      return (
        <div className="empty-stage">
          <p>
            Filter folders in the sidebar, then click{" "}
            <button
              type="button"
              className="link-button"
              onClick={onEnded}
              disabled={busy}
            >
              Next
            </button>{" "}
            to begin.
          </p>
        </div>
      );
    }
    const message = exhausted ? "No more eligible media." : "Start a session to begin.";
    return (
      <div className="empty-stage">
        <p>{message}</p>
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
            autoPlay
            onEnded={autoAdvance && !autoAdvanceVideos ? onEnded : undefined}
            onError={(event) => {
              const code = event.currentTarget.error?.code;
              // 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED.
              // Skip past anything the browser can't play; leave network
              // errors (code 2) on screen so the user can retry.
              if (code === 3 || code === 4) onEnded();
            }}
          />
        ) : (
          <img
            key={item.id}
            src={src}
            alt={item.name}
            onError={() => onEnded()}
          />
        )}
      </div>
      <div className="caption">
        {isVideo ? <Video size={18} aria-hidden="true" /> : <Image size={18} aria-hidden="true" />}
        <span title={fullPath}>{fullPath}</span>
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

function buildItemPath(item, folders) {
  if (!item) return "";
  if (!folders?.length) return item.name;
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const parentId = item.parentIds?.[0];
  if (!parentId) return item.name;

  const segments = [item.name];
  let cursor = foldersById.get(parentId);
  while (cursor) {
    segments.unshift(cursor.name);
    cursor = cursor.parentId ? foldersById.get(cursor.parentId) : null;
  }
  return segments.join(" › ");
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
