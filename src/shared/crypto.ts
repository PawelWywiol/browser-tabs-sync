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

export async function encrypt(
  key: CryptoKey,
  path: string,
  plaintext: string,
): Promise<Uint8Array<ArrayBuffer>> {
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

export async function decrypt(
  key: CryptoKey,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (bytes[0] !== FORMAT_VERSION || bytes.length <= HEADER_LENGTH)
    throw new DecryptError("Unsupported file");
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
