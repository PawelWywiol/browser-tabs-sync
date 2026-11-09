import { describe, expect, it } from "vitest";
import { diff } from "../src/shared/diff";
import type { BookmarkRoot, BrowserState, Tab } from "../src/shared/types";

let nextId = 100;
const tab = (url: string, extra: Partial<Tab> = {}): Tab => ({
  url,
  title: url,
  pinned: false,
  active: false,
  localId: nextId++,
  ...extra,
});
const state = (windows: Tab[][], bookmarks: BookmarkRoot[] = []): BrowserState => ({
  windows: windows.map((tabs, i) => ({ localId: i + 1, groups: [], tabs })),
  bookmarks,
});

describe("diff tabs", () => {
  it("reports nothing for identical state", () => {
    const changes = diff(state([[tab("a"), tab("b")]]), state([[tab("a"), tab("b")]]));
    expect(changes.tabs).toEqual([]);
    expect(changes.matches).toHaveLength(2);
    expect(changes.windowPairs).toEqual([0]);
  });

  it("lists tabs to open and close", () => {
    const local = state([[tab("a"), tab("gone", { localId: 7 })]]);
    const changes = diff(local, state([[tab("a"), tab("new")]]));
    expect(changes.tabs).toMatchObject([
      { kind: "open", url: "new", targetTab: 1, windowIndex: 0 },
      { kind: "close", url: "gone", localId: 7, windowIndex: 0 },
    ]);
  });

  it("counts duplicate URLs", () => {
    const changes = diff(state([[tab("a")]]), state([[tab("a"), tab("a")]]));
    expect(changes.tabs).toMatchObject([{ kind: "open", url: "a", targetTab: 1 }]);
  });

  it("pairs windows by the most shared URLs regardless of order", () => {
    const local = state([
      [tab("x"), tab("y")],
      [tab("a"), tab("b")],
    ]);
    const changes = diff(local, state([[tab("a"), tab("b")], [tab("x")]]));
    expect(changes.windowPairs).toEqual([1, 0]);
  });

  it("marks windows without a counterpart for creation and closes unpaired local windows", () => {
    const changes = diff(state([[tab("old")]]), state([[tab("new")]]));
    expect(changes.windowPairs).toEqual([-1]);
    expect(changes.tabs.map((t) => t.kind).sort()).toEqual(["close", "open"]);
  });

  it("reuses a local window with no syncable tabs instead of creating one", () => {
    expect(diff(state([[]]), state([[tab("new")]])).windowPairs).toEqual([0]);
  });

  it("includes the group title for display", () => {
    const target: BrowserState = {
      windows: [
        {
          groups: [{ ref: "g", title: "Praca", color: "blue", collapsed: false }],
          tabs: [tab("a", { groupRef: "g" })],
        },
      ],
      bookmarks: [],
    };
    expect(diff(state([[]]), target).tabs[0]).toMatchObject({ groupTitle: "Praca" });
  });

  it("gives every change a unique id", () => {
    const { tabs } = diff(state([[tab("x"), tab("y")]]), state([[tab("a"), tab("b")]]));
    expect(new Set(tabs.map((t) => t.id)).size).toBe(4);
  });
});

describe("diff bookmarks", () => {
  const bookmark = (url: string, localId?: string) => ({
    kind: "bookmark" as const,
    title: url,
    url,
    localId,
  });
  const roots = (children: BookmarkRoot["children"]): BookmarkRoot[] => [
    { folderType: "bookmarks-bar", children },
  ];

  it("reports nothing for identical trees", () => {
    const tree = roots([{ kind: "folder", title: "F", children: [bookmark("a")] }]);
    expect(diff(state([], tree), state([], tree)).bookmarks).toEqual([]);
  });

  it("treats the same URL in another folder as add and remove", () => {
    const local = roots([
      { kind: "folder", title: "F", localId: "f", children: [bookmark("a", "1")] },
    ]);
    const target = roots([{ kind: "folder", title: "F", children: [] }, bookmark("a")]);
    expect(diff(state([], local), state([], target)).bookmarks).toMatchObject([
      { kind: "add", path: [], url: "a" },
      { kind: "remove", path: ["F"], url: "a", localId: "1" },
    ]);
  });

  it("reports empty folders", () => {
    const target = roots([{ kind: "folder", title: "New", children: [] }]);
    expect(diff(state([], []), state([], target)).bookmarks).toMatchObject([
      { kind: "add", title: "New", path: [] },
    ]);
  });

  it("keeps roots separate", () => {
    const local: BookmarkRoot[] = [{ folderType: "other", children: [bookmark("a", "1")] }];
    const target: BookmarkRoot[] = [{ folderType: "bookmarks-bar", children: [bookmark("a")] }];
    expect(diff(state([], local), state([], target)).bookmarks.map((b) => b.kind)).toEqual([
      "add",
      "remove",
    ]);
  });
});
