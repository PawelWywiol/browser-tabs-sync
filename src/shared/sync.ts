import { apply, type ApplyFailure } from "./apply";
import { diff, type ChangeSet } from "./diff";
import { GitHubError } from "./github";
import { loadKey, saveBackup, type Backup } from "./idb";
import { readSnapshot, readSnapshotSha, writeSnapshot, type Remote } from "./remote";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { capture, InvalidSnapshotError, toSnapshot } from "./snapshot";
import type { BrowserState, Snapshot } from "./types";

export type SyncContext = { remote: Remote; settings: Settings };
export type SendResult =
  | { status: "sent" }
  | { status: "newer"; deviceName: string; sentAt: string }
  | { status: "invalid" };
export type PullPlan = { local: BrowserState; snapshot: Snapshot; sha: string; changes: ChangeSet };

export async function loadContext(): Promise<SyncContext | null> {
  const [settings, key] = await Promise.all([loadSettings(), loadKey()]);
  if (
    !key ||
    !settings.owner ||
    !settings.repo ||
    !settings.token ||
    !settings.profileId ||
    !settings.deviceName
  ) {
    return null;
  }
  const complete = settings as Settings;
  return {
    remote: { key, config: { owner: complete.owner, repo: complete.repo, token: complete.token } },
    settings: complete,
  };
}

const newer = (snapshot: Snapshot): SendResult => ({
  status: "newer",
  deviceName: snapshot.deviceName,
  sentAt: snapshot.sentAt,
});

async function sendChecked(context: SyncContext, force: boolean): Promise<SendResult> {
  const { remote, settings } = context;
  let remoteSha: string | undefined;
  if (force) {
    remoteSha = await readSnapshotSha(remote, settings.profileId);
  } else {
    const existing = await readSnapshot(remote, settings.profileId);
    const { lastSeenSha } = await loadSettings();
    if (existing && existing.sha !== lastSeenSha) return newer(existing.snapshot);
    remoteSha = existing?.sha;
  }
  const snapshot = toSnapshot(await capture(), settings.deviceName, new Date().toISOString());
  try {
    const sha = await writeSnapshot(remote, settings.profileId, snapshot, remoteSha);
    await saveSettings({ lastSeenSha: sha, lastSentAt: snapshot.sentAt });
    return { status: "sent" };
  } catch (error) {
    if (!(error instanceof GitHubError) || error.kind !== "conflict") throw error;
    const latest = await readSnapshot(remote, settings.profileId);
    if (!latest) throw error;
    return newer(latest.snapshot);
  }
}

export async function send(context: SyncContext, force = false): Promise<SendResult> {
  try {
    return await sendChecked(context, force);
  } catch (error) {
    if (error instanceof InvalidSnapshotError) return { status: "invalid" };
    throw error;
  }
}

export async function loadPull(context: SyncContext): Promise<PullPlan | null> {
  const remote = await readSnapshot(context.remote, context.settings.profileId);
  if (!remote) return null;
  const local = await capture();
  return {
    local,
    snapshot: remote.snapshot,
    sha: remote.sha,
    changes: diff(local, remote.snapshot),
  };
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
  await saveBackup(toSnapshot(local, backup.snapshot.deviceName, new Date().toISOString()));
  const changes = diff(local, backup.snapshot);
  const everything = new Set([...changes.tabs, ...changes.bookmarks].map((change) => change.id));
  return apply(local, backup.snapshot, changes, everything);
}
