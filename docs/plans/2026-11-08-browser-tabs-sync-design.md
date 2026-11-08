# Browser tabs sync: design

Date: 2026-11-08
Status: awaiting review

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

## Setup (once per installation)

The user creates one private GitHub repository and one fine-grained token limited to that
repository with `Contents: write`. In the options page they enter:

1. repository (`owner/name`) and token,
2. the encryption key (generated on first setup, pasted on all later installations),
3. a device name, e.g. `Laptop`,
4. which sync profile this installation uses (pick from the list or create a new one).

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

## Data model

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

## Encryption

- A random 256-bit key generated with `crypto.getRandomValues`, shown once as text to store in a
  password manager. There is no password, so a leaked repository can't be brute-forced.
- AES-256-GCM through the built-in Web Crypto API, with no crypto dependency.
- A fresh random 96-bit IV for every write. File bytes are `version (1) || IV (12) || ciphertext`.
- Additional authenticated data is `bts:v1:<repository path>`, so a modified file or one file
  swapped for another fails to decrypt.
- The key is imported as non-extractable and kept in IndexedDB in the extension origin.

GitHub sees random file names, file sizes (a rough tab count) and commit times. It never sees
URLs, titles, group names or sync profile names.

Not protected:

- A lost key means the data is gone.
- A leaked key exposes the whole repository history, so the repository must be replaced.
- Malware on the computer, which can already read the browser's state.
- A stolen token can damage or delete files, but can't read them. Git history allows recovery.
- GitHub serving an older valid version is not detected.

## Permissions

`tabs`, `tabGroups`, `bookmarks`, `storage`, and the host permission `https://api.github.com/*`.
No content scripts. CSP `script-src 'self'; object-src 'self'`. A test locks this list.

## Modules

| Module             | Responsibility                                                    |
| ------------------ | ----------------------------------------------------------------- |
| `shared/snapshot`  | Browser state to `Snapshot`, plus schema validation               |
| `shared/diff`      | Two snapshots to a list of changes. Pure                          |
| `shared/apply`     | Applies the selected changes through browser APIs                 |
| `shared/crypto`    | Key generation and import, encrypt, decrypt                       |
| `shared/github`    | Read and write repository files, detect a newer remote version    |
| `shared/backup`    | The 5 most recent local backups, in IndexedDB                     |
| `shared/settings`  | Per-installation settings in `chrome.storage.local`               |
| `popup`            | `Send` and `Pull` buttons, current sync profile, status           |
| `options`          | Setup and sync profile management                                 |
| `preview`          | The checkbox list and the result of applying it                   |

## Error handling

- Wrong key, corrupt file, invalid schema or network failure: message only, browser untouched.
- `apply` failing midway: report what failed and offer to restore the backup.
- Invalid or expired token, missing repository, rate limit: a specific message pointing at setup.

## Testing

- Vitest with jsdom and `@testing-library/preact`: `diff`, `crypto`, `snapshot`, `apply` (with a
  fake browser API), `github` (with a mock HTTP API), `backup` (with `fake-indexeddb`) and UI.
- Manifest test locking permissions, CSP and the absence of content scripts.
- Playwright end-to-end test running `Send` then `Pull` between two isolated temporary browser
  profiles against a mock GitHub API. Tests never touch real profiles.

## Tooling

Matches `teams-captions-ext`, at the newest available versions when scaffolded:

- pnpm with `pnpm-workspace.yaml` hardening (`allowBuilds`, `blockExoticSubdeps`,
  `minimumReleaseAge`, `strictDepBuilds`).
- TypeScript, esbuild via `scripts/build-extension.mjs`, a hand-written `src/manifest.json`,
  `scripts/package-chromium.mjs` for the zip.
- Preact with `@preact/signals`.
- Vitest, Vite, jsdom, `@testing-library/dom`, `@testing-library/preact`, `fake-indexeddb`.
- oxlint, oxfmt, lefthook (typecheck, lint and format on commit, tests on push).
- audit-ci with `moderate: true`.
- GitHub Actions: `ci.yml` (typecheck, lint, format check, tests, audit, PR preview bundle) and
  `release.yml` (tagged zip on a GitHub Release).
- Additions: `@types/chrome` and `@playwright/test`.
- Docs: `README.md`, `docs/architecture/{overview,data-model,threat-model}.md`,
  `docs/install-chrome.md`.

The UI language is Polish.

## Assumptions to confirm first in implementation

These are unverified. If one fails, the affected section is revised before continuing.

1. A non-extractable `CryptoKey` persists in IndexedDB across browser restarts in Chrome.
2. Newest majors of TypeScript (7), Preact (11), Vitest (5) and jsdom work together. Peer ranges
   allow them, but they have not been run together here. If they fail, pin the newest working
   version and record why.

Verified on a real private repository on 2026-11-08: a write with a stale `sha` returns `409`, a
write without `sha` to an existing file returns `422`, and reads carry `max-age=60`, so every
request must bypass the HTTP cache.

The extension has no service worker: the popup runs `Send` and the preview page runs `Pull`. URLs
the browser refuses are detected when opening them, not listed in advance.
