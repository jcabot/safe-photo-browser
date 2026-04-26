import { randomUUID } from "node:crypto";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const QUEUE_TARGET = 5;
const PAGE_SIZE = 50;

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
      nextPageToken: null
    });

    await this.fillQueue();
    if (this.session.queue.length > 0) {
      this.session.current = this.session.queue.shift();
      this.session.history.push(this.session.current);
      this.session.shownCount += 1;
      await this.fillQueue();
    }

    return this.getState();
  }

  async next() {
    this.requireSession();
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

    this.session.history.pop();
    this.session.current = this.session.history[this.session.history.length - 1];
    return this.getState();
  }

  async setFolderIncluded(folderId, included) {
    this.requireSession();
    const folder = this.session.folders.get(folderId);
    if (!folder) {
      throw new Error("Folder has not been discovered yet.");
    }

    folder.included = Boolean(included);
    this.session.queue = this.session.queue.filter((item) => this.isMediaEligible(item));

    if (this.session.current && !this.isMediaEligible(this.session.current)) {
      return this.next();
    }

    await this.fillQueue();
    return this.getState();
  }

  async expandFolder(folderId) {
    this.requireSession();
    const folder = this.session.folders.get(folderId);
    if (!folder) {
      throw new Error("Folder has not been discovered yet.");
    }

    if (!folder.exhausted) {
      await this.exploreFolder(folderId);
      await this.fillQueue();
    }

    return this.getState();
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

  async fillQueue() {
    this.requireSession();
    while (
      this.session.queue.length < QUEUE_TARGET &&
      this.session.shownCount + this.session.queue.length < this.session.maxItems
    ) {
      const queued = await this.discoverOneStep();
      if (!queued) {
        break;
      }
    }

    if (this.session.queue.length === 0 && !this.hasEligibleFrontier()) {
      this.session.exhausted = true;
    }
  }

  async discoverOneStep() {
    const eligibleFolders = this.session.frontier.filter((folderId) => {
      const folder = this.session.folders.get(folderId);
      return folder && !folder.exhausted && this.isFolderPathIncluded(folderId);
    });

    if (eligibleFolders.length === 0) {
      return false;
    }

    const folderId = eligibleFolders[Math.floor(Math.random() * eligibleFolders.length)];
    const foundMedia = await this.exploreFolder(folderId);
    return foundMedia || this.hasEligibleFrontier();
  }

  async exploreFolder(folderId) {
    const folder = this.session.folders.get(folderId);
    if (!folder || folder.exhausted || !this.isFolderPathIncluded(folderId)) {
      return false;
    }

    const page = await this.driveService.listFolderPage({
      folderId,
      pageToken: folder.nextPageToken,
      pageSize: PAGE_SIZE
    });

    folder.discovered = true;
    folder.nextPageToken = page.nextPageToken ?? null;
    if (!folder.nextPageToken) {
      folder.exhausted = true;
      this.session.frontier = this.session.frontier.filter((id) => id !== folderId);
    }

    const media = [];
    for (const file of page.files) {
      if (file.mimeType === FOLDER_MIME) {
        this.addFolder(file, folderId);
      } else if (isSupportedMedia(file) && !this.session.seenFileIds.has(file.id)) {
        media.push(toMediaItem(file, folderId));
      }
    }

    shuffle(media);
    for (const item of media) {
      if (this.session.shownCount + this.session.queue.length >= this.session.maxItems) {
        break;
      }
      this.session.seenFileIds.add(item.id);
      if (this.isMediaEligible(item)) {
        this.session.queue.push(item);
      }
    }

    return media.length > 0;
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
        nextPageToken: null
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
    return this.session.frontier.some((folderId) => {
      const folder = this.session.folders.get(folderId);
      return folder && !folder.exhausted && this.isFolderPathIncluded(folderId);
    });
  }

  requireSession() {
    if (!this.session) {
      throw new Error("Start a browsing session first.");
    }
  }
}

export function isSupportedMedia(file) {
  return file.mimeType?.startsWith("image/") || file.mimeType?.startsWith("video/");
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

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}
