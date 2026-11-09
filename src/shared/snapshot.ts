import type {
  BookmarkNode,
  BookmarkRoot,
  BrowserState,
  BrowserWindow,
  FolderType,
  Group,
  Snapshot,
  Tab,
} from "./types";

export class InvalidSnapshotError extends Error {}

const FOLDER_TYPES: readonly string[] = ["bookmarks-bar", "other", "mobile"];
const NO_GROUP = -1;

export function isSyncableUrl(url: string): boolean {
  return (
    Boolean(url) &&
    url !== "about:blank" &&
    !url.startsWith("chrome://newtab") &&
    !url.startsWith("chrome-extension://")
  );
}

function toBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  return node.url
    ? { kind: "bookmark", title: node.title, url: node.url, localId: node.id }
    : {
        kind: "folder",
        title: node.title,
        children: (node.children ?? []).map(toBookmarkNode),
        localId: node.id,
      };
}

async function captureBookmarks(): Promise<BookmarkRoot[]> {
  const [root] = await chrome.bookmarks.getTree();
  const roots: BookmarkRoot[] = [];
  for (const node of root?.children ?? []) {
    const folderType = node.folderType as string | undefined;
    if (!folderType || !FOLDER_TYPES.includes(folderType)) continue;
    if (roots.some((r) => r.folderType === folderType)) continue;
    roots.push({
      folderType: folderType as FolderType,
      children: (node.children ?? []).map(toBookmarkNode),
      localId: node.id,
    });
  }
  return roots;
}

export async function capture(): Promise<BrowserState> {
  const [windows, groups, bookmarks] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
    chrome.tabGroups.query({}),
    captureBookmarks(),
  ]);
  const captured: BrowserWindow[] = windows
    .filter((w) => !w.incognito)
    .map((w) => ({
      localId: w.id,
      groups: groups
        .filter((g) => g.windowId === w.id)
        .map((g): Group => ({
          ref: `g${g.id}`,
          title: g.title ?? "",
          color: g.color,
          collapsed: g.collapsed,
          localId: g.id,
        })),
      tabs: (w.tabs ?? []).flatMap((t): Tab[] => {
        const url = t.url || t.pendingUrl || "";
        if (!isSyncableUrl(url)) return [];
        return [
          {
            url,
            title: t.title ?? "",
            pinned: t.pinned,
            active: t.active,
            localId: t.id,
            ...(t.groupId === NO_GROUP ? {} : { groupRef: `g${t.groupId}` }),
          },
        ];
      }),
    }));
  return { windows: captured, bookmarks };
}

export function toSnapshot(state: BrowserState, deviceName: string, sentAt: string): Snapshot {
  const stripped = JSON.parse(
    JSON.stringify(state, (key, value) => (key === "localId" ? undefined : value)),
  ) as BrowserState;
  return { formatVersion: 1, sentAt, deviceName, ...stripped };
}

function fail(): never {
  throw new InvalidSnapshotError("Invalid snapshot");
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

function checkBookmarkNodes(value: unknown): void {
  if (!Array.isArray(value)) fail();
  for (const node of value) {
    if (!isObject(node) || !isString(node.title)) fail();
    if (node.kind === "bookmark") {
      if (!isString(node.url)) fail();
    } else if (node.kind === "folder") {
      checkBookmarkNodes(node.children);
    } else {
      fail();
    }
  }
}

function checkWindow(value: unknown): void {
  if (!isObject(value) || !Array.isArray(value.groups) || !Array.isArray(value.tabs)) fail();
  const refs = new Set<unknown>();
  for (const group of value.groups) {
    if (
      !isObject(group) ||
      !isString(group.ref) ||
      !isString(group.title) ||
      !isString(group.color) ||
      !isBoolean(group.collapsed)
    )
      fail();
    refs.add(group.ref);
  }
  for (const tab of value.tabs) {
    if (
      !isObject(tab) ||
      !isString(tab.url) ||
      !isString(tab.title) ||
      !isBoolean(tab.pinned) ||
      !isBoolean(tab.active)
    )
      fail();
    if (tab.groupRef !== undefined && !refs.has(tab.groupRef)) fail();
  }
}

export function parseSnapshot(value: unknown): Snapshot {
  if (
    !isObject(value) ||
    value.formatVersion !== 1 ||
    !isString(value.sentAt) ||
    !isString(value.deviceName)
  )
    fail();
  if (!Array.isArray(value.windows) || !Array.isArray(value.bookmarks)) fail();
  value.windows.forEach(checkWindow);
  for (const root of value.bookmarks) {
    if (!isObject(root) || !FOLDER_TYPES.includes(root.folderType as string)) fail();
    checkBookmarkNodes(root.children);
  }
  return value as unknown as Snapshot;
}
