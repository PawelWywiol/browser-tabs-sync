import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyText, importKeyText } from "../src/shared/crypto";
import {
  createProfile,
  listProfiles,
  readSnapshot,
  readSnapshotSha,
  writeSnapshot,
  type Remote,
} from "../src/shared/remote";
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
const snapshot: Snapshot = {
  formatVersion: 1,
  sentAt: "2026-11-08T00:00:00Z",
  deviceName: "A",
  windows: [],
  bookmarks: [],
};

beforeEach(async () => {
  files.clear();
  remote = {
    config: { owner: "o", repo: "r", token: "t" },
    key: await importKeyText(generateKeyText()),
  };
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

  it("reads the file SHA without decrypting or parsing", async () => {
    files.set("profiles/p.enc", { sha: "bad", bytes: new Uint8Array([1, 2, 3]) });
    expect(await readSnapshotSha(remote, "p")).toBe("bad");
  });

  it("reports no SHA when nothing was sent yet", async () => {
    expect(await readSnapshotSha(remote, "missing")).toBeUndefined();
  });

  it("returns null when nothing was sent yet", async () => {
    expect(await readSnapshot(remote, "missing")).toBeNull();
  });
});
