export type Settings = {
  owner: string;
  repo: string;
  token: string;
  deviceName: string;
  profileId: string;
  profileName: string;
  lastSeenSha?: string;
  lastSentAt?: string;
};

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<Partial<Settings>> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] ?? {}) as Partial<Settings>;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...(await loadSettings()), ...patch } });
}

export async function clearProfileSyncState(): Promise<void> {
  const { lastSeenSha: _sha, lastSentAt: _sent, ...rest } = await loadSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: rest });
}
