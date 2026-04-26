import { describe, expect, it, vi } from "vitest";
import { SessionManager, isSupportedMedia } from "../server/sessionManager.js";

const FOLDER = "application/vnd.google-apps.folder";

describe("SessionManager", () => {
  it("does not repeat files and stops at maxItems", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [
          image("one", "One"),
          image("two", "Two"),
          image("three", "Three")
        ]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 2 });
    expect(manager.getState().current).toBeNull();

    await manager.next();
    const first = manager.getState().current.id;
    await manager.next();
    const second = manager.getState().current.id;
    await manager.next();

    expect(new Set([first, second]).size).toBe(2);
    expect(manager.getState().shownCount).toBe(2);
    expect(manager.getState().exhausted).toBe(true);
  });

  it("continues when one folder is exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [folder("a", "A"), folder("b", "B")],
        a: [],
        b: [image("bee", "Bee")]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 5 });
    await manager.next();

    expect(manager.getState().current.id).toBe("bee");
    Math.random.mockRestore();
  });

  it("preserves items when going back, then forward through history", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [image("one", "One"), image("two", "Two"), image("three", "Three")]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 5 });
    await manager.next();
    const first = manager.getState().current.id;
    await manager.next();
    const second = manager.getState().current.id;
    await manager.next();
    const third = manager.getState().current.id;

    await manager.previous();
    expect(manager.getState().current.id).toBe(second);
    await manager.previous();
    expect(manager.getState().current.id).toBe(first);

    await manager.next();
    expect(manager.getState().current.id).toBe(second);
    await manager.next();
    expect(manager.getState().current.id).toBe(third);
  });

  it("does not count forward-stack replays against maxItems", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [image("one", "One"), image("two", "Two")]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 2 });
    await manager.next();
    await manager.next();
    expect(manager.getState().shownCount).toBe(2);

    await manager.previous();
    await manager.next();
    expect(manager.getState().shownCount).toBe(2);
    expect(manager.getState().current).not.toBeNull();
  });

  it("end() clears the session so getState throws", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({ root: [image("one", "One")] })
    });

    await manager.start({ rootFolderId: "root", maxItems: 5 });
    expect(manager.end()).toEqual({ ok: true });
    expect(() => manager.getState()).toThrow(/session/i);
  });

  it("rotates files across folders and gives varied sequences across runs", async () => {
    function build() {
      return new SessionManager({
        driveService: fakeDrive({
          root: [
            folder("a", "A"),
            folder("b", "B"),
            image("r1", "R1"),
            image("r2", "R2")
          ],
          a: [
            folder("a1", "A1"),
            image("a-img1", "A1Img", "a"),
            image("a-img2", "A2Img", "a")
          ],
          b: [image("b-img1", "B1Img", "b"), image("b-img2", "B2Img", "b")],
          a1: [image("a1-img1", "A1-1Img", "a1")]
        })
      });
    }

    async function runSession(maxItems) {
      const manager = build();
      await manager.start({ rootFolderId: "root", maxItems });
      const items = [];
      while (items.length < maxItems) {
        const result = await manager.next();
        if (!result.current) break;
        items.push(result.current);
      }
      return items;
    }

    const RUNS = 5;
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      runs.push(await runSession(5));
    }

    for (const items of runs) {
      // Each run yields some items.
      expect(items.length).toBeGreaterThan(0);
      // Each run pulls from at least two distinct parent folders (the new
      // tree-walk algorithm should not drain one folder before moving on).
      const parents = new Set(items.flatMap((item) => item.parentIds));
      expect(parents.size).toBeGreaterThan(1);
      // No item repeats within a single run.
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }

    // Runs should produce varied sequences. With 5 runs over a 7-item tree
    // and ~12 random choices per run, the chance of all five runs producing
    // the same sequence is astronomically small.
    const sequences = runs.map((items) =>
      items.map((item) => item.id).join(",")
    );
    expect(new Set(sequences).size).toBeGreaterThan(1);

    // Root-level files must be reachable. At each tree-walk level root has
    // a 1/(K+1) chance of being chosen, so across 25 picks we should see
    // a root file in at least one run.
    expect(
      runs.some((items) =>
        items.some((item) => item.parentIds.includes("root"))
      )
    ).toBe(true);
  });

  it("isSupportedMedia accepts browser-playable formats", () => {
    expect(isSupportedMedia({ mimeType: "image/jpeg" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "image/png" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "image/webp" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "image/gif" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "video/mp4" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "video/webm" })).toBe(true);
    expect(isSupportedMedia({ mimeType: "video/quicktime" })).toBe(true);
  });

  it("isSupportedMedia rejects formats browsers cannot decode natively", () => {
    // AVCHD camcorder format (.MTS / .M2TS) — what the user hit
    expect(isSupportedMedia({ mimeType: "video/mp2t" })).toBe(false);
    // Other Windows / legacy video containers
    expect(isSupportedMedia({ mimeType: "video/x-msvideo" })).toBe(false);
    expect(isSupportedMedia({ mimeType: "video/x-ms-wmv" })).toBe(false);
    expect(isSupportedMedia({ mimeType: "video/x-flv" })).toBe(false);
    expect(isSupportedMedia({ mimeType: "video/avi" })).toBe(false);
    // iPhone default photo format — Chrome can't decode
    expect(isSupportedMedia({ mimeType: "image/heic" })).toBe(false);
    expect(isSupportedMedia({ mimeType: "image/heif" })).toBe(false);
    // Non-media types
    expect(isSupportedMedia({ mimeType: "application/pdf" })).toBe(false);
    expect(isSupportedMedia({ mimeType: undefined })).toBe(false);
  });

  it("session never queues an .MTS file", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [
          { id: "mts1", name: "20111209203447.MTS", mimeType: "video/mp2t", parents: ["root"] },
          { id: "img1", name: "ok.jpg", mimeType: "image/jpeg", parents: ["root"] }
        ]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 5 });
    const items = [];
    while (items.length < 5) {
      const result = await manager.next();
      if (!result.current) break;
      items.push(result.current);
    }

    expect(items.length).toBe(1);
    expect(items[0].id).toBe("img1");
    expect(items.some((item) => item.mimeType === "video/mp2t")).toBe(false);
  });

  it("samples across ALL pages of a multi-page folder, not just the first", async () => {
    // Regression: a folder of e.g. 500 photos sorted by date used to rotate
    // only page 1 (the earliest 50) until exhausted, so the user saw "only
    // January" before any later months appeared. The fix drains every page
    // of the chosen folder before sampling.
    const PAGE_OF = 10;
    const TOTAL_PAGES = 3;
    const allFiles = Array.from({ length: PAGE_OF * TOTAL_PAGES }, (_, i) => ({
      id: `f${i}`,
      name: `file${i}.jpg`,
      mimeType: "image/jpeg",
      parents: ["root"]
    }));

    const drive = {
      async getFolder(id) {
        return { id, name: id, mimeType: FOLDER };
      },
      async listFolderPage({ folderId, pageToken }) {
        if (folderId !== "root") return { files: [], nextPageToken: null };
        const idx = pageToken ? Number(pageToken) : 0;
        const start = idx * PAGE_OF;
        const slice = allFiles.slice(start, start + PAGE_OF);
        const next =
          start + PAGE_OF < allFiles.length ? String(idx + 1) : null;
        return { files: slice, nextPageToken: next };
      },
      async listSubfolders() {
        return { files: [], nextPageToken: null };
      }
    };

    const RUNS = 3;
    for (let run = 0; run < RUNS; run += 1) {
      const manager = new SessionManager({ driveService: drive });
      await manager.start({ rootFolderId: "root", maxItems: 10 });
      const items = [];
      while (items.length < 10) {
        const result = await manager.next();
        if (!result.current) break;
        items.push(result.current);
      }
      expect(items.length).toBe(10);

      // The 10 items should span at least 2 of the 3 pages. Without the fix
      // they'd all be from page 0 (f0..f9). The probability of a fair sample
      // of 10 from 30 items landing entirely in one page is ~1.7e-5 per run,
      // so this is essentially deterministic.
      const pagesUsed = new Set(
        items.map((item) => Math.floor(Number(item.id.slice(1)) / PAGE_OF))
      );
      expect(pagesUsed.size).toBeGreaterThan(1);

      // Every item is unique across pages too.
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    }
  });

  it("expandFolder is a no-op that returns state without crashing", async () => {
    // Regression: expandFolder used to call this.exploreFolder, which was
    // renamed to fetchNextPage during the per-folder-buffer refactor. The
    // dangling reference threw TypeError on every chevron click in the tree.
    // Now expandFolder just validates the folder id and echoes state.
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [folder("a", "A"), image("r1", "R1")],
        a: [image("a1", "A1", "a")]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 5 });

    // Pre-viewing (current === null): expand should still work.
    const preState = await manager.expandFolder("a");
    expect(preState.current).toBeNull();
    expect(preState.folders.find((f) => f.id === "a")).toBeDefined();

    // Mid-viewing (current is set): also works.
    await manager.next();
    const midState = await manager.expandFolder("a");
    expect(midState.current).not.toBeNull();

    // Unknown folder id throws.
    await expect(manager.expandFolder("nonexistent")).rejects.toThrow(
      /not been discovered/i
    );
  });

  it("respects excluded folders and removes queued descendants", async () => {
    const manager = new SessionManager({
      driveService: fakeDrive({
        root: [folder("a", "A"), folder("b", "B")],
        a: [image("aye", "Aye", "a")],
        b: [image("bee", "Bee", "b")]
      })
    });

    await manager.start({ rootFolderId: "root", maxItems: 10 });
    await manager.setFolderIncluded("a", false);
    await manager.next();
    const state = manager.getState();

    expect(state.folders.find((item) => item.id === "a").included).toBe(false);
    expect(state.current).not.toBeNull();
    expect(state.current.parentIds.includes("a")).toBe(false);
  });
});

function fakeDrive(pages) {
  return {
    async getFolder(id) {
      return { id, name: id, mimeType: FOLDER };
    },
    async listFolderPage({ folderId }) {
      return {
        files: pages[folderId] ?? [],
        nextPageToken: null
      };
    },
    async listSubfolders({ parentId }) {
      const items = pages[parentId] ?? [];
      return {
        files: items.filter((item) => item.mimeType === FOLDER),
        nextPageToken: null
      };
    }
  };
}

function folder(id, name) {
  return { id, name, mimeType: FOLDER, parents: ["root"] };
}

function image(id, name, parent = "root") {
  return { id, name, mimeType: "image/jpeg", parents: [parent] };
}
