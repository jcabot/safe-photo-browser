import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../server/sessionManager.js";

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

    expect(manager.getState().current.id).toBe("bee");
    Math.random.mockRestore();
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
    const state = await manager.setFolderIncluded("a", false);

    expect(state.folders.find((item) => item.id === "a").included).toBe(false);
    expect(state.current?.parentIds.includes("a")).toBe(false);
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
    }
  };
}

function folder(id, name) {
  return { id, name, mimeType: FOLDER, parents: ["root"] };
}

function image(id, name, parent = "root") {
  return { id, name, mimeType: "image/jpeg", parents: [parent] };
}
