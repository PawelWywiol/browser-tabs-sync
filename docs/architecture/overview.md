# Architecture overview

## Goal

Move the complete browsing state of a browser profile between computers, privately:
bookmarks, pinned tabs, tab groups and ungrouped tabs. Chrome first, other browsers later.
Syncing is triggered by hand (`Send` / `Pull`), but no file is ever copied by hand.

## Non-goals (v1)

- Automatic or background sync.
- Merging changes from two computers.
- Firefox or Safari builds. The stored format is browser-neutral so they can be added later.
- Syncing history, passwords, cookies, extensions or incognito windows.
- Chrome Web Store publishing. The extension is loaded unpacked.
- Remembered exclusion rules (e.g. "never sync this domain").

## Concepts

- **Sync profile**: a named state in the repository, e.g. `Work`. Independent of Chrome
  profile names.
- **Installation**: the extension in one Chrome profile on one computer. It stores its own
  link to one sync profile, so `Default` on one computer can pair with `Profile 2` on another.
- **Snapshot**: the full state of one sync profile, written by `Send`.

## Send

1. Read all normal windows and the bookmark tree into a snapshot. Incognito windows are skipped.
2. Fetch the current remote file and compare its SHA with the last SHA this installation saw.
3. If the remote is newer, show who sent it and when, with `Pull first`, `Overwrite anyway`
   and `Cancel`.
4. Encrypt and write one commit with the neutral message `update`.
5. Store the returned SHA as last seen.

## Pull

Nothing in the browser changes until step 5.

1. Download, decrypt and validate the snapshot. Any failure stops here with a message.
2. Compare it with the current state.
3. Show a preview grouped by window and tab group: tabs to open, tabs to close, bookmarks to
   add or remove. Everything starts checked. One checkbox can toggle a whole group or window.
4. Save the current state as a local backup. The 5 most recent are kept, restorable in one click.
5. Apply the checked changes.

Semantics:

- Unchecking a tab to open means it is not opened. Unchecking a tab to close means it stays.
- A kept tab stays in its group when that group still exists, otherwise it stays ungrouped in
  its window.
- Choices apply to this pull only. The next pull lists the item again, and the next `Send`
  includes whatever is open.
- Unchanged tabs are not listed, but their group, pinned state and order are still aligned.
- URLs the browser refuses to open from an extension are listed as skipped.

Matching:

- Tab and group IDs are only unique within a browser session, so tabs match by URL, with
  duplicates counted (a URL open twice matches twice).
- Windows have no stable identity, so each snapshot window pairs with the local window sharing
  the most URLs. Unpaired snapshot windows are created.
- Bookmarks match by folder path and URL. Top-level folders are identified by `folderType`
  (`bookmarks-bar`, `other`, `mobile`), not by their localized titles. They can't be renamed,
  moved or removed, only their children can. `managed` folders are never touched.

## Modules

| Module             | Responsibility                                                    |
| ------------------ | ----------------------------------------------------------------- |
| `shared/snapshot`  | Browser state to `Snapshot`, plus schema validation               |
| `shared/diff`      | Two snapshots to a list of changes. Pure                          |
| `shared/apply`     | Applies the selected changes through browser APIs                 |
| `shared/crypto`    | Key generation and import, encrypt, decrypt                       |
| `shared/github`    | Reads and writes repository files through the GitHub API          |
| `shared/idb`       | The encryption key and the 5 most recent local backups, in IndexedDB |
| `shared/remote`    | Encrypted index and snapshot files: sync profiles and their state |
| `shared/sync`      | Send, pull and restore flows                                      |
| `shared/settings`  | Per-installation settings in `chrome.storage.local`               |
| `popup`            | `Send` and `Pull` buttons, current sync profile, status           |
| `options`          | Setup and sync profile management                                 |
| `preview`          | The checkbox list and the result of applying it                   |

The extension has no service worker: the popup runs `Send` and the preview page runs `Pull`.
