import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { listBackups, saveBackup } from "../src/shared/idb";
import type { Snapshot } from "../src/shared/types";

const snapshot = (deviceName: string): Snapshot => ({
  formatVersion: 1,
  sentAt: "t",
  deviceName,
  windows: [],
  bookmarks: [],
});

describe("backups", () => {
  it("keeps the 5 most recent, newest first", async () => {
    for (let i = 1; i <= 7; i++) await saveBackup(snapshot(`d${i}`));
    const backups = await listBackups();
    expect(backups.map((b) => b.snapshot.deviceName)).toEqual(["d7", "d6", "d5", "d4", "d3"]);
  });
});
