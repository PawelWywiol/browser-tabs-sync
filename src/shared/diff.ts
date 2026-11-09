import type { BookmarkNode, BookmarkRoot, BrowserState, BrowserWindow, FolderType } from "./types";

export type TabChange = {
  id: string;
  kind: "open" | "close";
  url: string;
  title: string;
  windowIndex: number;
  groupTitle?: string;
  groupColor?: string;
  targetTab?: number;
  localId?: number;
};

export type BookmarkChange = {
  id: string;
  kind: "add" | "remove";
  folderType: FolderType;
  path: string[];
  title: string;
  url?: string;
  localId?: string;
};

export type TabMatch = { targetWindow: number; targetTab: number; localId: number };

export type ChangeSet = {
  windowPairs: number[];
  tabs: TabChange[];
  bookmarks: BookmarkChange[];
  matches: TabMatch[];
};

export type FlatBookmark = {
  folderType: FolderType;
  path: string[];
  title: string;
  url?: string;
  localId?: string;
};

const countShared = (a: BrowserWindow, b: BrowserWindow): number => {
  const remaining = a.tabs.map((t) => t.url);
  let shared = 0;
  for (const tab of b.tabs) {
    const index = remaining.indexOf(tab.url);
    if (index >= 0) {
      remaining.splice(index, 1);
      shared++;
    }
  }
  return shared;
};

function pairWindows(local: BrowserWindow[], target: BrowserWindow[]): number[] {
  const pairs = target.map(() => -1);
  const usedLocal = new Set<number>();
  const candidates = target
    .flatMap((t, ti) => local.map((l, li) => ({ ti, li, shared: countShared(l, t) })))
    .filter((c) => c.shared > 0)
    .sort((a, b) => b.shared - a.shared);
  for (const { ti, li } of candidates) {
    if (pairs[ti] !== -1 || usedLocal.has(li)) continue;
    pairs[ti] = li;
    usedLocal.add(li);
  }
  for (let ti = 0; ti < target.length; ti++) {
    if (pairs[ti] !== -1) continue;
    const empty = local.findIndex((l, li) => l.tabs.length === 0 && !usedLocal.has(li));
    if (empty === -1) continue;
    pairs[ti] = empty;
    usedLocal.add(empty);
  }
  return pairs;
}

function diffTabs(local: BrowserState, target: BrowserState, windowPairs: number[]) {
  const tabs: TabChange[] = [];
  const matches: TabMatch[] = [];
  const unmatchedLocal = local.windows.map((w) => [...w.tabs]);

  target.windows.forEach((targetWindow, targetIndex) => {
    const pair = windowPairs[targetIndex]!;
    const groups = new Map(targetWindow.groups.map((g) => [g.ref, g]));
    targetWindow.tabs.forEach((tab, targetTab) => {
      const candidates = pair >= 0 ? unmatchedLocal[pair]! : [];
      const found = candidates.findIndex((c) => c.url === tab.url);
      if (found >= 0) {
        matches.push({
          targetWindow: targetIndex,
          targetTab,
          localId: candidates.splice(found, 1)[0]!.localId!,
        });
        return;
      }
      const group = tab.groupRef ? groups.get(tab.groupRef) : undefined;
      tabs.push({
        id: `open:${targetIndex}:${targetTab}`,
        kind: "open",
        url: tab.url,
        title: tab.title,
        windowIndex: targetIndex,
        targetTab,
        ...(group ? { groupTitle: group.title, groupColor: group.color } : {}),
      });
    });
  });

  unmatchedLocal.forEach((windowTabs, windowIndex) => {
    const groups = new Map(local.windows[windowIndex]!.groups.map((g) => [g.ref, g]));
    for (const tab of windowTabs) {
      const group = tab.groupRef ? groups.get(tab.groupRef) : undefined;
      tabs.push({
        id: `close:${tab.localId}`,
        kind: "close",
        url: tab.url,
        title: tab.title,
        windowIndex,
        localId: tab.localId!,
        ...(group ? { groupTitle: group.title, groupColor: group.color } : {}),
      });
    }
  });

  return { tabs, matches };
}

export function flattenBookmarks(roots: BookmarkRoot[]): FlatBookmark[] {
  const output: FlatBookmark[] = [];
  const visit = (folderType: FolderType, path: string[], nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      output.push({
        folderType,
        path,
        title: node.title,
        ...(node.kind === "bookmark" ? { url: node.url } : {}),
        ...(node.localId ? { localId: node.localId } : {}),
      });
      if (node.kind === "folder") visit(folderType, [...path, node.title], node.children);
    }
  };
  for (const root of roots) visit(root.folderType, [], root.children);
  return output;
}

const bookmarkKey = (b: FlatBookmark) =>
  [b.folderType, ...b.path, b.url ?? `folder:${b.title}`].join("\0");

function diffBookmarks(local: BrowserState, target: BrowserState): BookmarkChange[] {
  const unmatchedLocal = flattenBookmarks(local.bookmarks);
  const additions: BookmarkChange[] = [];
  flattenBookmarks(target.bookmarks).forEach((entry, index) => {
    const found = unmatchedLocal.findIndex((c) => bookmarkKey(c) === bookmarkKey(entry));
    if (found >= 0) {
      unmatchedLocal.splice(found, 1);
      return;
    }
    additions.push({ ...entry, id: `add:${index}`, kind: "add" });
  });
  const removals = unmatchedLocal.map((entry, index): BookmarkChange => ({
    ...entry,
    id: `remove:${entry.localId ?? index}`,
    kind: "remove",
  }));
  return [...additions, ...removals];
}

export function diff(local: BrowserState, target: BrowserState): ChangeSet {
  const windowPairs = pairWindows(local.windows, target.windows);
  return {
    windowPairs,
    ...diffTabs(local, target, windowPairs),
    bookmarks: diffBookmarks(local, target),
  };
}
