export type FolderType = "bookmarks-bar" | "other" | "mobile";

export type Group = {
  ref: string;
  title: string;
  color: string;
  collapsed: boolean;
  localId?: number;
};

export type Tab = {
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  groupRef?: string;
  localId?: number;
};

export type BrowserWindow = { groups: Group[]; tabs: Tab[]; localId?: number };

export type BookmarkNode = { localId?: string; title: string } & (
  | { kind: "folder"; children: BookmarkNode[] }
  | { kind: "bookmark"; url: string }
);

export type BookmarkRoot = { folderType: FolderType; children: BookmarkNode[]; localId?: string };

export type BrowserState = { windows: BrowserWindow[]; bookmarks: BookmarkRoot[] };

export type Snapshot = BrowserState & { formatVersion: 1; sentAt: string; deviceName: string };
