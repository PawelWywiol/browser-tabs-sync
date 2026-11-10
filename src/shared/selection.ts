import { diff, type ChangeSet } from "./diff";
import type { BookmarkNode, BrowserState } from "./types";

export function sendableItems(state: BrowserState): ChangeSet {
  const items = diff({ windows: [], bookmarks: [] }, state);
  return {
    ...items,
    windowPairs: state.windows.map((_, index) => index),
    bookmarks: items.bookmarks.filter((bookmark) => bookmark.url),
  };
}

export function pickSelected(state: BrowserState, selected: ReadonlySet<string>): BrowserState {
  let bookmarkIndex = 0;
  const pickNodes = (nodes: BookmarkNode[]): BookmarkNode[] =>
    nodes.flatMap((node): BookmarkNode[] => {
      const id = `add:${bookmarkIndex++}`;
      if (node.kind === "bookmark") return selected.has(id) ? [node] : [];
      const children = pickNodes(node.children);
      return children.length > 0 || node.children.length === 0 ? [{ ...node, children }] : [];
    });

  return {
    windows: state.windows.flatMap((window, windowIndex) => {
      const tabs = window.tabs.filter((_, tabIndex) =>
        selected.has(`open:${windowIndex}:${tabIndex}`),
      );
      if (tabs.length === 0) return [];
      return [
        {
          ...window,
          tabs,
          groups: window.groups.filter((g) => tabs.some((t) => t.groupRef === g.ref)),
        },
      ];
    }),
    bookmarks: state.bookmarks.map((root) => ({ ...root, children: pickNodes(root.children) })),
  };
}
