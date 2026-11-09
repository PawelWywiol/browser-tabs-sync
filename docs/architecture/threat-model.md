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
