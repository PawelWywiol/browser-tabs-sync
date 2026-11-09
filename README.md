# browser-tabs-sync

Encrypted sync of tabs, tab groups, pinned tabs and bookmarks between browser profiles, through a private GitHub repository. Chrome first.

## Install

Once:

1. Create a private GitHub repository for your data.
2. Create a fine-grained token at GitHub Settings > Developer settings, with access to only that repository and `Contents: Read and write`.

In each Chrome profile:

1. Download the zip from a release, or run `pnpm build:extension`, and unpack it.
2. Open `chrome://extensions`, enable Developer mode, choose Load unpacked and select the folder.
3. Open the extension's options.
4. Enter the repository as `owner/name` (`Repozytorium`) and the token (`Token GitHub`).
5. On first setup choose `Wygeneruj klucz` (Generate key) and store it in a password manager. On every other profile paste the same key into `Klucz szyfrowania`.
6. Enter a device name (`Nazwa urządzenia`), choose `Połącz` (Connect), then pick or create a sync profile.

To update, replace the folder with the new version and choose Reload on `chrome://extensions`.

## How it works

`Send` encrypts the profile's state in the browser and commits it to your repository. `Pull` downloads it, shows every change with checkboxes, backs up the current state and applies what you selected. Sync profiles are independent of Chrome profile names.

## Privacy and security

Everything is encrypted with a random 256-bit key that never leaves your browsers. GitHub sees only random file names, sizes and commit times.

Known limits:

- A lost key means lost data.
- A leaked key exposes the whole repository history: replace the repository and generate a new key.
- GitHub serving an older valid version is not detected.
- File size and commit times reveal a rough tab count and activity pattern.
- A Chrome profile signed in with account bookmarks can have several bookmark roots of one type. Only the first root of each type is synced; bookmarks in other roots are not sent or changed.

## Development

    pnpm install
    pnpm test
    pnpm test:e2e
    pnpm build:extension

Output lands in `dist/extension`. Releases are built by pushing a `v*` tag.

## Project layout

- `src/shared`: sync logic, with no UI
- `src/ui`: Preact screens
- `src/popup`, `src/options`, `src/preview`: page entries
- `tests`: unit tests, `e2e`: Playwright
