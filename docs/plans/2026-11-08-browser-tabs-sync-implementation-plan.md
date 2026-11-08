# Browser Tabs Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension that sends and pulls a browser profile's tabs, tab groups, pins and bookmarks through an encrypted private GitHub repository.

**Architecture:** No service worker: the popup runs `Send`, and a full preview page runs `Pull`, so no message passing is needed. Pure modules (`diff`, `crypto`, `parseSnapshot`) sit behind thin browser and GitHub adapters. Every remote file is AES-256-GCM encrypted in the extension before upload.

**Tech Stack:** TypeScript, esbuild, Preact, `@preact/signals`, Web Crypto, Vitest, jsdom, Playwright, oxlint, oxfmt, lefthook, audit-ci, pnpm.

**Spec:** `docs/plans/2026-11-08-browser-tabs-sync-design.md`

## Global Constraints

- All dependencies at the newest version available when installed. If newest majors don't work together, pin the newest working version and record the reason in the PR commit message.
- Permissions exactly: `tabs`, `tabGroups`, `bookmarks`, `storage`. Host permission exactly: `https://api.github.com/*`. No content scripts, no service worker.
- CSP exactly: `script-src 'self'; object-src 'self'`.
- No crypto dependency: only the built-in Web Crypto API.
- Every GitHub `fetch` uses `cache: "no-store"`. Verified: GitHub answers contents reads with `Cache-Control: private, max-age=60`, so a cached read returns stale data.
- UI text is Polish. Code, comments, docs and commit messages are English.
- No code comments unless a non-obvious decision needs one short line.
- Commits use conventional commits, max 70 characters. Never add attribution lines or mention AI tooling. PR bodies stay empty.
- Tests never touch real browser profiles.

## Verified GitHub behaviour

Tested against a real private repository on 2026-11-08:

| Case                                  | Result |
| ------------------------------------- | ------ |
| Write with stale `sha`                | `409`  |
| Write without `sha` to existing file  | `422`  |
| Read missing file                     | `404`  |
| Read returns `content` as base64 with newlines | `200`, `encoding: "base64"` |

## File Structure

```
src/manifest.json                 extension manifest
src/shared/types.ts               Snapshot and BrowserState types
src/shared/base64.ts              bytes <-> base64
src/shared/crypto.ts              key text, encrypt, decrypt
src/shared/github.ts              contents API adapter, GitHubError
src/shared/remote.ts              encrypted index and snapshot files
src/shared/snapshot.ts            capture, toSnapshot, parseSnapshot
src/shared/diff.ts                BrowserState + target -> ChangeSet (pure)
src/shared/apply.ts               ChangeSet + selection -> browser calls
src/shared/idb.ts                 IndexedDB: key and backups
src/shared/settings.ts            per-installation settings
src/shared/sync.ts                send, loadPull, runPull, restoreBackup
src/popup/{index.html,index.tsx}  popup entry
src/options/{index.html,index.tsx} options entry
src/preview/{index.html,index.tsx} preview entry
src/ui/popup/App.tsx              Send/Pull UI
src/ui/options/App.tsx            setup UI
src/ui/preview/App.tsx            checkbox list
src/ui/shared/tokens.css          shared styles
scripts/build-extension.mjs       esbuild bundle
scripts/package-chromium.mjs      zip
tests/*.test.ts(x)                Vitest
e2e/*                             Playwright
```

---

### Task 1: Scaffold and quality gates

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.oxfmtrc.json`, `.oxlintrc.json`, `audit-ci.json`, `lefthook.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `src/manifest.json`, `scripts/build-extension.mjs`, `scripts/package-chromium.mjs`, `src/popup/index.html`, `src/popup/index.tsx`, `src/options/index.html`, `src/options/index.tsx`, `src/preview/index.html`, `src/preview/index.tsx`, `src/ui/shared/tokens.css`
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Produces: scripts `typecheck`, `lint`, `format`, `format:check`, `test`, `test:e2e`, `build:extension`, `package:chromium`, `audit:deps`.

- [ ] **Step 1: Create the feature branch**

```bash
git switch main && git pull --ff-only && git switch -c feature/browser-tabs-sync
```

- [ ] **Step 2: Write config files**

`package.json`:

```json
{
  "name": "browser-tabs-sync",
  "version": "0.1.0",
  "private": true,
  "description": "Encrypted sync of tabs, tab groups and bookmarks between browsers",
  "type": "module",
  "scripts": {
    "build:extension": "node ./scripts/build-extension.mjs",
    "package:chromium": "node ./scripts/package-chromium.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "pnpm build:extension && playwright test",
    "lint": "oxlint .",
    "format": "oxfmt \"src/**/*.{ts,tsx}\" \"tests/**/*.{ts,tsx}\" \"e2e/**/*.ts\" package.json src/manifest.json",
    "format:check": "oxfmt --check \"src/**/*.{ts,tsx}\" \"tests/**/*.{ts,tsx}\" \"e2e/**/*.ts\" package.json src/manifest.json",
    "audit:deps": "audit-ci --config ./audit-ci.json",
    "prepare": "lefthook install"
  },
  "packageManager": "pnpm@12.18.0"
}
```

`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
  lefthook: true

blockExoticSubdeps: true
minimumReleaseAge: 1440
optimisticRepeatInstall: true
strictDepBuilds: true
verifyDepsBeforeRun: install
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "types": ["node", "chrome"]
  },
  "include": ["src/**/*", "tests/**/*", "e2e/**/*", "*.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
```

`.gitignore`:

```
dist/
node_modules/
coverage/
test-results/
playwright-report/
*.log
*.tsbuildinfo
.env
.env.*
.vscode/
.idea/
.DS_Store
```

`.oxfmtrc.json` and `.oxlintrc.json`:

```json
{
  "ignorePatterns": ["dist/**", "node_modules/**"]
}
```

`audit-ci.json`:

```json
{
  "moderate": true,
  "report-type": "summary"
}
```

`lefthook.yml`:

```yaml
pre-commit:
  commands:
    typecheck:
      run: pnpm typecheck
    lint:
      run: pnpm lint
    format:
      run: pnpm format

pre-push:
  commands:
    test:
      run: pnpm test
```

- [ ] **Step 3: Install dependencies at newest versions**

```bash
corepack enable 2>/dev/null; pnpm add preact@latest @preact/signals@latest
pnpm add -D @testing-library/dom@latest @testing-library/preact@latest @types/jsdom@latest @types/node@latest @types/chrome@latest @playwright/test@latest audit-ci@latest esbuild@latest fake-indexeddb@latest jsdom@latest lefthook@latest oxfmt@latest oxlint@latest typescript@latest vite@latest vitest@latest
```

Expected: `pnpm-lock.yaml` created, no peer dependency errors.

- [ ] **Step 4: Write the failing manifest test**

`tests/manifest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../src/manifest.json"), "utf8"));

describe("manifest", () => {
  it("grants only the required permissions", () => {
    expect([...manifest.permissions].sort()).toEqual(["bookmarks", "storage", "tabGroups", "tabs"]);
    expect(manifest.host_permissions).toEqual(["https://api.github.com/*"]);
  });

  it("has no content scripts and no background worker", () => {
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.background).toBeUndefined();
  });

  it("locks the content security policy", () => {
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
});
```

Run: `pnpm test tests/manifest.test.ts`
Expected: FAIL, `ENOENT` for `src/manifest.json`.

- [ ] **Step 5: Write the manifest**

Generate the stable-ID public key (a stable ID lets the end-to-end test open extension pages):

```bash
openssl genrsa 2048 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null | base64 -w0
```

`src/manifest.json`, with `key` set to that output:

```json
{
  "manifest_version": 3,
  "name": "Browser Tabs Sync",
  "version": "0.1.0",
  "description": "Encrypted sync of tabs, tab groups and bookmarks between browsers.",
  "key": "<paste generated value>",
  "minimum_chrome_version": "134",
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "permissions": ["tabs", "tabGroups", "bookmarks", "storage"],
  "host_permissions": ["https://api.github.com/*"],
  "action": {
    "default_title": "Browser Tabs Sync",
    "default_popup": "popup/index.html"
  },
  "options_page": "options/index.html"
}
```

Run: `pnpm test tests/manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: Write entry stubs and build scripts**

For each `<page>` in `popup`, `options`, `preview`, create `src/<page>/index.html`:

```html
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <title>Browser Tabs Sync</title>
    <link rel="stylesheet" href="../ui/shared/tokens.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>
```

and `src/<page>/index.tsx` (replaced in Tasks 8 and 9):

```tsx
import { render } from "preact";

render(<main>Browser Tabs Sync</main>, document.getElementById("app")!);
```

`src/ui/shared/tokens.css`:

```css
:root {
  color-scheme: light dark;
  font: 14px/1.4 system-ui, sans-serif;
}
body {
  margin: 0;
  padding: 12px;
  min-width: 320px;
}
button {
  font: inherit;
  padding: 6px 10px;
}
label {
  display: block;
  margin-block: 8px;
}
input {
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
.error {
  color: #c62828;
}
```

`scripts/build-extension.mjs`:

```js
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const repoRoot = resolve(import.meta.dirname, "..");
const srcDir = resolve(repoRoot, "src");
const outdir = resolve(repoRoot, "dist/extension");
const pages = ["popup", "options", "preview"];

rmSync(outdir, { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: Object.fromEntries(pages.map((page) => [`${page}/index`, resolve(srcDir, `${page}/index.tsx`)])),
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  outdir,
  platform: "browser",
  target: ["chrome134"],
});

for (const page of pages) {
  cpSync(resolve(srcDir, `${page}/index.html`), resolve(outdir, `${page}/index.html`));
}
mkdirSync(resolve(outdir, "ui/shared"), { recursive: true });
cpSync(resolve(srcDir, "ui/shared/tokens.css"), resolve(outdir, "ui/shared/tokens.css"));
cpSync(resolve(srcDir, "manifest.json"), resolve(outdir, "manifest.json"));
```

`scripts/package-chromium.mjs`:

```js
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionDir = resolve(repoRoot, "dist/extension");
const outputZip = resolve(repoRoot, "dist/browser-tabs-sync-chromium.zip");

if (!existsSync(extensionDir)) {
  console.error("Run 'pnpm build:extension' first");
  process.exit(1);
}
rmSync(outputZip, { force: true });
execFileSync("zip", ["-r", "-q", outputZip, "."], { cwd: extensionDir, stdio: "inherit" });
console.log(`Created ${outputZip}`);
```

- [ ] **Step 7: Write CI and release workflows**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22, 24]
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm audit:deps

  e2e:
    runs-on: ubuntu-latest
    needs: ci
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e

  preview-bundle:
    runs-on: ubuntu-latest
    needs: ci
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:extension
      - run: pnpm package:chromium
      - uses: actions/upload-artifact@v7
        with:
          name: browser-tabs-sync-chromium-pr-${{ github.event.pull_request.number }}
          path: dist/browser-tabs-sync-chromium.zip
          if-no-files-found: error
          retention-days: 14
```

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build:extension
      - run: pnpm package:chromium
      - env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          mv dist/browser-tabs-sync-chromium.zip "dist/browser-tabs-sync-chromium-${GITHUB_REF_NAME}.zip"
          gh release create "$GITHUB_REF_NAME" --generate-notes "dist/browser-tabs-sync-chromium-${GITHUB_REF_NAME}.zip"
```

- [ ] **Step 8: Verify all gates**

Run: `pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm build:extension && pnpm package:chromium && pnpm audit:deps`
Expected: every command exits 0, `dist/extension/manifest.json` exists. If a newest major fails, pin the newest working version per Global Constraints.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold extension tooling and CI"
```

---

### Task 2: Encryption

**Files:**
- Create: `src/shared/types.ts`, `src/shared/base64.ts`, `src/shared/crypto.ts`
- Test: `tests/crypto.test.ts`

**Interfaces:**
- Produces:
  - `toBase64(bytes: Uint8Array): string`, `fromBase64(text: string): Uint8Array<ArrayBuffer>`
  - `generateKeyText(): string`
  - `importKeyText(text: string): Promise<CryptoKey>` (non-extractable, throws `DecryptError` on bad length)
  - `encrypt(key: CryptoKey, path: string, plaintext: string): Promise<Uint8Array<ArrayBuffer>>`
  - `decrypt(key: CryptoKey, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<string>` (throws `DecryptError`)
  - All types in `types.ts`.

- [ ] **Step 1: Write the types**

`src/shared/types.ts`:

```ts
export type FolderType = "bookmarks-bar" | "other" | "mobile";

export type Group = { ref: string; title: string; color: string; collapsed: boolean; localId?: number };

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
```

`localId` exists only on freshly captured state and is stripped by `toSnapshot` (Task 4).

- [ ] **Step 2: Write the failing test**

`tests/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decrypt, DecryptError, encrypt, generateKeyText, importKeyText } from "../src/shared/crypto";

const key = () => importKeyText(generateKeyText());

describe("crypto", () => {
  it("round-trips text", async () => {
    const k = await key();
    expect(await decrypt(k, "a.enc", await encrypt(k, "a.enc", "https://example.com"))).toBe("https://example.com");
  });

  it("uses a fresh IV for every write", async () => {
    const k = await key();
    const [a, b] = [await encrypt(k, "a.enc", "x"), await encrypt(k, "a.enc", "x")];
    expect(a).not.toEqual(b);
  });

  it("does not contain the plaintext", async () => {
    const bytes = await encrypt(await key(), "a.enc", "https://secret.example");
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("secret");
  });

  it("rejects a file moved to another path", async () => {
    const k = await key();
    await expect(decrypt(k, "b.enc", await encrypt(k, "a.enc", "x"))).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects modified bytes", async () => {
    const k = await key();
    const bytes = await encrypt(k, "a.enc", "x");
    bytes[bytes.length - 1]! ^= 1;
    await expect(decrypt(k, "a.enc", bytes)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects the wrong key", async () => {
    await expect(decrypt(await key(), "a.enc", await encrypt(await key(), "a.enc", "x"))).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it("rejects an unknown format version", async () => {
    const k = await key();
    const bytes = await encrypt(k, "a.enc", "x");
    bytes[0] = 2;
    await expect(decrypt(k, "a.enc", bytes)).rejects.toBeInstanceOf(DecryptError);
  });

  it("generates 256-bit keys and rejects malformed key text", async () => {
    expect(generateKeyText()).toHaveLength(43);
    await expect(importKeyText("short")).rejects.toBeInstanceOf(DecryptError);
  });

  it("creates non-extractable keys", async () => {
    await expect(crypto.subtle.exportKey("raw", await key())).rejects.toThrow();
  });
});
```

Run: `pnpm test tests/crypto.test.ts`
Expected: FAIL, cannot resolve `../src/shared/crypto`.

- [ ] **Step 3: Implement**

`src/shared/base64.ts`:

```ts
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
```

`src/shared/crypto.ts`:

```ts
import { fromBase64, toBase64 } from "./base64";

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const HEADER_LENGTH = 1 + IV_LENGTH;
const KEY_BYTES = 32;

export class DecryptError extends Error {}

const associatedData = (path: string) => new TextEncoder().encode(`bts:v1:${path}`);

export function generateKeyText(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function importKeyText(text: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(text.trim().replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new DecryptError("Malformed key");
  }
  if (bytes.length !== KEY_BYTES) throw new DecryptError("Malformed key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, path: string, plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(path) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const output = new Uint8Array(HEADER_LENGTH + ciphertext.length);
  output[0] = FORMAT_VERSION;
  output.set(iv, 1);
  output.set(ciphertext, HEADER_LENGTH);
  return output;
}

export async function decrypt(key: CryptoKey, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (bytes[0] !== FORMAT_VERSION || bytes.length <= HEADER_LENGTH) throw new DecryptError("Unsupported file");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(1, HEADER_LENGTH), additionalData: associatedData(path) },
      key,
      bytes.slice(HEADER_LENGTH),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new DecryptError("Decryption failed");
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm test tests/crypto.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/crypto.test.ts
git commit -m "feat: add AES-GCM encryption of remote files"
```

---

### Task 3: GitHub adapter and encrypted remote

**Files:**
- Create: `src/shared/github.ts`, `src/shared/remote.ts`
- Test: `tests/github.test.ts`, `tests/remote.test.ts`

**Interfaces:**
- Consumes: `encrypt`, `decrypt`, `toBase64`, `fromBase64`, `Snapshot`.
- Produces:
  - `type RepoConfig = { owner: string; repo: string; token: string }`
  - `class GitHubError extends Error { kind: "auth" | "not-found" | "conflict" | "rate-limit" | "network" | "unknown" }`
  - `checkRepo(config): Promise<void>`
  - `readFile(config, path): Promise<{ sha: string; bytes: Uint8Array<ArrayBuffer> } | null>`
  - `writeFile(config, path, bytes, sha?): Promise<string>`
  - `type Remote = { config: RepoConfig; key: CryptoKey }`, `type SyncProfile = { id: string; name: string }`
  - `listProfiles(remote): Promise<SyncProfile[]>`, `createProfile(remote, name): Promise<SyncProfile>`
  - `readSnapshot(remote, id): Promise<{ snapshot: Snapshot; sha: string } | null>`
  - `writeSnapshot(remote, id, snapshot, sha?): Promise<string>`

`parseSnapshot` comes from Task 4. In this task `remote.ts` imports it, so create `src/shared/snapshot.ts` containing only Task 4 Step 3's `parseSnapshot` first if working out of order. In order, implement Task 4 before `remote.ts`: do Steps 1-4 here for `github.ts`, then Task 4, then Steps 5-8.

- [ ] **Step 1: Write the failing GitHub test**

`tests/github.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRepo, GitHubError, readFile, writeFile } from "../src/shared/github";

const config = { owner: "o", repo: "r", token: "t" };
const fetchMock = vi.fn();
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("readFile", () => {
  it("decodes base64 content containing newlines and bypasses the cache", async () => {
    fetchMock.mockResolvedValue(json(200, { sha: "s1", encoding: "base64", content: "dHdv\n" }));
    const file = await readFile(config, "a.enc");
    expect(file?.sha).toBe("s1");
    expect(new TextDecoder().decode(file?.bytes)).toBe("two");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/contents/a.enc");
    expect(init.cache).toBe("no-store");
    expect(init.headers.Authorization).toBe("Bearer t");
  });

  it("returns null for a missing file", async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    expect(await readFile(config, "a.enc")).toBeNull();
  });

  it("fetches raw bytes when the JSON has no inline content", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { sha: "s1", encoding: "none", content: "" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }));
    const file = await readFile(config, "a.enc");
    expect([...file!.bytes]).toEqual([1, 2]);
    expect(fetchMock.mock.calls[1]![1].headers.Accept).toBe("application/vnd.github.raw+json");
  });
});

describe("writeFile", () => {
  it("sends base64, a neutral message and the sha", async () => {
    fetchMock.mockResolvedValue(json(200, { content: { sha: "s2" } }));
    expect(await writeFile(config, "a.enc", new Uint8Array([116, 119, 111]), "s1")).toBe("s2");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ message: "update", content: "dHdv", sha: "s1" });
  });

  it.each([
    [409, "s1"],
    [422, undefined],
  ])("reports status %i as a conflict", async (status, sha) => {
    fetchMock.mockResolvedValue(json(status, {}));
    await expect(writeFile(config, "a.enc", new Uint8Array(), sha)).rejects.toMatchObject({ kind: "conflict" });
  });
});

describe("errors", () => {
  it("maps 401 to auth", async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps a 404 repository to not-found", async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "not-found" });
  });

  it("maps an exhausted quota to rate-limit", async () => {
    fetchMock.mockResolvedValue(json(403, {}, { "x-ratelimit-remaining": "0" }));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("maps a fetch failure to network", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const error = await checkRepo(config).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.kind).toBe("network");
  });
});
```

Run: `pnpm test tests/github.test.ts`
Expected: FAIL, cannot resolve `../src/shared/github`.

- [ ] **Step 2: Implement the adapter**

`src/shared/github.ts`:

```ts
import { fromBase64, toBase64 } from "./base64";

export type RepoConfig = { owner: string; repo: string; token: string };
export type GitHubErrorKind = "auth" | "not-found" | "conflict" | "rate-limit" | "network" | "unknown";

export class GitHubError extends Error {
  constructor(readonly kind: GitHubErrorKind) {
    super(`GitHub error: ${kind}`);
  }
}

const baseUrl = (config: RepoConfig) => `https://api.github.com/repos/${config.owner}/${config.repo}`;

const headers = (config: RepoConfig, accept = "application/vnd.github+json") => ({
  Accept: accept,
  Authorization: `Bearer ${config.token}`,
  "X-GitHub-Api-Version": "2026-03-10",
});

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new GitHubError("network");
  }
}

function errorFor(response: Response): GitHubError {
  if (response.status === 401) return new GitHubError("auth");
  if (response.status === 404) return new GitHubError("not-found");
  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    return new GitHubError("rate-limit");
  }
  if (response.status === 403) return new GitHubError("auth");
  return new GitHubError("unknown");
}

export async function checkRepo(config: RepoConfig): Promise<void> {
  const response = await request(baseUrl(config), { headers: headers(config) });
  if (!response.ok) throw errorFor(response);
}

export async function readFile(
  config: RepoConfig,
  path: string,
): Promise<{ sha: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const url = `${baseUrl(config)}/contents/${path}`;
  const response = await request(url, { headers: headers(config) });
  if (response.status === 404) return null;
  if (!response.ok) throw errorFor(response);
  const body = (await response.json()) as { sha: string; encoding: string; content: string };
  if (body.encoding === "base64" && body.content) return { sha: body.sha, bytes: fromBase64(body.content) };
  const raw = await request(url, { headers: headers(config, "application/vnd.github.raw+json") });
  if (!raw.ok) throw errorFor(raw);
  return { sha: body.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
}

export async function writeFile(config: RepoConfig, path: string, bytes: Uint8Array, sha?: string): Promise<string> {
  const response = await request(`${baseUrl(config)}/contents/${path}`, {
    method: "PUT",
    headers: headers(config),
    body: JSON.stringify({ message: "update", content: toBase64(bytes), ...(sha ? { sha } : {}) }),
  });
  if (response.status === 409 || response.status === 422) throw new GitHubError("conflict");
  if (!response.ok) throw errorFor(response);
  const body = (await response.json()) as { content: { sha: string } };
  return body.content.sha;
}
```

- [ ] **Step 3: Verify the adapter**

Run: `pnpm test tests/github.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit the adapter**

```bash
git add src/shared/github.ts tests/github.test.ts
git commit -m "feat: add GitHub contents API adapter"
```

- [ ] **Step 5: Complete Task 4, then write the failing remote test**

`tests/remote.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyText, importKeyText } from "../src/shared/crypto";
import { createProfile, listProfiles, readSnapshot, writeSnapshot, type Remote } from "../src/shared/remote";
import type { Snapshot } from "../src/shared/types";

const files = new Map<string, { sha: string; bytes: Uint8Array<ArrayBuffer> }>();
let counter = 0;

vi.mock("../src/shared/github", () => ({
  readFile: async (_: unknown, path: string) => files.get(path) ?? null,
  writeFile: async (_: unknown, path: string, bytes: Uint8Array<ArrayBuffer>) => {
    const sha = `s${++counter}`;
    files.set(path, { sha, bytes });
    return sha;
  },
}));

let remote: Remote;
const snapshot: Snapshot = { formatVersion: 1, sentAt: "2026-11-08T00:00:00Z", deviceName: "A", windows: [], bookmarks: [] };

beforeEach(async () => {
  files.clear();
  remote = { config: { owner: "o", repo: "r", token: "t" }, key: await importKeyText(generateKeyText()) };
});

describe("remote", () => {
  it("returns no profiles for an empty repository", async () => {
    expect(await listProfiles(remote)).toEqual([]);
  });

  it("creates a profile under a random file name and hides its name", async () => {
    const profile = await createProfile(remote, "Praca");
    expect(await listProfiles(remote)).toEqual([profile]);
    expect(profile.id).toMatch(/^[0-9a-f]{32}$/);
    const stored = new TextDecoder("latin1").decode(files.get("index.enc")!.bytes);
    expect(stored).not.toContain("Praca");
  });

  it("round-trips a snapshot", async () => {
    const { id } = await createProfile(remote, "Praca");
    const sha = await writeSnapshot(remote, id, snapshot);
    expect(await readSnapshot(remote, id)).toEqual({ snapshot, sha });
  });

  it("returns null when nothing was sent yet", async () => {
    expect(await readSnapshot(remote, "missing")).toBeNull();
  });
});
```

Run: `pnpm test tests/remote.test.ts`
Expected: FAIL, cannot resolve `../src/shared/remote`.

- [ ] **Step 6: Implement**

`src/shared/remote.ts`:

```ts
import { decrypt, encrypt } from "./crypto";
import { readFile, writeFile, type RepoConfig } from "./github";
import { parseSnapshot } from "./snapshot";
import type { Snapshot } from "./types";

export type Remote = { config: RepoConfig; key: CryptoKey };
export type SyncProfile = { id: string; name: string };

const INDEX_PATH = "index.enc";
const profilePath = (id: string) => `profiles/${id}.enc`;

async function readIndex(remote: Remote): Promise<{ profiles: SyncProfile[]; sha?: string }> {
  const file = await readFile(remote.config, INDEX_PATH);
  if (!file) return { profiles: [] };
  const text = await decrypt(remote.key, INDEX_PATH, file.bytes);
  return { profiles: JSON.parse(text) as SyncProfile[], sha: file.sha };
}

export async function listProfiles(remote: Remote): Promise<SyncProfile[]> {
  return (await readIndex(remote)).profiles;
}

export async function createProfile(remote: Remote, name: string): Promise<SyncProfile> {
  const { profiles, sha } = await readIndex(remote);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const profile = { id, name };
  const bytes = await encrypt(remote.key, INDEX_PATH, JSON.stringify([...profiles, profile]));
  await writeFile(remote.config, INDEX_PATH, bytes, sha);
  return profile;
}

export async function readSnapshot(remote: Remote, id: string): Promise<{ snapshot: Snapshot; sha: string } | null> {
  const path = profilePath(id);
  const file = await readFile(remote.config, path);
  if (!file) return null;
  return { snapshot: parseSnapshot(JSON.parse(await decrypt(remote.key, path, file.bytes))), sha: file.sha };
}

export async function writeSnapshot(remote: Remote, id: string, snapshot: Snapshot, sha?: string): Promise<string> {
  const path = profilePath(id);
  return writeFile(remote.config, path, await encrypt(remote.key, path, JSON.stringify(snapshot)), sha);
}
```

- [ ] **Step 7: Verify**

Run: `pnpm test tests/remote.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/remote.ts tests/remote.test.ts
git commit -m "feat: store encrypted profiles and snapshots remotely"
```

---

### Task 4: Snapshot capture and validation

**Files:**
- Create: `src/shared/snapshot.ts`
- Test: `tests/snapshot.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces:
  - `isSyncableUrl(url: string): boolean`
  - `capture(): Promise<BrowserState>`
  - `toSnapshot(state: BrowserState, deviceName: string, sentAt: string): Snapshot`
  - `parseSnapshot(value: unknown): Snapshot` (throws `InvalidSnapshotError`)

- [ ] **Step 1: Write the failing test**

`tests/snapshot.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { capture, InvalidSnapshotError, isSyncableUrl, parseSnapshot, toSnapshot } from "../src/shared/snapshot";

afterEach(() => vi.unstubAllGlobals());

function stubChrome() {
  vi.stubGlobal("chrome", {
    windows: {
      getAll: async () => [
        {
          id: 1,
          incognito: false,
          tabs: [
            { id: 10, url: "https://a.test/", title: "A", pinned: true, active: false, groupId: -1 },
            { id: 11, url: "https://b.test/", title: "B", pinned: false, active: true, groupId: 5 },
            { id: 12, url: "chrome-extension://x/preview/index.html", title: "P", pinned: false, active: false, groupId: -1 },
            { id: 13, url: "", pendingUrl: "https://c.test/", title: "", pinned: false, active: false, groupId: -1 },
          ],
        },
        { id: 2, incognito: true, tabs: [{ id: 20, url: "https://private.test/", groupId: -1 }] },
      ],
    },
    tabGroups: { query: async () => [{ id: 5, windowId: 1, title: "G", color: "blue", collapsed: true }] },
    bookmarks: {
      getTree: async () => [
        {
          id: "0",
          children: [
            {
              id: "1",
              folderType: "bookmarks-bar",
              children: [
                { id: "2", title: "F", children: [{ id: "3", title: "X", url: "https://x.test/" }] },
              ],
            },
            { id: "9", folderType: "managed", children: [{ id: "8", title: "M", url: "https://m.test/" }] },
          ],
        },
      ],
    },
  });
}

describe("isSyncableUrl", () => {
  it.each([
    ["https://a.test/", true],
    ["chrome://settings/", true],
    ["", false],
    ["about:blank", false],
    ["chrome://newtab/", false],
    ["chrome-extension://abc/page.html", false],
  ])("%s -> %s", (url, expected) => expect(isSyncableUrl(url)).toBe(expected));
});

describe("capture", () => {
  it("reads tabs, groups and bookmarks but skips incognito, extension and managed entries", async () => {
    stubChrome();
    const state = await capture();
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]!.tabs.map((t) => t.url)).toEqual(["https://a.test/", "https://b.test/", "https://c.test/"]);
    expect(state.windows[0]!.tabs[1]).toMatchObject({ groupRef: "g5", localId: 11 });
    expect(state.windows[0]!.groups).toEqual([{ ref: "g5", title: "G", color: "blue", collapsed: true, localId: 5 }]);
    expect(state.bookmarks.map((b) => b.folderType)).toEqual(["bookmarks-bar"]);
    expect(state.bookmarks[0]!.children[0]).toMatchObject({ kind: "folder", title: "F" });
  });

  it("removes local ids from what gets uploaded", async () => {
    stubChrome();
    expect(JSON.stringify(toSnapshot(await capture(), "A", "t"))).not.toContain("localId");
  });
});

describe("parseSnapshot", () => {
  const valid = {
    formatVersion: 1,
    sentAt: "t",
    deviceName: "A",
    windows: [
      {
        groups: [{ ref: "g", title: "G", color: "blue", collapsed: false }],
        tabs: [{ url: "https://a.test/", title: "A", pinned: false, active: true, groupRef: "g" }],
      },
    ],
    bookmarks: [
      {
        folderType: "other",
        children: [
          { kind: "folder", title: "F", children: [{ kind: "bookmark", title: "X", url: "https://x.test/" }] },
        ],
      },
    ],
  };

  it("accepts a valid snapshot", () => expect(parseSnapshot(valid)).toEqual(valid));

  it.each([
    ["wrong version", { ...valid, formatVersion: 2 }],
    ["missing windows", { ...valid, windows: undefined }],
    ["bad tab", { ...valid, windows: [{ groups: [], tabs: [{ url: 1 }] }] }],
    ["bad folder type", { ...valid, bookmarks: [{ folderType: "managed", children: [] }] }],
    ["unknown group", { ...valid, windows: [{ groups: [], tabs: [{ url: "u", title: "", pinned: false, active: false, groupRef: "x" }] }] }],
  ])("rejects %s", (_, value) => expect(() => parseSnapshot(value)).toThrow(InvalidSnapshotError));
});
```

Run: `pnpm test tests/snapshot.test.ts`
Expected: FAIL, cannot resolve `../src/shared/snapshot`.

- [ ] **Step 2: Implement**

`src/shared/snapshot.ts`:

```ts
import type { BookmarkNode, BookmarkRoot, BrowserState, BrowserWindow, FolderType, Group, Snapshot, Tab } from "./types";

export class InvalidSnapshotError extends Error {}

const FOLDER_TYPES: readonly string[] = ["bookmarks-bar", "other", "mobile"];
const NO_GROUP = -1;

export function isSyncableUrl(url: string): boolean {
  return Boolean(url) && url !== "about:blank" && !url.startsWith("chrome://newtab") && !url.startsWith("chrome-extension://");
}

function toBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  return node.url
    ? { kind: "bookmark", title: node.title, url: node.url, localId: node.id }
    : { kind: "folder", title: node.title, children: (node.children ?? []).map(toBookmarkNode), localId: node.id };
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
        .map((g): Group => ({ ref: `g${g.id}`, title: g.title ?? "", color: g.color, collapsed: g.collapsed, localId: g.id })),
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
  const stripped = JSON.parse(JSON.stringify(state, (key, value) => (key === "localId" ? undefined : value))) as BrowserState;
  return { formatVersion: 1, sentAt, deviceName, ...stripped };
}

function fail(): never {
  throw new InvalidSnapshotError("Invalid snapshot");
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
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
    if (!isObject(group) || !isString(group.ref) || !isString(group.title) || !isString(group.color) || !isBoolean(group.collapsed)) fail();
    refs.add(group.ref);
  }
  for (const tab of value.tabs) {
    if (!isObject(tab) || !isString(tab.url) || !isString(tab.title) || !isBoolean(tab.pinned) || !isBoolean(tab.active)) fail();
    if (tab.groupRef !== undefined && !refs.has(tab.groupRef)) fail();
  }
}

export function parseSnapshot(value: unknown): Snapshot {
  if (!isObject(value) || value.formatVersion !== 1 || !isString(value.sentAt) || !isString(value.deviceName)) fail();
  if (!Array.isArray(value.windows) || !Array.isArray(value.bookmarks)) fail();
  value.windows.forEach(checkWindow);
  for (const root of value.bookmarks) {
    if (!isObject(root) || !FOLDER_TYPES.includes(root.folderType as string)) fail();
    checkBookmarkNodes(root.children);
  }
  return value as unknown as Snapshot;
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/snapshot.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/snapshot.ts tests/snapshot.test.ts
git commit -m "feat: capture and validate browser snapshots"
```

---

### Task 5: Diff

**Files:**
- Create: `src/shared/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: `BrowserState`, `FolderType`, `BookmarkNode`.
- Produces:

```ts
export type TabChange = {
  id: string;
  kind: "open" | "close";
  url: string;
  title: string;
  windowIndex: number;      // target window for "open", local window for "close"
  groupTitle?: string;
  targetTab?: number;       // set for "open"
  localId?: number;         // set for "close"
};
export type BookmarkChange = {
  id: string;
  kind: "add" | "remove";
  folderType: FolderType;
  path: string[];
  title: string;
  url?: string;             // undefined means folder
  localId?: string;         // set for "remove"
};
export type TabMatch = { targetWindow: number; targetTab: number; localId: number };
export type ChangeSet = {
  windowPairs: number[];    // index: target window, value: local window index or -1
  tabs: TabChange[];
  bookmarks: BookmarkChange[];
  matches: TabMatch[];
};
export function diff(local: BrowserState, target: BrowserState): ChangeSet;
export function flattenBookmarks(roots: BookmarkRoot[]): FlatBookmark[];
```

- [ ] **Step 1: Write the failing test**

`tests/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diff } from "../src/shared/diff";
import type { BookmarkRoot, BrowserState, Tab } from "../src/shared/types";

let nextId = 100;
const tab = (url: string, extra: Partial<Tab> = {}): Tab => ({ url, title: url, pinned: false, active: false, localId: nextId++, ...extra });
const state = (windows: Tab[][], bookmarks: BookmarkRoot[] = []): BrowserState => ({
  windows: windows.map((tabs, i) => ({ localId: i + 1, groups: [], tabs })),
  bookmarks,
});

describe("diff tabs", () => {
  it("reports nothing for identical state", () => {
    const changes = diff(state([[tab("a"), tab("b")]]), state([[tab("a"), tab("b")]]));
    expect(changes.tabs).toEqual([]);
    expect(changes.matches).toHaveLength(2);
    expect(changes.windowPairs).toEqual([0]);
  });

  it("lists tabs to open and close", () => {
    const local = state([[tab("a"), tab("gone", { localId: 7 })]]);
    const changes = diff(local, state([[tab("a"), tab("new")]]));
    expect(changes.tabs).toMatchObject([
      { kind: "open", url: "new", targetTab: 1, windowIndex: 0 },
      { kind: "close", url: "gone", localId: 7, windowIndex: 0 },
    ]);
  });

  it("counts duplicate URLs", () => {
    const changes = diff(state([[tab("a")]]), state([[tab("a"), tab("a")]]));
    expect(changes.tabs).toMatchObject([{ kind: "open", url: "a", targetTab: 1 }]);
  });

  it("pairs windows by the most shared URLs regardless of order", () => {
    const local = state([[tab("x"), tab("y")], [tab("a"), tab("b")]]);
    const changes = diff(local, state([[tab("a"), tab("b")], [tab("x")]]));
    expect(changes.windowPairs).toEqual([1, 0]);
  });

  it("marks windows without a counterpart for creation and closes unpaired local windows", () => {
    const changes = diff(state([[tab("old")]]), state([[tab("new")]]));
    expect(changes.windowPairs).toEqual([-1]);
    expect(changes.tabs.map((t) => t.kind).sort()).toEqual(["close", "open"]);
  });

  it("reuses a local window with no syncable tabs instead of creating one", () => {
    expect(diff(state([[]]), state([[tab("new")]])).windowPairs).toEqual([0]);
  });

  it("includes the group title for display", () => {
    const target: BrowserState = {
      windows: [{ groups: [{ ref: "g", title: "Praca", color: "blue", collapsed: false }], tabs: [tab("a", { groupRef: "g" })] }],
      bookmarks: [],
    };
    expect(diff(state([[]]), target).tabs[0]).toMatchObject({ groupTitle: "Praca" });
  });

  it("gives every change a unique id", () => {
    const { tabs } = diff(state([[tab("x"), tab("y")]]), state([[tab("a"), tab("b")]]));
    expect(new Set(tabs.map((t) => t.id)).size).toBe(4);
  });
});

describe("diff bookmarks", () => {
  const bookmark = (url: string, localId?: string) => ({ kind: "bookmark" as const, title: url, url, localId });
  const roots = (children: BookmarkRoot["children"]): BookmarkRoot[] => [{ folderType: "bookmarks-bar", children }];

  it("reports nothing for identical trees", () => {
    const tree = roots([{ kind: "folder", title: "F", children: [bookmark("a")] }]);
    expect(diff(state([], tree), state([], tree)).bookmarks).toEqual([]);
  });

  it("treats the same URL in another folder as add and remove", () => {
    const local = roots([{ kind: "folder", title: "F", localId: "f", children: [bookmark("a", "1")] }]);
    const target = roots([{ kind: "folder", title: "F", children: [] }, bookmark("a")]);
    expect(diff(state([], local), state([], target)).bookmarks).toMatchObject([
      { kind: "add", path: [], url: "a" },
      { kind: "remove", path: ["F"], url: "a", localId: "1" },
    ]);
  });

  it("reports empty folders", () => {
    const target = roots([{ kind: "folder", title: "New", children: [] }]);
    expect(diff(state([], []), state([], target)).bookmarks).toMatchObject([{ kind: "add", title: "New", path: [] }]);
  });

  it("keeps roots separate", () => {
    const local: BookmarkRoot[] = [{ folderType: "other", children: [bookmark("a", "1")] }];
    const target: BookmarkRoot[] = [{ folderType: "bookmarks-bar", children: [bookmark("a")] }];
    expect(diff(state([], local), state([], target)).bookmarks.map((b) => b.kind)).toEqual(["add", "remove"]);
  });
});
```

Run: `pnpm test tests/diff.test.ts`
Expected: FAIL, cannot resolve `../src/shared/diff`.

- [ ] **Step 2: Implement**

`src/shared/diff.ts`:

```ts
import type { BookmarkNode, BookmarkRoot, BrowserState, BrowserWindow, FolderType } from "./types";

export type TabChange = {
  id: string;
  kind: "open" | "close";
  url: string;
  title: string;
  windowIndex: number;
  groupTitle?: string;
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
    const groupTitles = new Map(targetWindow.groups.map((g) => [g.ref, g.title]));
    targetWindow.tabs.forEach((tab, targetTab) => {
      const candidates = pair >= 0 ? unmatchedLocal[pair]! : [];
      const found = candidates.findIndex((c) => c.url === tab.url);
      if (found >= 0) {
        matches.push({ targetWindow: targetIndex, targetTab, localId: candidates.splice(found, 1)[0]!.localId! });
        return;
      }
      const groupTitle = tab.groupRef ? groupTitles.get(tab.groupRef) : undefined;
      tabs.push({
        id: `open:${targetIndex}:${targetTab}`,
        kind: "open",
        url: tab.url,
        title: tab.title,
        windowIndex: targetIndex,
        targetTab,
        ...(groupTitle === undefined ? {} : { groupTitle }),
      });
    });
  });

  unmatchedLocal.forEach((windowTabs, windowIndex) => {
    const groupTitles = new Map(local.windows[windowIndex]!.groups.map((g) => [g.ref, g.title]));
    for (const tab of windowTabs) {
      const groupTitle = tab.groupRef ? groupTitles.get(tab.groupRef) : undefined;
      tabs.push({
        id: `close:${tab.localId}`,
        kind: "close",
        url: tab.url,
        title: tab.title,
        windowIndex,
        localId: tab.localId!,
        ...(groupTitle === undefined ? {} : { groupTitle }),
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

const bookmarkKey = (b: FlatBookmark) => [b.folderType, ...b.path, b.url ?? `folder:${b.title}`].join("\0");

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
  const removals = unmatchedLocal.map(
    (entry, index): BookmarkChange => ({ ...entry, id: `remove:${entry.localId ?? index}`, kind: "remove" }),
  );
  return [...additions, ...removals];
}

export function diff(local: BrowserState, target: BrowserState): ChangeSet {
  const windowPairs = pairWindows(local.windows, target.windows);
  return { windowPairs, ...diffTabs(local, target, windowPairs), bookmarks: diffBookmarks(local, target) };
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/diff.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/diff.ts tests/diff.test.ts
git commit -m "feat: compute changes between browser states"
```

---

### Task 6: Applying changes

**Files:**
- Create: `src/shared/apply.ts`
- Test: `tests/apply.test.ts`

**Interfaces:**
- Consumes: `ChangeSet`, `TabChange`, `BookmarkChange`, `flattenBookmarks`, `BrowserState`.
- Produces:
  - `type ApplyFailure = { url: string; message: string }`
  - `apply(local: BrowserState, target: BrowserState, changes: ChangeSet, selected: ReadonlySet<string>): Promise<ApplyFailure[]>`

- [ ] **Step 1: Write the failing test**

`tests/apply.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply } from "../src/shared/apply";
import { diff } from "../src/shared/diff";
import type { BrowserState } from "../src/shared/types";

let nextTab = 500;
const api = {
  windows: { create: vi.fn() },
  tabs: {
    create: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    update: vi.fn(),
    group: vi.fn(),
    ungroup: vi.fn(),
    getCurrent: vi.fn(),
  },
  tabGroups: { update: vi.fn() },
  bookmarks: { create: vi.fn(), remove: vi.fn(), getTree: vi.fn(), move: vi.fn(), update: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.create.mockImplementation(async () => ({ id: nextTab++ }));
  api.windows.create.mockImplementation(async () => ({ id: 77, tabs: [{ id: nextTab++ }] }));
  api.tabs.group.mockResolvedValue(9);
  api.tabs.getCurrent.mockResolvedValue({ windowId: 999 });
  api.bookmarks.create.mockImplementation(async (p) => ({ id: `new-${p.title}` }));
  api.bookmarks.getTree.mockResolvedValue([{ children: [] }]);
  vi.stubGlobal("chrome", api);
});

const base = { pinned: false, active: false, title: "" };
const local: BrowserState = {
  windows: [
    {
      localId: 1,
      groups: [{ ref: "g1", title: "Old", color: "red", collapsed: false, localId: 40 }],
      tabs: [
        { ...base, url: "keep", localId: 10, groupRef: "g1" },
        { ...base, url: "gone", localId: 11 },
      ],
    },
  ],
  bookmarks: [],
};
const target: BrowserState = {
  windows: [
    {
      groups: [{ ref: "n", title: "New", color: "blue", collapsed: true }],
      tabs: [
        { ...base, url: "new", pinned: true },
        { ...base, url: "keep", active: true, groupRef: "n" },
      ],
    },
  ],
  bookmarks: [],
};
const all = (changes: ReturnType<typeof diff>) => new Set([...changes.tabs, ...changes.bookmarks].map((c) => c.id));

describe("apply tabs", () => {
  it("opens, closes, orders, groups and restores active and collapsed state", async () => {
    const changes = diff(local, target);
    expect(await apply(local, target, changes, all(changes))).toEqual([]);
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, url: "new", pinned: true, active: false });
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
    expect(api.tabs.move.mock.calls.map((c) => c[1].index)).toEqual([0, 1]);
    expect(api.tabs.group).toHaveBeenCalledWith({ createProperties: { windowId: 1 }, tabIds: [10] });
    expect(api.tabGroups.update).toHaveBeenCalledWith(9, { title: "New", color: "blue", collapsed: false });
    expect(api.tabGroups.update).toHaveBeenLastCalledWith(9, { collapsed: true });
    expect(api.tabs.update).toHaveBeenCalledWith(10, { active: true });
  });

  it("honours unchecked items", async () => {
    const changes = diff(local, target);
    await apply(local, target, changes, new Set());
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.tabs.remove).not.toHaveBeenCalled();
  });

  it("creates a window for an unpaired target window", async () => {
    const changes = diff({ windows: [], bookmarks: [] }, { windows: [{ groups: [], tabs: [{ ...base, url: "a" }, { ...base, url: "b" }] }], bookmarks: [] });
    await apply({ windows: [], bookmarks: [] }, { windows: [{ groups: [], tabs: [{ ...base, url: "a" }, { ...base, url: "b" }] }], bookmarks: [] }, changes, all(changes));
    expect(api.windows.create).toHaveBeenCalledWith({ url: "a", focused: false });
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 77, url: "b", pinned: false, active: false });
  });

  it("reports a refused URL and continues", async () => {
    api.tabs.create.mockRejectedValueOnce(new Error("refused"));
    const changes = diff(local, target);
    const failures = await apply(local, target, changes, all(changes));
    expect(failures).toEqual([{ url: "new", message: "Error: refused" }]);
    expect(api.tabs.remove).toHaveBeenCalledWith(11);
  });

  it("does not steal focus in the window showing the preview", async () => {
    api.tabs.getCurrent.mockResolvedValue({ windowId: 1 });
    const changes = diff(local, target);
    await apply(local, target, changes, all(changes));
    expect(api.tabs.update).not.toHaveBeenCalledWith(10, { active: true });
  });
});

describe("apply bookmarks", () => {
  const withBookmarks = (children: BrowserState["bookmarks"][number]["children"]): BrowserState => ({
    windows: [],
    bookmarks: [{ folderType: "bookmarks-bar", localId: "1", children }],
  });

  it("creates missing parent folders before bookmarks", async () => {
    const before = withBookmarks([]);
    const after = withBookmarks([{ kind: "folder", title: "F", children: [{ kind: "bookmark", title: "X", url: "x" }] }]);
    const changes = diff(before, after);
    await apply(before, after, changes, all(changes));
    expect(api.bookmarks.create.mock.calls.map((c) => c[0])).toEqual([
      { parentId: "1", title: "F" },
      { parentId: "new-F", title: "X", url: "x" },
    ]);
  });

  it("creates an unchecked parent when a child stays checked", async () => {
    const before = withBookmarks([]);
    const after = withBookmarks([{ kind: "folder", title: "F", children: [{ kind: "bookmark", title: "X", url: "x" }] }]);
    const changes = diff(before, after);
    await apply(before, after, changes, new Set(changes.bookmarks.filter((b) => b.url).map((b) => b.id)));
    expect(api.bookmarks.create).toHaveBeenCalledTimes(2);
  });

  it("removes bookmarks before folders and ignores folders that stay non-empty", async () => {
    const before = withBookmarks([{ kind: "folder", title: "F", localId: "f", children: [{ kind: "bookmark", title: "X", url: "x", localId: "b" }] }]);
    const after = withBookmarks([]);
    api.bookmarks.remove.mockImplementation(async (id) => {
      if (id === "f") throw new Error("not empty");
    });
    const changes = diff(before, after);
    expect(await apply(before, after, changes, all(changes))).toEqual([]);
    expect(api.bookmarks.remove.mock.calls.map((c) => c[0])).toEqual(["b", "f"]);
  });

  it("aligns order and titles of existing bookmarks", async () => {
    const after = withBookmarks([
      { kind: "bookmark", title: "B2", url: "b" },
      { kind: "bookmark", title: "A", url: "a" },
    ]);
    const before = withBookmarks([
      { kind: "bookmark", title: "A", url: "a", localId: "a1" },
      { kind: "bookmark", title: "B", url: "b", localId: "b1" },
    ]);
    api.bookmarks.getTree.mockResolvedValue([
      {
        children: [
          {
            id: "1",
            folderType: "bookmarks-bar",
            children: [
              { id: "a1", title: "A", url: "a" },
              { id: "b1", title: "B", url: "b" },
            ],
          },
        ],
      },
    ]);
    const changes = diff(before, after);
    await apply(before, after, changes, all(changes));
    expect(api.bookmarks.move).toHaveBeenCalledWith("b1", { parentId: "1", index: 0 });
    expect(api.bookmarks.update).toHaveBeenCalledWith("b1", { title: "B2" });
  });
});
```

Run: `pnpm test tests/apply.test.ts`
Expected: FAIL, cannot resolve `../src/shared/apply`.

- [ ] **Step 2: Implement**

`src/shared/apply.ts`:

```ts
import { flattenBookmarks, type BookmarkChange, type ChangeSet, type TabChange } from "./diff";
import type { BookmarkNode, BrowserState, BrowserWindow, FolderType } from "./types";

export type ApplyFailure = { url: string; message: string };

type Failures = ApplyFailure[];

async function attempt<T>(failures: Failures, url: string, action: () => Promise<T>): Promise<T | undefined> {
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
  if (windowId === undefined) {
    const first = queue.shift();
    if (!first) return undefined;
    const created = await attempt(failures, first.url, () => chrome.windows.create({ url: first.url, focused: false }));
    if (!created?.id) return undefined;
    windowId = created.id;
    const firstTab = created.tabs?.[0]?.id;
    if (firstTab !== undefined) placed.set(first.targetTab!, firstTab);
  }
  for (const open of queue) {
    const created = await attempt(failures, open.url, () =>
      chrome.tabs.create({ windowId, url: open.url, pinned: target.tabs[open.targetTab!]!.pinned, active: false }),
    );
    if (created?.id !== undefined) placed.set(open.targetTab!, created.id);
  }
  return windowId;
}

async function applyWindow(
  windowIndex: number,
  local: BrowserState,
  target: BrowserWindow,
  changes: ChangeSet,
  selected: ReadonlySet<string>,
  currentWindowId: number | undefined,
  failures: Failures,
): Promise<void> {
  const pair = changes.windowPairs[windowIndex]!;
  const localWindow = pair >= 0 ? local.windows[pair] : undefined;
  const matches = changes.matches.filter((m) => m.targetWindow === windowIndex);
  const placed = new Map(matches.map((m) => [m.targetTab, m.localId]));
  const opens = changes.tabs.filter((c) => c.kind === "open" && c.windowIndex === windowIndex && selected.has(c.id));
  const windowId = await ensureTabs(target, localWindow?.localId, opens, placed, failures);
  if (windowId === undefined) return;

  const ordered = [...placed.entries()].sort(([a], [b]) => a - b);
  const localTabs = new Map((localWindow?.tabs ?? []).map((t) => [t.localId!, t]));

  for (const match of matches) {
    const wanted = target.tabs[match.targetTab]!;
    const existing = localTabs.get(match.localId);
    if (existing && existing.pinned !== wanted.pinned) {
      await attempt(failures, wanted.url, () => chrome.tabs.update(match.localId, { pinned: wanted.pinned }));
    }
  }

  for (const [index, [targetTab, tabId]] of ordered.entries()) {
    await attempt(failures, target.tabs[targetTab]!.url, () => chrome.tabs.move(tabId, { windowId, index }));
  }

  for (const [targetTab, tabId] of ordered) {
    const wanted = target.tabs[targetTab]!;
    if (!wanted.groupRef && localTabs.get(tabId)?.groupRef) {
      await attempt(failures, wanted.url, () => chrome.tabs.ungroup(tabId));
    }
  }

  const collapsedGroups: number[] = [];
  for (const group of target.groups) {
    const tabIds = ordered.filter(([t]) => target.tabs[t]!.groupRef === group.ref).map(([, id]) => id);
    if (tabIds.length === 0) continue;
    const existing = localWindow?.groups.find((g) => g.title === group.title);
    const groupId = await attempt(failures, group.title, () =>
      chrome.tabs.group(
        existing
          ? { groupId: existing.localId!, tabIds: tabIds as [number, ...number[]] }
          : { createProperties: { windowId }, tabIds: tabIds as [number, ...number[]] },
      ),
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

  const active = ordered.find(([t]) => target.tabs[t]!.active);
  if (active && windowId !== currentWindowId) {
    await attempt(failures, target.tabs[active[0]]!.url, () => chrome.tabs.update(active[1], { active: true }));
  }
  for (const groupId of collapsedGroups) {
    await attempt(failures, "", () => chrome.tabGroups.update(groupId, { collapsed: true }));
  }
}

const folderKey = (folderType: FolderType, path: string[]) => [folderType, ...path].join("\0");

async function applyBookmarkChanges(local: BrowserState, selected: BookmarkChange[], failures: Failures): Promise<void> {
  for (const change of selected) {
    if (change.kind === "remove" && change.url !== undefined) {
      await attempt(failures, change.url, () => chrome.bookmarks.remove(change.localId!));
    }
  }
  const folderRemovals = selected
    .filter((c) => c.kind === "remove" && c.url === undefined)
    .sort((a, b) => b.path.length - a.path.length);
  for (const folder of folderRemovals) {
    await chrome.bookmarks.remove(folder.localId!).catch(() => undefined);
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
    const index = current.findIndex((c) => !claimed.has(c.id) && (node.kind === "bookmark" ? c.url === node.url : !c.url && c.title === node.title));
    if (index < 0) continue;
    const child = current[index]!;
    claimed.add(child.id);
    if (index !== position) {
      await attempt(failures, child.url ?? child.title, () => chrome.bookmarks.move(child.id, { parentId, index: position }));
      current.splice(index, 1);
      current.splice(position, 0, child);
    }
    position++;
    if (node.kind === "bookmark" && child.title !== node.title) {
      await attempt(failures, node.url, () => chrome.bookmarks.update(child.id, { title: node.title }));
    }
    if (node.kind === "folder") await alignChildren(child.id, node.children, child.children ?? [], failures);
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

  for (const [windowIndex, window] of target.windows.entries()) {
    await applyWindow(windowIndex, local, window, changes, selected, current?.windowId, failures);
  }
  for (const change of changes.tabs) {
    if (change.kind === "close" && selected.has(change.id)) {
      await attempt(failures, change.url, () => chrome.tabs.remove(change.localId!));
    }
  }

  await applyBookmarkChanges(local, changes.bookmarks.filter((c) => selected.has(c.id)), failures);
  await alignBookmarks(target, failures);
  return failures;
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/apply.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/apply.ts tests/apply.test.ts
git commit -m "feat: apply selected changes to the browser"
```

---

### Task 7: Local storage and sync flows

**Files:**
- Create: `src/shared/idb.ts`, `src/shared/settings.ts`, `src/shared/sync.ts`
- Test: `tests/idb.test.ts`, `tests/sync.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `saveKey(key: CryptoKey): Promise<void>`, `loadKey(): Promise<CryptoKey | undefined>`
  - `type Backup = { id: number; savedAt: string; snapshot: Snapshot }`
  - `saveBackup(snapshot): Promise<void>`, `listBackups(): Promise<Backup[]>` (newest first, max 5)
  - `type Settings = { owner: string; repo: string; token: string; deviceName: string; profileId: string; profileName: string; lastSeenSha?: string }`
  - `loadSettings(): Promise<Partial<Settings>>`, `saveSettings(patch: Partial<Settings>): Promise<void>`, `clearLastSeenSha(): Promise<void>`
  - `type SyncContext = { remote: Remote; settings: Settings }`
  - `loadContext(): Promise<SyncContext | null>`
  - `type SendResult = { status: "sent" } | { status: "newer"; deviceName: string; sentAt: string }`
  - `send(context, force?): Promise<SendResult>`
  - `type PullPlan = { local: BrowserState; snapshot: Snapshot; sha: string; changes: ChangeSet } `
  - `loadPull(context): Promise<PullPlan | null>`
  - `runPull(context, plan, selected): Promise<ApplyFailure[]>`
  - `restoreBackup(backup): Promise<ApplyFailure[]>`

- [ ] **Step 1: Write the failing storage test**

`tests/idb.test.ts`:

```ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { listBackups, saveBackup } from "../src/shared/idb";
import type { Snapshot } from "../src/shared/types";

const snapshot = (deviceName: string): Snapshot => ({ formatVersion: 1, sentAt: "t", deviceName, windows: [], bookmarks: [] });

describe("backups", () => {
  it("keeps the 5 most recent, newest first", async () => {
    for (let i = 1; i <= 7; i++) await saveBackup(snapshot(`d${i}`));
    const backups = await listBackups();
    expect(backups.map((b) => b.snapshot.deviceName)).toEqual(["d7", "d6", "d5", "d4", "d3"]);
  });
});
```

Run: `pnpm test tests/idb.test.ts`
Expected: FAIL, cannot resolve `../src/shared/idb`.

- [ ] **Step 2: Implement storage**

`src/shared/idb.ts`:

```ts
import type { Snapshot } from "./types";

const KEY_STORE = "keys";
const BACKUP_STORE = "backups";
const KEY_ID = "sync";
const MAX_BACKUPS = 5;

export type Backup = { id: number; savedAt: string; snapshot: Snapshot };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("browser-tabs-sync", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEY_STORE);
      request.result.createObjectStore(BACKUP_STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      }),
  );
}

export async function saveKey(key: CryptoKey): Promise<void> {
  await run(KEY_STORE, "readwrite", (s) => s.put(key, KEY_ID));
}

export function loadKey(): Promise<CryptoKey | undefined> {
  return run<CryptoKey | undefined>(KEY_STORE, "readonly", (s) => s.get(KEY_ID));
}

export async function listBackups(): Promise<Backup[]> {
  const all = await run<Backup[]>(BACKUP_STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export async function saveBackup(snapshot: Snapshot): Promise<void> {
  await run(BACKUP_STORE, "readwrite", (s) => s.add({ savedAt: new Date().toISOString(), snapshot }));
  const stale = (await listBackups()).slice(MAX_BACKUPS);
  for (const backup of stale) await run(BACKUP_STORE, "readwrite", (s) => s.delete(backup.id));
}
```

`src/shared/settings.ts`:

```ts
export type Settings = {
  owner: string;
  repo: string;
  token: string;
  deviceName: string;
  profileId: string;
  profileName: string;
  lastSeenSha?: string;
};

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<Partial<Settings>> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] ?? {}) as Partial<Settings>;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...(await loadSettings()), ...patch } });
}

export async function clearLastSeenSha(): Promise<void> {
  const { lastSeenSha: _removed, ...rest } = await loadSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: rest });
}
```

Run: `pnpm test tests/idb.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing flow test**

`tests/sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubError } from "../src/shared/github";
import type { Snapshot } from "../src/shared/types";

const mocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  writeSnapshot: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  saveBackup: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../src/shared/remote", () => ({ readSnapshot: mocks.readSnapshot, writeSnapshot: mocks.writeSnapshot }));
vi.mock("../src/shared/snapshot", () => ({
  capture: mocks.capture,
  toSnapshot: (state: object, deviceName: string, sentAt: string) => ({ ...state, deviceName, sentAt, formatVersion: 1 }),
}));
vi.mock("../src/shared/apply", () => ({ apply: mocks.apply }));
vi.mock("../src/shared/idb", () => ({ saveBackup: mocks.saveBackup, loadKey: vi.fn() }));
vi.mock("../src/shared/settings", () => ({ saveSettings: mocks.saveSettings, loadSettings: vi.fn() }));

const { loadPull, runPull, send } = await import("../src/shared/sync");

const remoteSnapshot: Snapshot = { formatVersion: 1, sentAt: "t1", deviceName: "Laptop", windows: [], bookmarks: [] };
const context = (lastSeenSha?: string) => ({
  remote: {} as never,
  settings: { profileId: "p", deviceName: "Desktop", lastSeenSha } as never,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.capture.mockResolvedValue({ windows: [], bookmarks: [] });
  mocks.writeSnapshot.mockResolvedValue("new-sha");
});

describe("send", () => {
  it("writes when the remote is empty", async () => {
    mocks.readSnapshot.mockResolvedValue(null);
    expect(await send(context())).toEqual({ status: "sent" });
    expect(mocks.saveSettings).toHaveBeenCalledWith({ lastSeenSha: "new-sha" });
  });

  it("writes when the remote matches the last seen version", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s1" });
    expect(await send(context("s1"))).toEqual({ status: "sent" });
    expect(mocks.writeSnapshot.mock.calls[0]![3]).toBe("s1");
  });

  it("warns about a newer remote and writes nothing", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s2" });
    expect(await send(context("s1"))).toEqual({ status: "newer", deviceName: "Laptop", sentAt: "t1" });
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("overwrites a newer remote when forced", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s2" });
    expect(await send(context("s1"), true)).toEqual({ status: "sent" });
    expect(mocks.writeSnapshot.mock.calls[0]![3]).toBe("s2");
  });

  it("turns a concurrent write into a newer warning", async () => {
    mocks.readSnapshot
      .mockResolvedValueOnce({ snapshot: remoteSnapshot, sha: "s1" })
      .mockResolvedValueOnce({ snapshot: { ...remoteSnapshot, deviceName: "Other" }, sha: "s3" });
    mocks.writeSnapshot.mockRejectedValue(new GitHubError("conflict"));
    expect(await send(context("s1"))).toEqual({ status: "newer", deviceName: "Other", sentAt: "t1" });
  });
});

describe("pull", () => {
  it("returns null when nothing was sent", async () => {
    mocks.readSnapshot.mockResolvedValue(null);
    expect(await loadPull(context())).toBeNull();
  });

  it("backs up before applying and records the pulled version", async () => {
    const order: string[] = [];
    mocks.saveBackup.mockImplementation(async () => order.push("backup"));
    mocks.apply.mockImplementation(async () => {
      order.push("apply");
      return [];
    });
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s9" });
    const plan = await loadPull(context());
    await runPull(context(), plan!, new Set());
    expect(order).toEqual(["backup", "apply"]);
    expect(mocks.saveSettings).toHaveBeenCalledWith({ lastSeenSha: "s9" });
  });

  it("does not record the version or apply when the backup fails", async () => {
    mocks.saveBackup.mockRejectedValue(new Error("disk"));
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s9" });
    const plan = await loadPull(context());
    await expect(runPull(context(), plan!, new Set())).rejects.toThrow("disk");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm test tests/sync.test.ts`
Expected: FAIL, cannot resolve `../src/shared/sync`.

- [ ] **Step 4: Implement flows**

`src/shared/sync.ts`:

```ts
import { apply, type ApplyFailure } from "./apply";
import { diff, type ChangeSet } from "./diff";
import { GitHubError } from "./github";
import { loadKey, saveBackup, type Backup } from "./idb";
import { readSnapshot, writeSnapshot, type Remote } from "./remote";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { capture, toSnapshot } from "./snapshot";
import type { BrowserState, Snapshot } from "./types";

export type SyncContext = { remote: Remote; settings: Settings };
export type SendResult = { status: "sent" } | { status: "newer"; deviceName: string; sentAt: string };
export type PullPlan = { local: BrowserState; snapshot: Snapshot; sha: string; changes: ChangeSet };

export async function loadContext(): Promise<SyncContext | null> {
  const [settings, key] = await Promise.all([loadSettings(), loadKey()]);
  if (!key || !settings.owner || !settings.repo || !settings.token || !settings.profileId || !settings.deviceName) {
    return null;
  }
  const complete = settings as Settings;
  return { remote: { key, config: { owner: complete.owner, repo: complete.repo, token: complete.token } }, settings: complete };
}

const newer = (snapshot: Snapshot): SendResult => ({
  status: "newer",
  deviceName: snapshot.deviceName,
  sentAt: snapshot.sentAt,
});

export async function send(context: SyncContext, force = false): Promise<SendResult> {
  const { remote, settings } = context;
  const existing = await readSnapshot(remote, settings.profileId);
  if (existing && existing.sha !== settings.lastSeenSha && !force) return newer(existing.snapshot);
  const snapshot = toSnapshot(await capture(), settings.deviceName, new Date().toISOString());
  try {
    const sha = await writeSnapshot(remote, settings.profileId, snapshot, existing?.sha);
    await saveSettings({ lastSeenSha: sha });
    return { status: "sent" };
  } catch (error) {
    if (!(error instanceof GitHubError) || error.kind !== "conflict") throw error;
    const latest = await readSnapshot(remote, settings.profileId);
    if (!latest) throw error;
    return newer(latest.snapshot);
  }
}

export async function loadPull(context: SyncContext): Promise<PullPlan | null> {
  const remote = await readSnapshot(context.remote, context.settings.profileId);
  if (!remote) return null;
  const local = await capture();
  return { local, snapshot: remote.snapshot, sha: remote.sha, changes: diff(local, remote.snapshot) };
}

export async function runPull(
  context: SyncContext,
  plan: PullPlan,
  selected: ReadonlySet<string>,
): Promise<ApplyFailure[]> {
  await saveBackup(toSnapshot(plan.local, context.settings.deviceName, new Date().toISOString()));
  const failures = await apply(plan.local, plan.snapshot, plan.changes, selected);
  await saveSettings({ lastSeenSha: plan.sha });
  return failures;
}

export async function restoreBackup(backup: Backup): Promise<ApplyFailure[]> {
  const local = await capture();
  const changes = diff(local, backup.snapshot);
  const everything = new Set([...changes.tabs, ...changes.bookmarks].map((change) => change.id));
  return apply(local, backup.snapshot, changes, everything);
}
```

- [ ] **Step 5: Verify**

Run: `pnpm test tests/idb.test.ts tests/sync.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared tests/idb.test.ts tests/sync.test.ts
git commit -m "feat: add send and pull flows with local backups"
```

---

### Task 8: Popup and options

**Files:**
- Create: `src/ui/shared/errors.ts`, `src/ui/popup/App.tsx`, `src/ui/options/App.tsx`
- Modify: `src/popup/index.tsx`, `src/options/index.tsx`
- Test: `tests/ui.popup.test.tsx`, `tests/ui.options.test.tsx`

**Interfaces:**
- Consumes: `loadContext`, `send`, `SendResult`, `checkRepo`, `listProfiles`, `createProfile`, `generateKeyText`, `importKeyText`, `saveKey`, `loadSettings`, `saveSettings`, `clearLastSeenSha`, `listBackups`, `restoreBackup`.
- Produces: `errorMessage(error: unknown): string`, components `PopupApp`, `OptionsApp`.

- [ ] **Step 1: Write the failing tests**

`tests/ui.popup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadContext: vi.fn(), send: vi.fn() }));
vi.mock("../src/shared/sync", () => mocks);

import { PopupApp } from "../src/ui/popup/App";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadContext.mockResolvedValue({ settings: { profileName: "Praca" } });
  vi.stubGlobal("chrome", { tabs: { create: vi.fn() }, runtime: { getURL: (p: string) => p, openOptionsPage: vi.fn() } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PopupApp", () => {
  it("prompts for setup when not configured", async () => {
    mocks.loadContext.mockResolvedValue(null);
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Skonfiguruj" }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("shows the sync profile and reports a successful send", async () => {
    mocks.send.mockResolvedValue({ status: "sent" });
    render(<PopupApp />);
    expect(await screen.findByText(/Praca/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));
    expect(await screen.findByText("Wysłano.")).toBeTruthy();
  });

  it("warns about newer data and can overwrite", async () => {
    mocks.send.mockResolvedValueOnce({ status: "newer", deviceName: "Laptop", sentAt: "2026-11-08T10:00:00Z" });
    mocks.send.mockResolvedValueOnce({ status: "sent" });
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Wyślij" }));
    expect(await screen.findByText(/Laptop/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nadpisz mimo to" }));
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith(expect.anything(), true));
  });

  it("opens the preview page from the warning and from Pull", async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Pobierz" }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "preview/index.html" });
  });
});
```

`tests/ui.options.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecryptError, generateKeyText } from "../src/shared/crypto";

const mocks = vi.hoisted(() => ({
  checkRepo: vi.fn(),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  saveKey: vi.fn(),
  listBackups: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearLastSeenSha: vi.fn(),
  restoreBackup: vi.fn(),
}));
vi.mock("../src/shared/github", async (original) => ({ ...(await original<object>()), checkRepo: mocks.checkRepo }));
vi.mock("../src/shared/remote", () => ({ listProfiles: mocks.listProfiles, createProfile: mocks.createProfile }));
vi.mock("../src/shared/idb", () => ({ saveKey: mocks.saveKey, listBackups: mocks.listBackups }));
vi.mock("../src/shared/settings", () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
  clearLastSeenSha: mocks.clearLastSeenSha,
}));
vi.mock("../src/shared/sync", () => ({ restoreBackup: mocks.restoreBackup }));

import { OptionsApp } from "../src/ui/options/App";

const fill = (label: string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function fillForm(key = generateKeyText()) {
  await screen.findByLabelText("Repozytorium (owner/nazwa)");
  fill("Repozytorium (owner/nazwa)", "o/r");
  fill("Token GitHub", "t");
  fill("Klucz szyfrowania", key);
  fill("Nazwa urządzenia", "Laptop");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadSettings.mockResolvedValue({});
  mocks.listBackups.mockResolvedValue([]);
  mocks.listProfiles.mockResolvedValue([{ id: "p1", name: "Praca" }]);
});
afterEach(cleanup);

describe("OptionsApp", () => {
  it("generates a key into the field", async () => {
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Wygeneruj klucz" }));
    expect((screen.getByLabelText("Klucz szyfrowania") as HTMLInputElement).value).toHaveLength(43);
  });

  it("connects, lists profiles and stores the selection", async () => {
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Praca" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p1", profileName: "Praca" }),
    );
    expect(mocks.saveKey).toHaveBeenCalled();
    expect(mocks.clearLastSeenSha).toHaveBeenCalled();
  });

  it("creates a new profile", async () => {
    mocks.createProfile.mockResolvedValue({ id: "p2", name: "Dom" });
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    await screen.findByLabelText("Nowy profil synchronizacji");
    fill("Nowy profil synchronizacji", "Dom");
    fireEvent.click(screen.getByRole("button", { name: "Utwórz" }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p2", profileName: "Dom" }));
  });

  it("shows a wrong key error and does not save the key", async () => {
    mocks.listProfiles.mockRejectedValue(new DecryptError("nope"));
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    expect(await screen.findByText(/klucz/i, { selector: ".error" })).toBeTruthy();
    expect(mocks.saveKey).not.toHaveBeenCalled();
  });

  it("restores a backup", async () => {
    const backup = { id: 1, savedAt: "2026-11-08T10:00:00Z", snapshot: {} };
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.restoreBackup.mockResolvedValue([]);
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Przywróć/ }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
  });
});
```

Run: `pnpm test tests/ui.popup.test.tsx tests/ui.options.test.tsx`
Expected: FAIL, cannot resolve the App modules.

- [ ] **Step 2: Implement**

`src/ui/shared/errors.ts`:

```ts
import { DecryptError } from "../../shared/crypto";
import { GitHubError, type GitHubErrorKind } from "../../shared/github";
import { InvalidSnapshotError } from "../../shared/snapshot";

const GITHUB_MESSAGES: Record<GitHubErrorKind, string> = {
  auth: "Token GitHub jest nieprawidłowy lub wygasł. Sprawdź konfigurację.",
  "not-found": "Nie znaleziono repozytorium. Sprawdź konfigurację i uprawnienia tokenu.",
  conflict: "Dane w repozytorium właśnie się zmieniły. Spróbuj ponownie.",
  "rate-limit": "Przekroczono limit GitHub. Spróbuj ponownie później.",
  network: "Brak połączenia z GitHubem.",
  unknown: "GitHub zwrócił nieoczekiwany błąd.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof GitHubError) return GITHUB_MESSAGES[error.kind];
  if (error instanceof DecryptError) return "Nie udało się odszyfrować danych. Sprawdź klucz szyfrowania.";
  if (error instanceof InvalidSnapshotError) return "Dane w repozytorium są nieprawidłowe.";
  return `Wystąpił błąd: ${String(error)}`;
}
```

`src/ui/popup/App.tsx`:

```tsx
import { useEffect, useState } from "preact/hooks";
import { loadContext, send, type SendResult, type SyncContext } from "../../shared/sync";
import { errorMessage } from "../shared/errors";

const openPreview = () => chrome.tabs.create({ url: chrome.runtime.getURL("preview/index.html") });

export function PopupApp() {
  const [context, setContext] = useState<SyncContext | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [warning, setWarning] = useState<Extract<SendResult, { status: "newer" }> | null>(null);

  useEffect(() => {
    loadContext().then(setContext, (error) => {
      setContext(null);
      setIsError(true);
      setMessage(errorMessage(error));
    });
  }, []);

  async function runSend(force: boolean) {
    if (!context) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    setWarning(null);
    try {
      const result = await send(context, force);
      if (result.status === "sent") setMessage("Wysłano.");
      else setWarning(result);
    } catch (error) {
      setIsError(true);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (context === undefined) return <p>Ładowanie…</p>;
  if (context === null) {
    return (
      <main>
        {message && <p class="error">{message}</p>}
        <p>Rozszerzenie nie jest skonfigurowane.</p>
        <button onClick={() => chrome.runtime.openOptionsPage()}>Skonfiguruj</button>
      </main>
    );
  }

  return (
    <main>
      <p>
        Profil synchronizacji: <strong>{context.settings.profileName}</strong>
      </p>
      <button disabled={busy} onClick={() => runSend(false)}>
        Wyślij
      </button>{" "}
      <button disabled={busy} onClick={openPreview}>
        Pobierz
      </button>
      {warning && (
        <section>
          <p>
            {warning.deviceName} wysłał zmiany {new Date(warning.sentAt).toLocaleString("pl-PL")}, których tu nie masz.
          </p>
          <button onClick={openPreview}>Najpierw pobierz</button>{" "}
          <button onClick={() => runSend(true)}>Nadpisz mimo to</button>{" "}
          <button onClick={() => setWarning(null)}>Anuluj</button>
        </section>
      )}
      {message && <p class={isError ? "error" : ""}>{message}</p>}
    </main>
  );
}
```

`src/popup/index.tsx`:

```tsx
import { render } from "preact";
import { PopupApp } from "../ui/popup/App";

render(<PopupApp />, document.getElementById("app")!);
```

`src/ui/options/App.tsx`:

```tsx
import { useEffect, useState } from "preact/hooks";
import { generateKeyText, importKeyText } from "../../shared/crypto";
import { checkRepo } from "../../shared/github";
import { listBackups, saveKey, type Backup } from "../../shared/idb";
import { createProfile, listProfiles, type Remote, type SyncProfile } from "../../shared/remote";
import { clearLastSeenSha, loadSettings, saveSettings } from "../../shared/settings";
import { restoreBackup } from "../../shared/sync";
import { errorMessage } from "../shared/errors";

export function OptionsApp() {
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [keyText, setKeyText] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [profiles, setProfiles] = useState<SyncProfile[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [currentProfile, setCurrentProfile] = useState("");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([loadSettings(), listBackups()]).then(([settings, stored]) => {
      if (settings.owner && settings.repo) setRepository(`${settings.owner}/${settings.repo}`);
      setToken(settings.token ?? "");
      setDeviceName(settings.deviceName ?? "");
      setCurrentProfile(settings.profileName ?? "");
      setBackups(stored);
      setReady(true);
    });
  }, []);

  function report(error: unknown) {
    setIsError(true);
    setMessage(errorMessage(error));
  }

  async function connect(event: Event) {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    const [owner, repo] = repository.trim().split("/");
    if (!owner || !repo) {
      setIsError(true);
      setMessage("Podaj repozytorium w formacie owner/nazwa.");
      return;
    }
    try {
      const key = await importKeyText(keyText);
      const config = { owner, repo, token: token.trim() };
      await checkRepo(config);
      const candidate = { config, key };
      const found = await listProfiles(candidate);
      await saveKey(key);
      await saveSettings({ owner, repo, token: config.token, deviceName: deviceName.trim() });
      setRemote(candidate);
      setProfiles(found);
    } catch (error) {
      report(error);
    }
  }

  async function select(profile: SyncProfile) {
    await saveSettings({ profileId: profile.id, profileName: profile.name });
    await clearLastSeenSha();
    setCurrentProfile(profile.name);
    setIsError(false);
    setMessage(`Wybrano profil: ${profile.name}.`);
  }

  async function create() {
    if (!remote || !newProfile.trim()) return;
    try {
      const profile = await createProfile(remote, newProfile.trim());
      setProfiles([...profiles, profile]);
      setNewProfile("");
      await select(profile);
    } catch (error) {
      report(error);
    }
  }

  async function restore(backup: Backup) {
    try {
      const failures = await restoreBackup(backup);
      setIsError(failures.length > 0);
      setMessage(failures.length ? `Nie przywrócono: ${failures.map((f) => f.url).join(", ")}` : "Przywrócono kopię.");
    } catch (error) {
      report(error);
    }
  }

  if (!ready) return <p>Ładowanie…</p>;

  return (
    <main>
      <h1>Konfiguracja</h1>
      <form onSubmit={connect}>
        <label>
          Repozytorium (owner/nazwa)
          <input value={repository} onInput={(e) => setRepository(e.currentTarget.value)} />
        </label>
        <label>
          Token GitHub
          <input type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
        </label>
        <label>
          Klucz szyfrowania
          <input value={keyText} onInput={(e) => setKeyText(e.currentTarget.value)} />
        </label>
        <button type="button" onClick={() => setKeyText(generateKeyText())}>
          Wygeneruj klucz
        </button>
        <p>Klucz zapisz w menedżerze haseł. Utrata klucza oznacza utratę danych.</p>
        <label>
          Nazwa urządzenia
          <input value={deviceName} onInput={(e) => setDeviceName(e.currentTarget.value)} />
        </label>
        <button type="submit">Połącz</button>
      </form>

      {remote && (
        <section>
          <h2>Profil synchronizacji</h2>
          {currentProfile && <p>Obecny: {currentProfile}</p>}
          {profiles.map((profile) => (
            <button key={profile.id} onClick={() => select(profile)}>
              {profile.name}
            </button>
          ))}
          <label>
            Nowy profil synchronizacji
            <input value={newProfile} onInput={(e) => setNewProfile(e.currentTarget.value)} />
          </label>
          <button onClick={create}>Utwórz</button>
        </section>
      )}

      {backups.length > 0 && (
        <section>
          <h2>Kopie lokalne</h2>
          {backups.map((backup) => (
            <button key={backup.id} onClick={() => restore(backup)}>
              Przywróć {new Date(backup.savedAt).toLocaleString("pl-PL")}
            </button>
          ))}
        </section>
      )}

      {message && <p class={isError ? "error" : ""}>{message}</p>}
    </main>
  );
}
```

`src/options/index.tsx`:

```tsx
import { render } from "preact";
import { OptionsApp } from "../ui/options/App";

render(<OptionsApp />, document.getElementById("app")!);
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/ui.popup.test.tsx tests/ui.options.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src tests/ui.popup.test.tsx tests/ui.options.test.tsx
git commit -m "feat: add popup and setup screens"
```

---

### Task 9: Preview page

**Files:**
- Create: `src/ui/preview/App.tsx`
- Modify: `src/preview/index.tsx`
- Test: `tests/ui.preview.test.tsx`

**Interfaces:**
- Consumes: `loadContext`, `loadPull`, `runPull`, `restoreBackup`, `PullPlan`, `listBackups`, `TabChange`, `BookmarkChange`, `errorMessage`.
- Produces: component `PreviewApp`.

- [ ] **Step 1: Write the failing test**

`tests/ui.preview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  loadPull: vi.fn(),
  runPull: vi.fn(),
  restoreBackup: vi.fn(),
  listBackups: vi.fn(),
}));
vi.mock("../src/shared/sync", () => ({
  loadContext: mocks.loadContext,
  loadPull: mocks.loadPull,
  runPull: mocks.runPull,
  restoreBackup: mocks.restoreBackup,
}));
vi.mock("../src/shared/idb", () => ({ listBackups: mocks.listBackups }));

import { PreviewApp } from "../src/ui/preview/App";

const plan = {
  sha: "s",
  local: { windows: [], bookmarks: [] },
  snapshot: { deviceName: "Laptop", sentAt: "2026-11-08T10:00:00Z", windows: [], bookmarks: [] },
  changes: {
    windowPairs: [0],
    matches: [],
    tabs: [
      { id: "open:0:0", kind: "open", url: "https://a.test/", title: "A", windowIndex: 0, groupTitle: "Praca", targetTab: 0 },
      { id: "open:0:1", kind: "open", url: "https://b.test/", title: "B", windowIndex: 0, groupTitle: "Praca", targetTab: 1 },
      { id: "close:5", kind: "close", url: "https://c.test/", title: "C", windowIndex: 0, localId: 5 },
    ],
    bookmarks: [{ id: "add:0", kind: "add", folderType: "other", path: ["F"], title: "X", url: "https://x.test/" }],
  },
};

const checkbox = (name: string | RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const context = { settings: {}, remote: {} };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadContext.mockResolvedValue(context);
  mocks.loadPull.mockResolvedValue(plan);
  mocks.runPull.mockResolvedValue([]);
});
afterEach(cleanup);

describe("PreviewApp", () => {
  it("lists all changes checked, with their sections", async () => {
    render(<PreviewApp />);
    expect(await screen.findByRole("heading", { name: /Karty do otwarcia/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Karty do zamknięcia/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ulubione/ })).toBeTruthy();
    expect(checkbox("A https://a.test/").checked).toBe(true);
    expect(screen.getByText(/Laptop/)).toBeTruthy();
  });

  it("applies only checked items", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "C https://c.test/" }));
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    await waitFor(() => expect(mocks.runPull).toHaveBeenCalled());
    expect([...mocks.runPull.mock.calls[0]![2]].sort()).toEqual(["add:0", "open:0:0", "open:0:1"]);
    expect(await screen.findByText("Gotowe.")).toBeTruthy();
  });

  it("toggles a whole group with one checkbox", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Grupa: Praca (otwarcie)" }));
    expect(checkbox("A https://a.test/").checked).toBe(false);
    expect(checkbox("B https://b.test/").checked).toBe(false);
    expect(checkbox("C https://c.test/").checked).toBe(true);
  });

  it("offers restore after a failure", async () => {
    const backup = { id: 1 };
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.restoreBackup.mockResolvedValue([]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Zastosuj" }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
    expect(screen.getByText(/https:\/\/a\.test\//)).toBeTruthy();
  });

  it("reports when there is nothing to pull", async () => {
    mocks.loadPull.mockResolvedValue(null);
    render(<PreviewApp />);
    expect(await screen.findByText(/Brak danych/)).toBeTruthy();
  });

  it("shows when already in sync", async () => {
    mocks.loadPull.mockResolvedValue({ ...plan, changes: { ...plan.changes, tabs: [], bookmarks: [] } });
    render(<PreviewApp />);
    expect(await screen.findByText(/Brak zmian/)).toBeTruthy();
  });
});
```

Run: `pnpm test tests/ui.preview.test.tsx`
Expected: FAIL, cannot resolve `../src/ui/preview/App`.

- [ ] **Step 2: Implement**

`src/ui/preview/App.tsx`:

```tsx
import { useSignal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import type { ApplyFailure } from "../../shared/apply";
import type { BookmarkChange, TabChange } from "../../shared/diff";
import { listBackups } from "../../shared/idb";
import { loadContext, loadPull, restoreBackup, runPull, type PullPlan, type SyncContext } from "../../shared/sync";
import { errorMessage } from "../shared/errors";

type Phase = "loading" | "empty" | "ready" | "applying" | "done";

export function PreviewApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [context, setContext] = useState<SyncContext | null>(null);
  const [plan, setPlan] = useState<PullPlan | null>(null);
  const [failures, setFailures] = useState<ApplyFailure[]>([]);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const selected = useSignal<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await loadContext();
        if (!loaded) throw new Error("Rozszerzenie nie jest skonfigurowane.");
        setContext(loaded);
        const pulled = await loadPull(loaded);
        if (!pulled) {
          setPhase("empty");
          return;
        }
        setPlan(pulled);
        selected.value = new Set([...pulled.changes.tabs, ...pulled.changes.bookmarks].map((c) => c.id));
        setPhase("ready");
      } catch (caught) {
        setError(errorMessage(caught));
        setPhase("empty");
      }
    })();
  }, []);

  function setChecked(ids: string[], checked: boolean) {
    const next = new Set(selected.value);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selected.value = next;
  }

  async function confirm() {
    if (!context || !plan) return;
    setPhase("applying");
    setError("");
    try {
      setFailures(await runPull(context, plan, selected.value));
      setPhase("done");
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("ready");
    }
  }

  async function restore() {
    const [latest] = await listBackups();
    if (!latest) return;
    try {
      await restoreBackup(latest);
      setRestored(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (phase === "loading") return <p>Ładowanie…</p>;
  if (phase === "empty") return error ? <p class="error">{error}</p> : <p>Brak danych do pobrania w tym profilu.</p>;
  if (!plan) return null;

  if (phase === "done") {
    return (
      <main>
        {failures.length === 0 ? (
          <p>Gotowe.</p>
        ) : (
          <section>
            <p>Część zmian pominięto:</p>
            <ul>
              {failures.map((failure, index) => (
                <li key={index}>
                  {failure.url}: {failure.message}
                </li>
              ))}
            </ul>
            <button onClick={restore}>Przywróć kopię</button>
            {restored && <p>Przywrócono kopię.</p>}
          </section>
        )}
        {error && <p class="error">{error}</p>}
      </main>
    );
  }

  const { tabs, bookmarks } = plan.changes;
  const opens = tabs.filter((t) => t.kind === "open");
  const closes = tabs.filter((t) => t.kind === "close");
  const isChecked = (id: string) => selected.value.has(id);

  if (tabs.length === 0 && bookmarks.length === 0) {
    return (
      <main>
        <p>Brak zmian. Układ kart i grup zostanie dopasowany po zatwierdzeniu.</p>
        <button disabled={phase === "applying"} onClick={confirm}>
          Zastosuj
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Pobierz zmiany</h1>
      <p>
        Wysłane z: <strong>{plan.snapshot.deviceName}</strong>, {new Date(plan.snapshot.sentAt).toLocaleString("pl-PL")}
      </p>
      <TabSection heading="Karty do otwarcia" action="otwarcie" items={opens} isChecked={isChecked} setChecked={setChecked} />
      <TabSection heading="Karty do zamknięcia" action="zamknięcie" items={closes} isChecked={isChecked} setChecked={setChecked} />
      <BookmarkSection items={bookmarks} isChecked={isChecked} setChecked={setChecked} />
      <button disabled={phase === "applying"} onClick={confirm}>
        Zastosuj
      </button>
      {error && <p class="error">{error}</p>}
    </main>
  );
}

type CheckProps = { isChecked: (id: string) => boolean; setChecked: (ids: string[], checked: boolean) => void };

function GroupToggle({ label, ids, isChecked, setChecked }: CheckProps & { label: string; ids: string[] }) {
  return (
    <label>
      <input type="checkbox" checked={ids.every(isChecked)} onChange={(e) => setChecked(ids, e.currentTarget.checked)} />
      {label}
    </label>
  );
}

function Item({ id, title, url, isChecked, setChecked }: CheckProps & { id: string; title: string; url: string }) {
  return (
    <label>
      <input type="checkbox" checked={isChecked(id)} onChange={(e) => setChecked([id], e.currentTarget.checked)} />
      {title} {url}
    </label>
  );
}

function TabSection({ heading, action, items, ...check }: CheckProps & { heading: string; action: string; items: TabChange[] }) {
  if (items.length === 0) return null;
  const windows = [...new Set(items.map((t) => t.windowIndex))];
  return (
    <section>
      <h2>
        {heading} ({items.length})
      </h2>
      {windows.map((windowIndex) => {
        const inWindow = items.filter((t) => t.windowIndex === windowIndex);
        const groups = [...new Set(inWindow.map((t) => t.groupTitle))];
        return (
          <fieldset key={windowIndex}>
            <legend>
              <GroupToggle label={`Okno ${windowIndex + 1} (${action})`} ids={inWindow.map((t) => t.id)} {...check} />
            </legend>
            {groups.map((groupTitle) => {
              const inGroup = inWindow.filter((t) => t.groupTitle === groupTitle);
              return (
                <div key={groupTitle ?? ""}>
                  {groupTitle !== undefined && (
                    <GroupToggle label={`Grupa: ${groupTitle} (${action})`} ids={inGroup.map((t) => t.id)} {...check} />
                  )}
                  {inGroup.map((tab) => (
                    <Item key={tab.id} id={tab.id} title={tab.title} url={tab.url} {...check} />
                  ))}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
}

function BookmarkSection({ items, ...check }: CheckProps & { items: BookmarkChange[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2>Ulubione do zmiany ({items.length})</h2>
      {items.map((item) => (
        <Item
          key={item.id}
          id={item.id}
          title={`${item.kind === "add" ? "Dodaj" : "Usuń"}: ${[...item.path, item.title].join(" / ")}`}
          url={item.url ?? ""}
          {...check}
        />
      ))}
    </section>
  );
}
```

`src/preview/index.tsx`:

```tsx
import { render } from "preact";
import { PreviewApp } from "../ui/preview/App";

render(<PreviewApp />, document.getElementById("app")!);
```

- [ ] **Step 3: Verify**

Run: `pnpm test tests/ui.preview.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src tests/ui.preview.test.tsx
git commit -m "feat: add pull preview with checkboxes"
```

---

### Task 10: End-to-end test in real Chromium

Confirms in a real browser what unit tests only stub: groups, pins, order, the key surviving a restart, GitHub writes going through the extension.

**Files:**
- Create: `playwright.config.ts`, `e2e/fake-github.ts`, `e2e/helpers.ts`, `e2e/sync.spec.ts`

**Interfaces:**
- Consumes: built `dist/extension`, labels from Tasks 8 and 9.

- [ ] **Step 1: Write the harness**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "e2e", timeout: 60_000, workers: 1, reporter: "list" });
```

`e2e/fake-github.ts`:

```ts
import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";

export class FakeGitHub {
  readonly files = new Map<string, { sha: string; content: string }>();

  async attach(context: BrowserContext): Promise<void> {
    await context.route("https://api.github.com/**", (route) => this.handle(route));
  }

  private handle(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/repos/o/r/contents/", "");
    if (path === "/repos/o/r") return route.fulfill({ json: { full_name: "o/r" } });
    const existing = this.files.get(path);
    if (request.method() === "GET") {
      if (!existing) return route.fulfill({ status: 404, json: {} });
      return route.fulfill({ json: { sha: existing.sha, encoding: "base64", content: existing.content } });
    }
    const body = request.postDataJSON() as { content: string; sha?: string };
    if (existing && !body.sha) return route.fulfill({ status: 422, json: {} });
    if (existing && body.sha !== existing.sha) return route.fulfill({ status: 409, json: {} });
    const sha = createHash("sha1").update(body.content).digest("hex");
    this.files.set(path, { sha, content: body.content });
    return route.fulfill({ json: { content: { sha } } });
  }
}
```

`e2e/helpers.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import type { FakeGitHub } from "./fake-github";

const extensionPath = resolve(import.meta.dirname, "../dist/extension");
const manifest = JSON.parse(readFileSync(join(extensionPath, "manifest.json"), "utf8")) as { key: string };

export const extensionId = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)]
  .map((char) => String.fromCharCode(97 + Number.parseInt(char, 16)))
  .join("");

export const newProfileDir = () => mkdtempSync(join(tmpdir(), "bts-e2e-"));

export async function launch(userDataDir: string, github: FakeGitHub): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await github.attach(context);
  await context.route("https://*.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: `<title>${new URL(route.request().url()).host}</title>` }),
  );
  return context;
}

export async function openExtensionPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

export async function configure(context: BrowserContext, keyText: string | null, device: string): Promise<{ page: Page; keyText: string }> {
  const page = await openExtensionPage(context, "options/index.html");
  await page.getByLabel("Repozytorium (owner/nazwa)").fill("o/r");
  await page.getByLabel("Token GitHub").fill("token");
  if (keyText) await page.getByLabel("Klucz szyfrowania").fill(keyText);
  else await page.getByRole("button", { name: "Wygeneruj klucz" }).click();
  await page.getByLabel("Nazwa urządzenia").fill(device);
  const usedKey = await page.getByLabel("Klucz szyfrowania").inputValue();
  await page.getByRole("button", { name: "Połącz" }).click();
  await page.getByRole("heading", { name: "Profil synchronizacji" }).waitFor();
  return { page, keyText: usedKey };
}

export type TabInfo = { url: string; pinned: boolean; group: string | null };

export async function readTabs(page: Page): Promise<TabInfo[]> {
  return page.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const groups = await chrome.tabGroups.query({});
    return tabs
      .filter((tab) => tab.url?.startsWith("https://"))
      .map((tab) => ({
        url: tab.url!,
        pinned: tab.pinned,
        group: groups.find((group) => group.id === tab.groupId)?.title ?? null,
      }));
  });
}
```

- [ ] **Step 2: Write the end-to-end test**

`e2e/sync.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { FakeGitHub } from "./fake-github";
import { configure, launch, newProfileDir, openExtensionPage, readTabs } from "./helpers";

test("sends from one profile, previews and pulls into another", async () => {
  const github = new FakeGitHub();

  const sender = await launch(newProfileDir(), github);
  const { page: senderOptions, keyText } = await configure(sender, null, "Laptop");
  await senderOptions.getByLabel("Nowy profil synchronizacji").fill("Praca");
  await senderOptions.getByRole("button", { name: "Utwórz" }).click();
  await expect(senderOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  for (const url of ["https://pinned.test/", "https://grouped.test/", "https://loose.test/"]) {
    await (await sender.newPage()).goto(url);
  }
  await senderOptions.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const byUrl = (part: string) => tabs.find((tab) => tab.url?.includes(part))!.id!;
    await chrome.tabs.update(byUrl("pinned.test"), { pinned: true });
    const groupId = await chrome.tabs.group({ tabIds: [byUrl("grouped.test")] });
    await chrome.tabGroups.update(groupId, { title: "Projekt", color: "blue" });
    const bar = (await chrome.bookmarks.getTree())[0]!.children!.find((node) => node.folderType === "bookmarks-bar")!;
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: "Folder" });
    await chrome.bookmarks.create({ parentId: folder.id, title: "Mark", url: "https://mark.test/" });
  });

  const senderPopup = await openExtensionPage(sender, "popup/index.html");
  await senderPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(senderPopup.getByText("Wysłano.")).toBeVisible();
  await sender.close();

  for (const { content } of github.files.values()) {
    const stored = Buffer.from(content, "base64").toString("latin1");
    expect(stored).not.toContain("pinned.test");
    expect(stored).not.toContain("Praca");
    expect(stored).not.toContain("Projekt");
  }

  const receiverDir = newProfileDir();
  const receiver = await launch(receiverDir, github);
  const { page: receiverOptions } = await configure(receiver, keyText, "Desktop");
  await receiverOptions.getByRole("button", { name: "Praca" }).click();
  await expect(receiverOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  await (await receiver.newPage()).goto("https://local-keep.test/");
  await (await receiver.newPage()).goto("https://local-close.test/");

  const preview = await openExtensionPage(receiver, "preview/index.html");
  await expect(preview.getByText("Laptop")).toBeVisible();
  await preview.getByRole("checkbox", { name: /local-keep\.test/ }).uncheck();
  await preview.getByRole("button", { name: "Zastosuj" }).click();
  await expect(preview.getByText("Gotowe.")).toBeVisible();

  const tabs = await readTabs(preview);
  expect(tabs.find((tab) => tab.url === "https://pinned.test/")?.pinned).toBe(true);
  expect(tabs.find((tab) => tab.url === "https://grouped.test/")?.group).toBe("Projekt");
  expect(tabs.some((tab) => tab.url === "https://loose.test/")).toBe(true);
  expect(tabs.some((tab) => tab.url === "https://local-keep.test/")).toBe(true);
  expect(tabs.some((tab) => tab.url === "https://local-close.test/")).toBe(false);

  const bookmarks = await preview.evaluate(() => chrome.bookmarks.search({ url: "https://mark.test/" }));
  expect(bookmarks).toHaveLength(1);

  await receiver.close();

  const restarted = await launch(receiverDir, github);
  const popup = await openExtensionPage(restarted, "popup/index.html");
  await popup.getByRole("button", { name: "Wyślij" }).click();
  await expect(popup.getByText("Wysłano.")).toBeVisible();
  await restarted.close();
});

test("warns before overwriting newer data", async () => {
  const github = new FakeGitHub();
  const first = await launch(newProfileDir(), github);
  const { page: firstOptions, keyText } = await configure(first, null, "Laptop");
  await firstOptions.getByLabel("Nowy profil synchronizacji").fill("Praca");
  await firstOptions.getByRole("button", { name: "Utwórz" }).click();
  await expect(firstOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  const second = await launch(newProfileDir(), github);
  const { page: secondOptions } = await configure(second, keyText, "Desktop");
  await secondOptions.getByRole("button", { name: "Praca" }).click();
  await expect(secondOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  const firstPopup = await openExtensionPage(first, "popup/index.html");
  await firstPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(firstPopup.getByText("Wysłano.")).toBeVisible();

  const secondPopup = await openExtensionPage(second, "popup/index.html");
  await secondPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(secondPopup.getByText(/Laptop/)).toBeVisible();
  await expect(secondPopup.getByRole("button", { name: "Nadpisz mimo to" })).toBeVisible();

  await first.close();
  await second.close();
});
```

- [ ] **Step 3: Install the browser and run**

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Expected: 2 passed. If `apply` misbehaves in real Chromium (for example collapsing a group or moving tabs in an order Chrome rejects), fix `src/shared/apply.ts` and add a matching case to `tests/apply.test.ts` before re-running.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: cover send and pull end to end"
```

---

### Task 11: Documentation and delivery

**Files:**
- Create: `README.md`, `docs/architecture/overview.md`, `docs/architecture/data-model.md`, `docs/architecture/threat-model.md`, `docs/install-chrome.md`

**Interfaces:**
- Consumes: the design document.

- [ ] **Step 1: Write the docs**

`README.md`:

```markdown
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
- `docs/architecture`: design, data model, threat model
```

`docs/architecture/overview.md`: copy the Goal, Non-goals, Concepts, Send, Pull and Modules sections from the design document.

`docs/architecture/data-model.md`: copy the Data model and Encryption file-format paragraphs from the design document.

`docs/architecture/threat-model.md`:

```markdown
# Threat model

## Assets

URLs, page titles, tab group names, sync profile names, the encryption key, the GitHub token.

## Who sees what

| Party                      | Can read content | Can change or delete data |
| -------------------------- | ---------------- | ------------------------- |
| GitHub                     | No               | Yes                       |
| Holder of the token only   | No               | Yes (history can recover) |
| Holder of the key only     | No repo access   | No                        |
| Holder of token and key    | Yes              | Yes                       |
| Malware on the computer    | Yes              | Yes                       |

## Mitigations

- AES-256-GCM with a fresh random IV per write; the key never leaves the extension.
- Associated data binds each file to its path, so modified or swapped files are rejected.
- Random key instead of a password, so a leaked repository can't be brute-forced.
- Random file names, neutral commit messages, encrypted sync profile names.
- Fine-grained token limited to one repository.
- Minimal permissions, no content scripts, strict CSP, locked by a test.
- A local backup before every pull; nothing in the browser changes before the download is decrypted and validated.

## Known limits

- A lost key means lost data.
- A leaked key exposes the whole repository history: replace the repository and generate a new key.
- GitHub serving an older valid version is not detected.
- File size and commit times reveal a rough tab count and activity pattern.
```

`docs/install-chrome.md`:

```markdown
# Install in Chrome

## Once

1. Create a private GitHub repository for your data.
2. Create a fine-grained token at GitHub Settings > Developer settings, with access to only that repository and `Contents: Read and write`.

## In each Chrome profile

1. Download the zip from a release, or run `pnpm build:extension`, and unpack it.
2. Open `chrome://extensions`, enable Developer mode, choose Load unpacked and select the folder.
3. Open the extension's options.
4. Enter the repository as `owner/name` and the token.
5. On first setup choose Generate key and store it in a password manager. On every other profile paste the same key.
6. Enter a device name, choose Connect, then pick or create a sync profile.

## Updating

Replace the folder with the new version and choose Reload on `chrome://extensions`.
```

- [ ] **Step 2: Run every gate**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e && pnpm audit:deps`
Expected: every command exits 0.

- [ ] **Step 3: Commit, open the PR and merge when CI is green**

```bash
git add README.md docs
git commit -m "docs: add install guide, architecture and threat model"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin feature/browser-tabs-sync
gh pr create --base main --title "feat: browser tabs sync extension" --body ""
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Expected: CI green before merging.

---

## Assumptions

- A non-extractable `CryptoKey` persists in IndexedDB across browser restarts. Task 10's restart step proves it.
- Only the first root per `folderType` is synced. Chrome documents that several may exist; a Chrome profile signed in to account bookmarks could have more.
- Newest majors work together (Task 1 Step 8 proves it or pins versions).

## Unresolved questions

None blocking.
