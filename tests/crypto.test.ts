import { describe, expect, it } from "vitest";
import {
  decrypt,
  DecryptError,
  encrypt,
  generateKeyText,
  importKeyText,
} from "../src/shared/crypto";

const key = () => importKeyText(generateKeyText());

describe("crypto", () => {
  it("round-trips text", async () => {
    const k = await key();
    expect(await decrypt(k, "a.enc", await encrypt(k, "a.enc", "https://example.com"))).toBe(
      "https://example.com",
    );
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
    await expect(decrypt(k, "b.enc", await encrypt(k, "a.enc", "x"))).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it("rejects modified bytes", async () => {
    const k = await key();
    const bytes = await encrypt(k, "a.enc", "x");
    bytes[bytes.length - 1]! ^= 1;
    await expect(decrypt(k, "a.enc", bytes)).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects the wrong key", async () => {
    await expect(
      decrypt(await key(), "a.enc", await encrypt(await key(), "a.enc", "x")),
    ).rejects.toBeInstanceOf(DecryptError);
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
