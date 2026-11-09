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

vi.mock("../src/shared/remote", () => ({
  readSnapshot: mocks.readSnapshot,
  writeSnapshot: mocks.writeSnapshot,
}));
vi.mock("../src/shared/snapshot", () => ({
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
  loadSettings: vi.fn(),
}));

const { loadPull, runPull, send } = await import("../src/shared/sync");

const remoteSnapshot: Snapshot = {
  formatVersion: 1,
  sentAt: "t1",
  deviceName: "Laptop",
  windows: [],
  bookmarks: [],
};
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
    expect(await send(context("s1"))).toEqual({
      status: "newer",
      deviceName: "Laptop",
      sentAt: "t1",
    });
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
    expect(await send(context("s1"))).toEqual({
      status: "newer",
      deviceName: "Other",
      sentAt: "t1",
    });
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
