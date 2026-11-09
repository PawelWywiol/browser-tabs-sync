import {
  flattenBookmarks,
  type BookmarkChange,
  type ChangeSet,
  type TabChange,
  type TabMatch,
} from "./diff";
import type { BookmarkNode, BrowserState, BrowserWindow, FolderType } from "./types";

export type ApplyFailure = { url: string; message: string };

type Failures = ApplyFailure[];

const NO_GROUP = -1;

async function attempt<T>(
  failures: Failures,
  url: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    failures.push({ url, message: String(error) });
    return undefined;
  }
}

async function ensureTabs(
  target: BrowserWindow,
  pairedWindowId: number | undefined,
  opens: TabChange[],
  placed: Map<number, number>,
  failures: Failures,
): Promise<number | undefined> {
  const queue = [...opens];
  let windowId = pairedWindowId;
  while (windowId === undefined) {
    const first = queue.shift();
    if (!first) return undefined;
    const created = await attempt(failures, first.url, () =>
      chrome.windows.create({ url: first.url, focused: false }),
    );
    if (!created?.id) continue;
    windowId = created.id;
    const firstTab = created.tabs?.[0]?.id;
    if (firstTab !== undefined) {
      placed.set(first.targetTab!, firstTab);
      if (target.tabs[first.targetTab!]!.pinned) {
        await attempt(failures, first.url, () => chrome.tabs.update(firstTab, { pinned: true }));
      }
    }
  }
  for (const open of queue) {
    const created = await attempt(failures, open.url, () =>
      chrome.tabs.create({
        windowId,
        url: open.url,
        pinned: target.tabs[open.targetTab!]!.pinned,
        active: false,
      }),
    );
    if (created?.id !== undefined) placed.set(open.targetTab!, created.id);
  }
  return windowId;
}

type WindowPlan = {
  windowId: number;
  target: BrowserWindow;
  localWindow: BrowserWindow | undefined;
  matches: TabMatch[];
  placed: Map<number, number>;
};

async function openWindowTabs(
  windowIndex: number,
  local: BrowserState,
  target: BrowserWindow,
  changes: ChangeSet,
  selected: ReadonlySet<string>,
  failures: Failures,
): Promise<WindowPlan | undefined> {
  const pair = changes.windowPairs[windowIndex]!;
  const localWindow = pair >= 0 ? local.windows[pair] : undefined;
  const matches = changes.matches.filter((m) => m.targetWindow === windowIndex);
  const placed = new Map(matches.map((m) => [m.targetTab, m.localId]));
  const opens = changes.tabs.filter(
    (c) => c.kind === "open" && c.windowIndex === windowIndex && selected.has(c.id),
  );
  const windowId = await ensureTabs(target, localWindow?.localId, opens, placed, failures);
  return windowId === undefined ? undefined : { windowId, target, localWindow, matches, placed };
}

async function joinGroup(
  windowId: number,
  existingId: number | undefined,
  tabIds: [number, ...number[]],
): Promise<number> {
  const reused =
    existingId === undefined
      ? undefined
      : await chrome.tabs.group({ groupId: existingId, tabIds }).catch(() => undefined);
  return reused ?? chrome.tabs.group({ createProperties: { windowId }, tabIds });
}

async function restoreOrder(
  windowId: number,
  target: BrowserWindow,
  ordered: [number, number][],
  failures: Failures,
): Promise<void> {
  const live = await attempt(failures, "", () => chrome.tabs.query({ windowId }));
  if (!live) return;
  const placedIds = new Set(ordered.map(([, id]) => id));
  const liveOrder = live.filter((tab) => placedIds.has(tab.id!));
  if (ordered.every(([, id], position) => liveOrder[position]?.id === id)) return;

  let index = live.filter((tab) => tab.pinned).length;
  const movedGroups = new Set<number>();
  for (const [targetTab, tabId] of ordered) {
    const wanted = target.tabs[targetTab]!;
    if (wanted.pinned) continue;
    const groupId = live.find((tab) => tab.id === tabId)?.groupId ?? NO_GROUP;
    if (groupId === NO_GROUP) {
      const position = index++;
      await attempt(failures, wanted.url, () =>
        chrome.tabs.move(tabId, { windowId, index: position }),
      );
    } else if (!movedGroups.has(groupId)) {
      movedGroups.add(groupId);
      const position = index;
      index += live.filter((tab) => tab.groupId === groupId).length;
      await attempt(failures, wanted.url, () =>
        chrome.tabGroups.move(groupId, { index: position }),
      );
    }
  }
}

async function alignWindow(
  { windowId, target, localWindow, matches, placed }: WindowPlan,
  currentWindowId: number | undefined,
  failures: Failures,
): Promise<void> {
  const ordered = [...placed.entries()].sort(([a], [b]) => a - b);
  const localTabs = new Map((localWindow?.tabs ?? []).map((t) => [t.localId!, t]));

  for (const match of matches) {
    const wanted = target.tabs[match.targetTab]!;
    const existing = localTabs.get(match.localId);
    if (existing && existing.pinned !== wanted.pinned) {
      await attempt(failures, wanted.url, () =>
        chrome.tabs.update(match.localId, { pinned: wanted.pinned }),
      );
    }
  }

  for (const [index, [targetTab, tabId]] of ordered.entries()) {
    await attempt(failures, target.tabs[targetTab]!.url, () =>
      chrome.tabs.move(tabId, { windowId, index }),
    );
  }

  const claimed = new Set<number>();
  const collapsedGroups: number[] = [];
  for (const group of target.groups) {
    const tabIds = ordered
      .filter(([t]) => target.tabs[t]!.groupRef === group.ref)
      .map(([, id]) => id);
    if (tabIds.length === 0) continue;
    const existing = localWindow?.groups.find(
      (g) => g.title === group.title && !claimed.has(g.localId!),
    );
    if (existing) claimed.add(existing.localId!);
    const groupId = await attempt(failures, group.title, () =>
      joinGroup(windowId, existing?.localId, tabIds as [number, ...number[]]),
    );
    if (groupId === undefined) continue;
    await attempt(failures, group.title, () =>
      chrome.tabGroups.update(groupId, {
        title: group.title,
        color: group.color as `${chrome.tabGroups.Color}`,
        collapsed: false,
      }),
    );
    if (group.collapsed) collapsedGroups.push(groupId);
  }

  for (const [targetTab, tabId] of ordered) {
    const wanted = target.tabs[targetTab]!;
    if (!wanted.groupRef) {
      await attempt(failures, wanted.url, () => chrome.tabs.ungroup(tabId));
    }
  }

  await restoreOrder(windowId, target, ordered, failures);

  const active = ordered.find(([t]) => target.tabs[t]!.active);
  if (active && windowId !== currentWindowId) {
    await attempt(failures, target.tabs[active[0]]!.url, () =>
      chrome.tabs.update(active[1], { active: true }),
    );
  }
  for (const groupId of collapsedGroups) {
    await attempt(failures, "", () => chrome.tabGroups.update(groupId, { collapsed: true }));
  }
}

const folderKey = (folderType: FolderType, path: string[]) => [folderType, ...path].join("\0");

async function applyBookmarkChanges(
  local: BrowserState,
  selected: BookmarkChange[],
  failures: Failures,
): Promise<void> {
  for (const change of selected) {
    if (change.kind === "remove" && change.url !== undefined) {
      await attempt(failures, change.url, () => chrome.bookmarks.remove(change.localId!));
    }
  }
  const folderRemovals = selected
    .filter((c) => c.kind === "remove" && c.url === undefined)
    .sort((a, b) => b.path.length - a.path.length);
  for (const folder of folderRemovals) {
    await attempt(failures, folder.title, async () => {
      const children = await chrome.bookmarks.getChildren(folder.localId!);
      if (children.length === 0) await chrome.bookmarks.remove(folder.localId!);
    });
  }

  const folderIds = new Map<string, string>();
  for (const root of local.bookmarks) folderIds.set(folderKey(root.folderType, []), root.localId!);
  for (const entry of flattenBookmarks(local.bookmarks)) {
    if (entry.url === undefined && entry.localId) {
      folderIds.set(folderKey(entry.folderType, [...entry.path, entry.title]), entry.localId);
    }
  }

  const ensureFolder = async (folderType: FolderType, path: string[]): Promise<string> => {
    const key = folderKey(folderType, path);
    const existing = folderIds.get(key);
    if (existing) return existing;
    if (path.length === 0) throw new Error(`Missing root folder: ${folderType}`);
    const parentId = await ensureFolder(folderType, path.slice(0, -1));
    const created = await chrome.bookmarks.create({ parentId, title: path.at(-1)! });
    folderIds.set(key, created.id);
    return created.id;
  };

  for (const change of selected) {
    if (change.kind !== "add") continue;
    await attempt(failures, change.url ?? change.title, async () => {
      if (change.url === undefined) {
        await ensureFolder(change.folderType, [...change.path, change.title]);
        return;
      }
      const parentId = await ensureFolder(change.folderType, change.path);
      await chrome.bookmarks.create({ parentId, title: change.title, url: change.url });
    });
  }
}

async function alignChildren(
  parentId: string,
  wanted: BookmarkNode[],
  live: chrome.bookmarks.BookmarkTreeNode[],
  failures: Failures,
): Promise<void> {
  const current = [...live];
  const claimed = new Set<string>();
  let position = 0;
  for (const node of wanted) {
    const index = current.findIndex(
      (c) =>
        !claimed.has(c.id) &&
        (node.kind === "bookmark" ? c.url === node.url : !c.url && c.title === node.title),
    );
    if (index < 0) continue;
    const child = current[index]!;
    claimed.add(child.id);
    if (index !== position) {
      await attempt(failures, child.url ?? child.title, () =>
        chrome.bookmarks.move(child.id, { parentId, index: position }),
      );
      current.splice(index, 1);
      current.splice(position, 0, child);
    }
    position++;
    if (node.kind === "bookmark" && child.title !== node.title) {
      await attempt(failures, node.url, () =>
        chrome.bookmarks.update(child.id, { title: node.title }),
      );
    }
    if (node.kind === "folder")
      await alignChildren(child.id, node.children, child.children ?? [], failures);
  }
}

async function alignBookmarks(target: BrowserState, failures: Failures): Promise<void> {
  const [root] = await chrome.bookmarks.getTree();
  for (const wanted of target.bookmarks) {
    const live = root?.children?.find((c) => c.folderType === wanted.folderType);
    if (live) await alignChildren(live.id, wanted.children, live.children ?? [], failures);
  }
}

export async function apply(
  local: BrowserState,
  target: BrowserState,
  changes: ChangeSet,
  selected: ReadonlySet<string>,
): Promise<ApplyFailure[]> {
  const failures: Failures = [];
  const current = await chrome.tabs.getCurrent();

  const plans: WindowPlan[] = [];
  for (const [windowIndex, window] of target.windows.entries()) {
    const plan = await openWindowTabs(windowIndex, local, window, changes, selected, failures);
    if (plan) plans.push(plan);
  }
  for (const change of changes.tabs) {
    if (change.kind === "close" && selected.has(change.id)) {
      await attempt(failures, change.url, () => chrome.tabs.remove(change.localId!));
    }
  }
  for (const plan of plans) await alignWindow(plan, current?.windowId, failures);

  await applyBookmarkChanges(
    local,
    changes.bookmarks.filter((c) => selected.has(c.id)),
    failures,
  );
  await alignBookmarks(target, failures);
  return failures;
}
