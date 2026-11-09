# Install in Chrome

## Once

1. Create a private GitHub repository for your data.
2. Create a fine-grained token at GitHub Settings > Developer settings, with access to only that repository and `Contents: Read and write`.

## In each Chrome profile

1. Download the zip from a release, or run `pnpm build:extension`, and unpack it.
2. Open `chrome://extensions`, enable Developer mode, choose Load unpacked and select the folder.
3. Open the extension's options.
4. Enter the repository as `owner/name` (`Repozytorium`) and the token (`Token GitHub`).
5. On first setup choose `Wygeneruj klucz` (Generate key) and store it in a password manager. On every other profile paste the same key into `Klucz szyfrowania`.
6. Enter a device name (`Nazwa urządzenia`), choose `Połącz` (Connect), then pick or create a sync profile.

## Updating

Replace the folder with the new version and choose Reload on `chrome://extensions`.
