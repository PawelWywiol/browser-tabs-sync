# Data model

```ts
type Snapshot = {
  formatVersion: 1;
  sentAt: string;
  deviceName: string;
  windows: { groups: Group[]; tabs: Tab[] }[];
  bookmarks: { folderType: "bookmarks-bar" | "other" | "mobile"; children: BookmarkNode[] }[];
};
type Group = { ref: string; title: string; color: string; collapsed: boolean };
type Tab = { url: string; title: string; pinned: boolean; active: boolean; groupRef?: string };
type BookmarkNode =
  | { kind: "folder"; title: string; children: BookmarkNode[] }
  | { kind: "bookmark"; title: string; url: string };
```

Tabs are stored in window order. `ref` is local to the snapshot.

Repository layout:

```
index.enc                 encrypted list of sync profiles: { id, name }[]
profiles/<random id>.enc  encrypted Snapshot
```

## Encryption file format

- A fresh random 96-bit IV for every write. File bytes are `version (1) || IV (12) || ciphertext`.
- Additional authenticated data is `bts:v1:<repository path>`, so a modified file or one file
  swapped for another fails to decrypt.
