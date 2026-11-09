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
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const profile = { id, name };
  const bytes = await encrypt(remote.key, INDEX_PATH, JSON.stringify([...profiles, profile]));
  await writeFile(remote.config, INDEX_PATH, bytes, sha);
  return profile;
}

export async function readSnapshot(
  remote: Remote,
  id: string,
): Promise<{ snapshot: Snapshot; sha: string } | null> {
  const path = profilePath(id);
  const file = await readFile(remote.config, path);
  if (!file) return null;
  return {
    snapshot: parseSnapshot(JSON.parse(await decrypt(remote.key, path, file.bytes))),
    sha: file.sha,
  };
}

export async function readSnapshotSha(remote: Remote, id: string): Promise<string | undefined> {
  return (await readFile(remote.config, profilePath(id)))?.sha;
}

export async function writeSnapshot(
  remote: Remote,
  id: string,
  snapshot: Snapshot,
  sha?: string,
): Promise<string> {
  const path = profilePath(id);
  return writeFile(
    remote.config,
    path,
    await encrypt(remote.key, path, JSON.stringify(snapshot)),
    sha,
  );
}
