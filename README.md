# browser-tabs-sync

Encrypted sync of tabs, tab groups, pinned tabs and bookmarks between browser profiles, through a private GitHub repository. Chrome first.

## Install

See [docs/install-chrome.md](docs/install-chrome.md).

## How it works

`Send` encrypts the profile's state in the browser and commits it to your repository. `Pull` downloads it, shows every change with checkboxes, backs up the current state and applies what you selected. Sync profiles are independent of Chrome profile names.

## Privacy and security

Everything is encrypted with a random 256-bit key that never leaves your browsers. GitHub sees only random file names, sizes and commit times. See [docs/architecture/threat-model.md](docs/architecture/threat-model.md).

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
- `docs/architecture`: overview, data model, threat model
