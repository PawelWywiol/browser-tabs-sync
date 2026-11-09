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
    query: vi.fn(),
  },
  tabGroups: { update: vi.fn(), move: vi.fn() },
  bookmarks: {
    create: vi.fn(),
    remove: vi.fn(),
    getChildren: vi.fn(),
    getTree: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.create.mockImplementation(async () => ({ id: nextTab++ }));
  api.windows.create.mockImplementation(async () => ({ id: 77, tabs: [{ id: nextTab++ }] }));
  api.tabs.group.mockResolvedValue(9);
  api.tabs.getCurrent.mockResolvedValue({ windowId: 999 });
  api.tabs.query.mockImplementation(async () =>
    api.tabs.move.mock.calls.map(([id]) => ({ id, groupId: -1, pinned: false })),
  );
  api.bookmarks.create.mockImplementation(async (p) => ({ id: `new-${p.title}` }));
  api.bookmarks.getTree.mockResolvedValue([{ children: [] }]);
  api.bookmarks.getChildren.mockResolvedValue([]);
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

  it("pins the first tab of a created window", async () => {
    const empty: BrowserState = { windows: [], bookmarks: [] };
    const pinnedFirst: BrowserState = {
      windows: [{ groups: [], tabs: [{ ...base, url: "a", pinned: true }] }],
      bookmarks: [],
    };
    const changes = diff(empty, pinnedFirst);
    expect(await apply(empty, pinnedFirst, changes, all(changes))).toEqual([]);
    expect(api.tabs.update).toHaveBeenCalledWith(expect.any(Number), { pinned: true });
  });

  it("reports a refused URL and continues", async () => {
    api.tabs.create.mockRejectedValueOnce(new Error("refused"));
    const changes = diff(local, target);
    const failures = await apply(local, target, changes, all(changes));
    expect(failures).toEqual([{ url: "new", message: "Error: refused" }]);
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
  });

  it("closes selected tabs before aligning the window", async () => {
    const order: string[] = [];
    api.tabs.remove.mockImplementation(async () => order.push("remove"));
    api.tabs.move.mockImplementation(async () => order.push("move"));
    const changes = diff(local, target);
    await apply(local, target, changes, all(changes));
    expect(order[0]).toBe("remove");
    expect(order).toContain("move");
  });

  describe("groups", () => {
    const tab = (url: string, localId: number, groupRef?: string) => ({
      ...base,
      url,
      localId,
      ...(groupRef ? { groupRef } : {}),
    });
    const group = (ref: string, title: string, localId?: number) => ({
      ref,
      title,
      color: "red",
      collapsed: false,
      ...(localId === undefined ? {} : { localId }),
    });
    const state = (
      groups: BrowserState["windows"][number]["groups"],
      tabs: BrowserState["windows"][number]["tabs"],
    ): BrowserState => ({
      windows: [{ localId: 1, groups, tabs }],
      bookmarks: [],
    });

    it("groups before ungrouping and ungroups every tab without a group", async () => {
      const order: string[] = [];
      api.tabs.group.mockImplementation(async () => {
        order.push("group");
        return 40;
      });
      api.tabs.ungroup.mockImplementation(async () => order.push("ungroup"));
      const before = state([group("g1", "Work", 40)], [tab("x", 10, "g1"), tab("y", 11)]);
      const after = state(
        [group("t", "Work")],
        [
          { ...base, url: "x" },
          { ...base, url: "y", groupRef: "t" },
        ],
      );
      const changes = diff(before, after);
      expect(await apply(before, after, changes, all(changes))).toEqual([]);
      expect(order).toEqual(["group", "ungroup"]);
      expect(api.tabs.ungroup).toHaveBeenCalledWith(10);
      expect(api.tabs.ungroup).not.toHaveBeenCalledWith(11);
    });

    it("reuses a matching local group", async () => {
      const before = state([group("g1", "Work", 40)], [tab("x", 10, "g1")]);
      const after = state([group("t", "Work")], [{ ...base, url: "x", groupRef: "t" }]);
      const changes = diff(before, after);
      await apply(before, after, changes, all(changes));
      expect(api.tabs.group).toHaveBeenCalledWith({ groupId: 40, tabIds: [10] });
    });

    it("claims each local group once", async () => {
      const before = state([group("g1", "", 40)], [tab("a", 10, "g1"), tab("b", 11)]);
      const after = state(
        [group("t1", ""), group("t2", "")],
        [
          { ...base, url: "a", groupRef: "t1" },
          { ...base, url: "b", groupRef: "t2" },
        ],
      );
      const changes = diff(before, after);
      await apply(before, after, changes, all(changes));
      expect(api.tabs.group.mock.calls.map((c) => c[0])).toEqual([
        { groupId: 40, tabIds: [10] },
        { createProperties: { windowId: 1 }, tabIds: [11] },
      ]);
    });

    it("creates a new group when the claimed group no longer exists", async () => {
      api.tabs.group.mockRejectedValueOnce(new Error("No group with id"));
      const before = state([group("g1", "Work", 40)], [tab("x", 10, "g1")]);
      const after = state([group("t", "Work")], [{ ...base, url: "x", groupRef: "t" }]);
      const changes = diff(before, after);
      expect(await apply(before, after, changes, all(changes))).toEqual([]);
      expect(api.tabs.group).toHaveBeenLastCalledWith({
        createProperties: { windowId: 1 },
        tabIds: [10],
      });
    });

    it("reports a failed group and continues", async () => {
      api.tabs.group.mockRejectedValue(new Error("denied"));
      const before = state([], [tab("x", 10)]);
      const after = state([group("t", "Work")], [{ ...base, url: "x", groupRef: "t" }]);
      const changes = diff(before, after);
      expect(await apply(before, after, changes, all(changes))).toEqual([
        { url: "Work", message: "Error: denied" },
      ]);
    });

    it("moves groups and tabs back into target order when grouping displaced them", async () => {
      api.tabs.query.mockResolvedValue([
        { id: 11, groupId: -1, pinned: false },
        { id: 10, groupId: 40, pinned: false },
        { id: 12, groupId: -1, pinned: false },
      ]);
      const before = state(
        [group("g1", "Work", 40)],
        [tab("x", 12, "g1"), tab("y", 10), tab("z", 11)],
      );
      const after = state(
        [group("t", "Work")],
        [
          { ...base, url: "y", groupRef: "t" },
          { ...base, url: "z" },
          { ...base, url: "x" },
        ],
      );
      const changes = diff(before, after);
      expect(await apply(before, after, changes, all(changes))).toEqual([]);
      expect(api.tabGroups.move).toHaveBeenCalledWith(40, { index: 0 });
      expect(api.tabs.move).toHaveBeenLastCalledWith(12, { windowId: 1, index: 2 });
    });
  });

  it("retries a refused first URL until a window is created", async () => {
    api.windows.create.mockRejectedValueOnce(new Error("refused"));
    const empty: BrowserState = { windows: [], bookmarks: [] };
    const wanted: BrowserState = {
      windows: [
        {
          groups: [],
          tabs: [
            { ...base, url: "bad" },
            { ...base, url: "good" },
            { ...base, url: "last" },
          ],
        },
      ],
      bookmarks: [],
    };
    const changes = diff(empty, wanted);
    expect(await apply(empty, wanted, changes, all(changes))).toEqual([
      { url: "bad", message: "Error: refused" },
    ]);
    expect(api.windows.create.mock.calls.map((c) => c[0].url)).toEqual(["bad", "good"]);
    expect(api.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: "last" }));
  });

  it("reports every URL when no window can be created", async () => {
    api.windows.create.mockRejectedValue(new Error("refused"));
    const empty: BrowserState = { windows: [], bookmarks: [] };
    const wanted: BrowserState = {
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
    };
    const changes = diff(empty, wanted);
    expect((await apply(empty, wanted, changes, all(changes))).map((f) => f.url)).toEqual([
      "a",
      "b",
    ]);
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

  const folderRemoval = () => {
    const before = withBookmarks([
      {
        kind: "folder",
        title: "F",
        localId: "f",
        children: [{ kind: "bookmark", title: "X", url: "x", localId: "b" }],
      },
    ]);
    const after = withBookmarks([]);
    const changes = diff(before, after);
    return { before, after, changes };
  };

  it("removes an empty folder after its bookmarks", async () => {
    const { before, after, changes } = folderRemoval();
    expect(await apply(before, after, changes, all(changes))).toEqual([]);
    expect(api.bookmarks.remove.mock.calls.map((c) => c[0])).toEqual(["b", "f"]);
  });

  it("keeps a folder that still has children without a failure", async () => {
    const { before, after, changes } = folderRemoval();
    api.bookmarks.getChildren.mockResolvedValue([{ id: "kept" }]);
    expect(await apply(before, after, changes, all(changes))).toEqual([]);
    expect(api.bookmarks.remove).not.toHaveBeenCalledWith("f");
  });

  it("reports a folder removal error", async () => {
    const { before, after, changes } = folderRemoval();
    api.bookmarks.remove.mockImplementation(async (id) => {
      if (id === "f") throw new Error("denied");
    });
    expect(await apply(before, after, changes, all(changes))).toEqual([
      { url: "F", message: "Error: denied" },
    ]);
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
