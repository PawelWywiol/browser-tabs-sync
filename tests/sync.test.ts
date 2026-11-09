import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecryptError } from "../src/shared/crypto";
import { GitHubError } from "../src/shared/github";
import type { Snapshot } from "../src/shared/types";

const mocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  readSnapshotSha: vi.fn(),
  writeSnapshot: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  saveBackup: vi.fn(),
  saveSettings: vi.fn(),
  loadSettings: vi.fn(),
}));

vi.mock("../src/shared/remote", () => ({
  readSnapshot: mocks.readSnapshot,
  readSnapshotSha: mocks.readSnapshotSha,
  writeSnapshot: mocks.writeSnapshot,
}));
vi.mock("../src/shared/snapshot", () => ({
  InvalidSnapshotError: class InvalidSnapshotError extends Error {},
  capture: mocks.capture,
  toSnapshot: (state: object, deviceName: string, sentAt: string) => ({
    ...state,
    deviceName,
    sentAt,
    formatVersion: 1,
  }),
}));
vi.mock("../src/shared/apply", () => ({ apply: mocks.apply }));
vi.mock("../src/shared/idb", () => ({ saveBackup: mocks.saveBackup, loadKey: vi.fn() }));
vi.mock("../src/shared/settings", () => ({
  saveSettings: mocks.saveSettings,
  loadSettings: mocks.loadSettings,
}));

const { loadPull, restoreBackup, runPull, send } = await import("../src/shared/sync");
const { InvalidSnapshotError } = await import("../src/shared/snapshot");

const remoteSnapshot: Snapshot = {
  formatVersion: 1,
  sentAt: "t1",
  deviceName: "Laptop",
  windows: [],
  bookmarks: [],
};
const context = (lastSeenSha?: string) => {
  mocks.loadSettings.mockResolvedValue({ lastSeenSha });
  return { remote: {} as never, settings: { profileId: "p", deviceName: "Desktop" } as never };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.capture.mockResolvedValue({ windows: [], bookmarks: [] });
  mocks.writeSnapshot.mockResolvedValue("new-sha");
});

describe("send", () => {
  it("writes when the remote is empty", async () => {
    mocks.readSnapshot.mockResolvedValue(null);
    expect(await send(context())).toEqual({ status: "sent" });
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      lastSeenSha: "new-sha",
      lastSentAt: expect.any(String),
    });
  });

  it("writes when the remote matches the last seen version", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s1" });
    expect(await send(context("s1"))).toEqual({ status: "sent" });
    expect(mocks.writeSnapshot.mock.calls[0]![3]).toBe("s1");
  });

  it("warns about a newer remote and writes nothing", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s2" });
    expect(await send(context("s1"))).toEqual({
      status: "newer",
      deviceName: "Laptop",
      sentAt: "t1",
    });
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("overwrites using only the remote SHA when forced", async () => {
    mocks.readSnapshotSha.mockResolvedValue("s2");
    expect(await send(context("s1"), true)).toEqual({ status: "sent" });
    expect(mocks.readSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeSnapshot.mock.calls[0]![3]).toBe("s2");
  });

  it("reports an invalid remote without writing", async () => {
    mocks.readSnapshot.mockRejectedValue(new InvalidSnapshotError());
    expect(await send(context("s1"))).toEqual({ status: "invalid" });
    expect(mocks.writeSnapshot).not.toHaveBeenCalled();
  });

  it("keeps a decrypt failure as an error", async () => {
    const failure = new DecryptError();
    mocks.readSnapshot.mockRejectedValue(failure);
    await expect(send(context("s1"))).rejects.toBe(failure);
  });

  it("compares against the freshly stored last seen version", async () => {
    mocks.readSnapshot.mockResolvedValue({ snapshot: remoteSnapshot, sha: "s2" });
    const stale = {
      remote: {} as never,
      settings: { profileId: "p", deviceName: "Desktop", lastSeenSha: "s1" } as never,
    };
    mocks.loadSettings.mockResolvedValue({ lastSeenSha: "s2" });
    expect(await send(stale)).toEqual({ status: "sent" });
  });

  it("turns a concurrent write into a newer warning", async () => {
    mocks.readSnapshot
      .mockResolvedValueOnce({ snapshot: remoteSnapshot, sha: "s1" })
      .mockResolvedValueOnce({ snapshot: { ...remoteSnapshot, deviceName: "Other" }, sha: "s3" });
    mocks.writeSnapshot.mockRejectedValue(new GitHubError("conflict"));
    expect(await send(context("s1"))).toEqual({
      status: "newer",
      deviceName: "Other",
      sentAt: "t1",
    });
  });
});

describe("restoreBackup", () => {
  const backup = { id: 1, savedAt: "t0", snapshot: remoteSnapshot };

  it("saves the current state under the backup device name before applying", async () => {
    const order: string[] = [];
    mocks.saveBackup.mockImplementation(async () => order.push("backup"));
    mocks.apply.mockImplementation(async () => {
      order.push("apply");
      return [];
    });
    await restoreBackup(backup);
    expect(order).toEqual(["backup", "apply"]);
    expect(mocks.saveBackup.mock.calls[0]![0]).toMatchObject({ deviceName: "Laptop" });
  });

  it("applies nothing when the safety copy fails", async () => {
    mocks.saveBackup.mockRejectedValue(new Error("disk"));
    await expect(restoreBackup(backup)).rejects.toThrow("disk");
    expect(mocks.apply).not.toHaveBeenCalled();
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
