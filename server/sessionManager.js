import { randomUUID } from "node:crypto";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const QUEUE_TARGET = 5;
// Drive's max is 1000. Bigger pages let folders ≤1000 items load in a single
// call; bigger folders still need multiple calls (drained on first pick).
const PAGE_SIZE = 1000;

export class SessionManager {
  constructor({ driveService }) {
    this.driveService = driveService;
    this.session = null;
  }

  async start({ rootFolderId, maxItems = 100 }) {
    const cleanMax = Number.isFinite(Number(maxItems))
      ? Math.max(1, Math.min(5000, Math.floor(Number(maxItems))))
      : 100;
    const root = await this.driveService.getFolder(rootFolderId);

    this.session = {
      id: randomUUID(),
      rootFolderId: root.id,
      current: null,
      history: [],
      forwardStack: [],
      queue: [],
      seenFileIds: new Set(),
      shownCount: 0,
      maxItems: cleanMax,
      exhausted: false,
      folders: new Map(),
      frontier: [root.id]
    };

    this.session.folders.set(root.id, {
      id: root.id,
      name: root.name,
      parentId: null,
      children: [],
      included: true,
      discovered: false,
      exhausted: false,
      nextPageToken: null,
      mediaBuffer: []
    });

    await this.discoverFolderTree();

    return this.getState();
  }

  async next() {
    this.requireSession();

    if (this.session.forwardStack.length > 0) {
      const item = this.session.forwardStack.pop();
      this.session.current = item;
      this.session.history.push(item);
      return this.getState();
    }

    if (this.session.shownCount >= this.session.maxItems) {
      this.session.current = null;
      this.session.exhausted = true;
      return this.getState();
    }

    await this.fillQueue();
    const nextItem = this.session.queue.shift() ?? null;
    this.session.current = nextItem;

    if (nextItem) {
      this.session.history.push(nextItem);
      this.session.shownCount += 1;
      await this.fillQueue();
    } else {
      this.session.exhausted = true;
    }

    return this.getState();
  }

  async previous() {
    this.requireSession();
    if (this.session.history.length <= 1) {
      return this.getState();
    }

    const popped = this.session.history.pop();
    this.session.forwardStack.push(popped);
    this.session.current = this.session.history[this.session.history.length - 1];
    return this.getState();
  }

  end() {
    this.session = null;
    return { ok: true };
  }

  async setFolderIncluded(folderId, included) {
    this.requireSession();
    const folder = this.session.folders.get(folderId);
    if (!folder) {
      throw new Error("Folder has not been discovered yet.");
    }

    folder.included = Boolean(included);
    this.session.queue = this.session.queue.filter((item) => this.isMediaEligible(item));
    this.session.forwardStack = this.session.forwardStack.filter((item) =>
      this.isMediaEligible(item)
    );

    if (this.session.current && !this.isMediaEligible(this.session.current)) {
      return this.next();
    }

    if (this.session.current !== null) {
      await this.fillQueue();
    }
    return this.getState();
  }

  async expandFolder(folderId) {
    // Folder discovery is eager (discoverFolderTree at session start), so
    // every subfolder is already known to the client. Expansion is a UI-only
    // concern; this endpoint exists only to validate the folder ID and echo
    // current state. Media for this folder will be fetched lazily by
    // discoverOneStep if/when the tree walk picks it.
    this.requireSession();
    const folder = this.session.folders.get(folderId);
    if (!folder) {
      throw new Error("Folder has not been discovered yet.");
    }
    return this.getState();
  }

  findKnownMedia(fileId) {
    if (!this.session) return null;
    if (this.session.current?.id === fileId) return this.session.current;
    return (
      this.session.queue.find((item) => item.id === fileId) ??
      this.session.history.find((item) => item.id === fileId) ??
      this.session.forwardStack.find((item) => item.id === fileId) ??
      null
    );
  }

  getState() {
    this.requireSession();
    return {
      id: this.session.id,
      rootFolderId: this.session.rootFolderId,
      current: this.session.current,
      folders: Array.from(this.session.folders.values()).map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        children: folder.children,
        included: folder.included,
        discovered: folder.discovered,
        exhausted: folder.exhausted
      })),
      queueLength: this.session.queue.length,
      shownCount: this.session.shownCount,
      maxItems: this.session.maxItems,
      exhausted: this.session.exhausted || this.session.shownCount >= this.session.maxItems
    };
  }

  async discoverFolderTree() {
    let level = [this.session.rootFolderId];
    while (level.length > 0) {
      const results = await Promise.all(
        level.map((folderId) => this.listAllSubfolders(folderId))
      );
      const next = [];
      for (let i = 0; i < level.length; i += 1) {
        const parentId = level[i];
        for (const file of results[i]) {
          this.addFolder(file, parentId);
          next.push(file.id);
        }
      }
      level = next;
    }
  }

  async listAllSubfolders(folderId) {
    const all = [];
    let pageToken = null;
    do {
      const page = await this.driveService.listSubfolders({
        parentId: folderId,
        pageToken
      });
      for (const file of page.files) {
        all.push(file);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  }

  async fillQueue() {
    this.requireSession();
    while (
      this.session.queue.length < QUEUE_TARGET &&
      this.session.shownCount + this.session.queue.length < this.session.maxItems
    ) {
      const item = await this.discoverOneStep();
      if (item === null) break;
      if (this.isMediaEligible(item)) {
        this.session.queue.push(item);
      }
    }

    if (this.session.queue.length === 0 && !this.hasEligibleFrontier()) {
      this.session.exhausted = true;
    }
  }

  async discoverOneStep() {
    while (true) {
      const root = this.session.folders.get(this.session.rootFolderId);
      if (!root || !this.subtreeHasPickableMedia(root)) return null;

      const folder = this.pickFolderByTreeWalk(root);
      if (!folder) return null;

      // Drain ALL pages of the chosen folder before sampling. Without this,
      // a folder of e.g. 500 photos sorted by date would only ever rotate
      // page 1 (the earliest 50 photos) until fully consumed. Sampling has
      // to happen against the full folder, not the first page.
      while (!folder.exhausted) {
        await this.fetchNextPage(folder.id);
      }

      if (folder.mediaBuffer.length > 0) {
        const idx = Math.floor(Math.random() * folder.mediaBuffer.length);
        const [item] = folder.mediaBuffer.splice(idx, 1);
        return item;
      }
      // Picked folder yielded no media at all (e.g., only subfolders).
      // Retry the tree walk.
    }
  }

  pickFolderByTreeWalk(start) {
    let cursor = start;
    while (true) {
      const options = [];
      if (this.folderHasPickable(cursor)) {
        options.push(cursor);
      }
      for (const childId of cursor.children) {
        const child = this.session.folders.get(childId);
        if (child && this.subtreeHasPickableMedia(child)) {
          options.push(child);
        }
      }
      if (options.length === 0) return null;
      const chosen = options[Math.floor(Math.random() * options.length)];
      if (chosen === cursor) return cursor;
      cursor = chosen;
    }
  }

  folderHasPickable(folder) {
    return folder.mediaBuffer.length > 0 || !folder.exhausted;
  }

  subtreeHasPickableMedia(folder) {
    if (!folder.included) return false;
    if (this.folderHasPickable(folder)) return true;
    for (const childId of folder.children) {
      const child = this.session.folders.get(childId);
      if (child && this.subtreeHasPickableMedia(child)) return true;
    }
    return false;
  }

  async fetchNextPage(folderId) {
    const folder = this.session.folders.get(folderId);
    if (!folder || folder.exhausted) return;

    const page = await this.driveService.listFolderPage({
      folderId,
      pageToken: folder.nextPageToken,
      pageSize: PAGE_SIZE
    });

    folder.discovered = true;
    folder.nextPageToken = page.nextPageToken ?? null;
    if (!folder.nextPageToken) {
      folder.exhausted = true;
    }

    for (const file of page.files) {
      if (file.mimeType === FOLDER_MIME) {
        this.addFolder(file, folderId);
      } else if (
        isSupportedMedia(file) &&
        !this.session.seenFileIds.has(file.id)
      ) {
        this.session.seenFileIds.add(file.id);
        folder.mediaBuffer.push(toMediaItem(file, folderId));
      }
    }
  }

  addFolder(file, parentId) {
    const parent = this.session.folders.get(parentId);
    if (!this.session.folders.has(file.id)) {
      this.session.folders.set(file.id, {
        id: file.id,
        name: file.name,
        parentId,
        children: [],
        included: true,
        discovered: false,
        exhausted: false,
        nextPageToken: null,
        mediaBuffer: []
      });
      this.session.frontier.push(file.id);
    }

    if (parent && !parent.children.includes(file.id)) {
      parent.children.push(file.id);
    }
  }

  isMediaEligible(item) {
    return item.parentIds.some((folderId) => this.isFolderPathIncluded(folderId));
  }

  isFolderPathIncluded(folderId) {
    let cursor = this.session.folders.get(folderId);
    while (cursor) {
      if (!cursor.included) {
        return false;
      }
      cursor = cursor.parentId ? this.session.folders.get(cursor.parentId) : null;
    }
    return true;
  }

  hasEligibleFrontier() {
    const root = this.session.folders.get(this.session.rootFolderId);
    return Boolean(root && this.subtreeHasPickableMedia(root));
  }

  requireSession() {
    if (!this.session) {
      throw new Error("Start a browsing session first.");
    }
  }
}

const UNPLAYABLE_MIMES = new Set([
  "video/mp2t",        // .mts, .m2ts, .ts (AVCHD camcorder format)
  "video/x-msvideo",   // .avi
  "video/x-ms-wmv",    // .wmv
  "video/x-ms-asf",    // .asf
  "video/avi",
  "video/x-flv",       // .flv
  "image/heic",        // iPhone default
  "image/heif"
]);

export function isSupportedMedia(file) {
  if (!file.mimeType) return false;
  if (UNPLAYABLE_MIMES.has(file.mimeType)) return false;
  return (
    file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/")
  );
}

function toMediaItem(file, parentId) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parentIds: file.parents?.length ? file.parents : [parentId],
    thumbnailLink: file.thumbnailLink ?? null,
    webViewLink: file.webViewLink ?? null,
    size: file.size ? Number(file.size) : null
  };
}

