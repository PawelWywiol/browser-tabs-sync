import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply } from "../src/shared/apply";
import { diff } from "../src/shared/diff";
import type { BrowserState } from "../src/shared/types";

let nextTab = 500;
const api = {
  windows: { create: vi.fn() },
  tabs: {
    create: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    getCurrent: vi.fn(),
  },
  tabGroups: { update: vi.fn() },
  bookmarks: { create: vi.fn(), remove: vi.fn(), getTree: vi.fn(), move: vi.fn(), update: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.create.mockImplementation(async () => ({ id: nextTab++ }));
  api.windows.create.mockImplementation(async () => ({ id: 77, tabs: [{ id: nextTab++ }] }));
  api.tabs.group.mockResolvedValue(9);
  api.tabs.getCurrent.mockResolvedValue({ windowId: 999 });
  api.bookmarks.create.mockImplementation(async (p) => ({ id: `new-${p.title}` }));
  api.bookmarks.getTree.mockResolvedValue([{ children: [] }]);
  vi.stubGlobal("chrome", api);
});

const base = { pinned: false, active: false, title: "" };
const local: BrowserState = {
  windows: [
    {
      localId: 1,
      groups: [{ ref: "g1", title: "Old", color: "red", collapsed: false, localId: 40 }],
      tabs: [
        { ...base, url: "keep", localId: 10, groupRef: "g1" },
        { ...base, url: "gone", localId: 11 },
      ],
    },
  ],
  bookmarks: [],
};
const target: BrowserState = {
  windows: [
    {
      groups: [{ ref: "n", title: "New", color: "blue", collapsed: true }],
      tabs: [
        { ...base, url: "new", pinned: true },
        { ...base, url: "keep", active: true, groupRef: "n" },
      ],
    },
  ],
  bookmarks: [],
};
const all = (changes: ReturnType<typeof diff>) =>
  new Set([...changes.tabs, ...changes.bookmarks].map((c) => c.id));

describe("apply tabs", () => {
  it("opens, closes, orders, groups and restores active and collapsed state", async () => {
    const changes = diff(local, target);
    expect(await apply(local, target, changes, all(changes))).toEqual([]);
    expect(api.tabs.create).toHaveBeenCalledWith({
      windowId: 1,
      url: "new",
      pinned: true,
      active: false,
    });
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
    expect(api.tabs.move.mock.calls.map((c) => c[1].index)).toEqual([0, 1]);
    expect(api.tabs.group).toHaveBeenCalledWith({
      createProperties: { windowId: 1 },
      tabIds: [10],
    });
    expect(api.tabGroups.update).toHaveBeenCalledWith(9, {
      title: "New",
      color: "blue",
      collapsed: false,
    });
    expect(api.tabGroups.update).toHaveBeenLastCalledWith(9, { collapsed: true });
    expect(api.tabs.update).toHaveBeenCalledWith(10, { active: true });
  });

  it("honours unchecked items", async () => {
    const changes = diff(local, target);
    await apply(local, target, changes, new Set());
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it("creates a window for an unpaired target window", async () => {
    const changes = diff(
      { windows: [], bookmarks: [] },
      {
        windows: [
          {
            groups: [],
            tabs: [
              { ...base, url: "a" },
              { ...base, url: "b" },
            ],
          },
        ],
        bookmarks: [],
      },
    );
    await apply(
      { windows: [], bookmarks: [] },
      {
        windows: [
          {
            groups: [],
            tabs: [
              { ...base, url: "a" },
              { ...base, url: "b" },
            ],
          },
        ],
        bookmarks: [],
      },
      changes,
      all(changes),
    );
    expect(api.windows.create).toHaveBeenCalledWith({ url: "a", focused: false });
    expect(api.tabs.create).toHaveBeenCalledWith({
      windowId: 77,
      url: "b",
      pinned: false,
      active: false,
    });
  });

  it("reports a refused URL and continues", async () => {
    api.tabs.create.mockRejectedValueOnce(new Error("refused"));
    const changes = diff(local, target);
    const failures = await apply(local, target, changes, all(changes));
    expect(failures).toEqual([{ url: "new", message: "Error: refused" }]);
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
  });

  it("does not steal focus in the window showing the preview", async () => {
    api.tabs.getCurrent.mockResolvedValue({ windowId: 1 });
    const changes = diff(local, target);
    await apply(local, target, changes, all(changes));
    expect(api.tabs.update).not.toHaveBeenCalledWith(10, { active: true });
  });
});

describe("apply bookmarks", () => {
  const withBookmarks = (
    children: BrowserState["bookmarks"][number]["children"],
  ): BrowserState => ({
    windows: [],
    bookmarks: [{ folderType: "bookmarks-bar", localId: "1", children }],
  });

  it("creates missing parent folders before bookmarks", async () => {
    const before = withBookmarks([]);
    const after = withBookmarks([
      { kind: "folder", title: "F", children: [{ kind: "bookmark", title: "X", url: "x" }] },
    ]);
    const changes = diff(before, after);
    await apply(before, after, changes, all(changes));
    expect(api.bookmarks.create.mock.calls.map((c) => c[0])).toEqual([
      { parentId: "1", title: "F" },
      { parentId: "new-F", title: "X", url: "x" },
    ]);
  });

  it("creates an unchecked parent when a child stays checked", async () => {
    const before = withBookmarks([]);
    const after = withBookmarks([
      { kind: "folder", title: "F", children: [{ kind: "bookmark", title: "X", url: "x" }] },
    ]);
    const changes = diff(before, after);
    await apply(
      before,
      after,
      changes,
      new Set(changes.bookmarks.filter((b) => b.url).map((b) => b.id)),
    );
    expect(api.bookmarks.create).toHaveBeenCalledTimes(2);
  });

  it("removes bookmarks before folders and ignores folders that stay non-empty", async () => {
    const before = withBookmarks([
      {
        kind: "folder",
        title: "F",
        localId: "f",
        children: [{ kind: "bookmark", title: "X", url: "x", localId: "b" }],
      },
    ]);
    const after = withBookmarks([]);
    api.bookmarks.remove.mockImplementation(async (id) => {
      if (id === "f") throw new Error("not empty");
    });
    const changes = diff(before, after);
    expect(await apply(before, after, changes, all(changes))).toEqual([]);
    expect(api.bookmarks.remove.mock.calls.map((c) => c[0])).toEqual(["b", "f"]);
  });

  it("aligns order and titles of existing bookmarks", async () => {
    const after = withBookmarks([
      { kind: "bookmark", title: "B2", url: "b" },
      { kind: "bookmark", title: "A", url: "a" },
    ]);
    const before = withBookmarks([
      { kind: "bookmark", title: "A", url: "a", localId: "a1" },
      { kind: "bookmark", title: "B", url: "b", localId: "b1" },
    ]);
    api.bookmarks.getTree.mockResolvedValue([
      {
        children: [
          {
            id: "1",
            folderType: "bookmarks-bar",
            children: [
              { id: "a1", title: "A", url: "a" },
              { id: "b1", title: "B", url: "b" },
            ],
          },
        ],
      },
    ]);
    const changes = diff(before, after);
    await apply(before, after, changes, all(changes));
    expect(api.bookmarks.move).toHaveBeenCalledWith("b1", { parentId: "1", index: 0 });
    expect(api.bookmarks.update).toHaveBeenCalledWith("b1", { title: "B2" });
  });
});
