import { describe, expect, it } from "vitest";
import { pickSelected, sendableItems } from "../src/shared/selection";
import type { BrowserState } from "../src/shared/types";

const tab = (url: string, groupRef?: string) => ({
  url,
  title: url,
  pinned: false,
  active: false,
  ...(groupRef ? { groupRef } : {}),
});
const group = (ref: string) => ({ ref, title: ref, color: "blue", collapsed: false });
const bookmark = (url: string) => ({ kind: "bookmark" as const, title: url, url });

const state: BrowserState = {
  windows: [
    { groups: [group("g1"), group("g2")], tabs: [tab("a", "g1"), tab("b", "g2"), tab("c")] },
    { groups: [], tabs: [tab("d")] },
  ],
  bookmarks: [
    {
      folderType: "other",
      children: [
        { kind: "folder", title: "F", children: [bookmark("x"), bookmark("y")] },
        { kind: "folder", title: "Empty", children: [] },
        bookmark("z"),
      ],
    },
  ],
};

const allIds = () => {
  const items = sendableItems(state);
  return new Set([...items.tabs, ...items.bookmarks].map((item) => item.id));
};
const without = (...urls: string[]) => {
  const items = sendableItems(state);
  return new Set(
    [...items.tabs, ...items.bookmarks]
      .filter((item) => !urls.includes(item.url ?? ""))
      .map((item) => item.id),
  );
};

describe("sendableItems", () => {
  it("lists every tab and bookmark but no folders, keeping windows in place", () => {
    const items = sendableItems(state);
    expect(items.tabs.map((t) => t.url)).toEqual(["a", "b", "c", "d"]);
    expect(items.bookmarks.map((b) => b.url)).toEqual(["x", "y", "z"]);
    expect(items.windowPairs).toEqual([0, 1]);
  });
});

describe("pickSelected", () => {
  it("keeps everything when all items are selected", () => {
    expect(pickSelected(state, allIds())).toEqual(state);
  });

  it("drops an unselected tab and a group left without tabs", () => {
    const [first] = pickSelected(state, without("b")).windows;
    expect(first!.tabs.map((t) => t.url)).toEqual(["a", "c"]);
    expect(first!.groups.map((g) => g.ref)).toEqual(["g1"]);
  });

  it("drops a window left without tabs", () => {
    expect(pickSelected(state, without("d")).windows).toHaveLength(1);
  });

  it("drops an unselected bookmark and targets the right one after a folder", () => {
    const { children } = pickSelected(state, without("x", "z")).bookmarks[0]!;
    expect(children).toEqual([
      { kind: "folder", title: "F", children: [bookmark("y")] },
      { kind: "folder", title: "Empty", children: [] },
    ]);
  });

  it("drops a folder emptied by the selection but keeps one that was already empty", () => {
    const { children } = pickSelected(state, without("x", "y")).bookmarks[0]!;
    expect(children).toEqual([{ kind: "folder", title: "Empty", children: [] }, bookmark("z")]);
  });
});
