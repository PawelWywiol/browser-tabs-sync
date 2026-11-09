// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  loadPull: vi.fn(),
  runPull: vi.fn(),
  restoreBackup: vi.fn(),
  listBackups: vi.fn(),
}));
vi.mock("../src/shared/sync", () => ({
  loadContext: mocks.loadContext,
  loadPull: mocks.loadPull,
  runPull: mocks.runPull,
  restoreBackup: mocks.restoreBackup,
}));
vi.mock("../src/shared/idb", () => ({ listBackups: mocks.listBackups }));

import { PreviewApp } from "../src/ui/preview/App";

const plan = {
  sha: "s",
  local: { windows: [], bookmarks: [] },
  snapshot: { deviceName: "Laptop", sentAt: "2026-11-08T10:00:00Z", windows: [], bookmarks: [] },
  changes: {
    windowPairs: [0],
    matches: [],
    tabs: [
      {
        id: "open:0:0",
        kind: "open",
        url: "https://a.test/",
        title: "A",
        windowIndex: 0,
        groupTitle: "Praca",
        targetTab: 0,
      },
      {
        id: "open:0:1",
        kind: "open",
        url: "https://b.test/",
        title: "B",
        windowIndex: 0,
        groupTitle: "Praca",
        targetTab: 1,
      },
      {
        id: "close:5",
        kind: "close",
        url: "https://c.test/",
        title: "C",
        windowIndex: 0,
        localId: 5,
      },
    ],
    bookmarks: [
      {
        id: "add:0",
        kind: "add",
        folderType: "other",
        path: ["F"],
        title: "X",
        url: "https://x.test/",
      },
    ],
  },
};

const checkbox = (name: string | RegExp) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement;
const context = { settings: {}, remote: {} };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadContext.mockResolvedValue(context);
  mocks.loadPull.mockResolvedValue(plan);
  mocks.runPull.mockResolvedValue([]);
});
afterEach(cleanup);

describe("PreviewApp", () => {
  it("lists all changes checked, with their sections", async () => {
    render(<PreviewApp />);
    expect(await screen.findByRole("heading", { name: /Karty do otwarcia/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Karty do zamknięcia/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ulubione/ })).toBeTruthy();
    expect(checkbox("A https://a.test/").checked).toBe(true);
    expect(screen.getByText(/Laptop/)).toBeTruthy();
  });

  it("applies only checked items", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "C https://c.test/" }));
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    await waitFor(() => expect(mocks.runPull).toHaveBeenCalled());
    expect([...mocks.runPull.mock.calls[0]![2]].sort()).toEqual(["add:0", "open:0:0", "open:0:1"]);
    expect(await screen.findByText("Gotowe.")).toBeTruthy();
  });

  it("toggles a whole group with one checkbox", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Grupa: Praca (otwarcie)" }));
    expect(checkbox("A https://a.test/").checked).toBe(false);
    expect(checkbox("B https://b.test/").checked).toBe(false);
    expect(checkbox("C https://c.test/").checked).toBe(true);
  });

  it("offers restore after a failure", async () => {
    const backup = { id: 1 };
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.restoreBackup.mockResolvedValue([]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Zastosuj" }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
    expect(screen.getByText(/https:\/\/a\.test\//)).toBeTruthy();
  });

  it("reports when there is nothing to pull", async () => {
    mocks.loadPull.mockResolvedValue(null);
    render(<PreviewApp />);
    expect(await screen.findByText(/Brak danych/)).toBeTruthy();
  });

  it("shows when already in sync", async () => {
    mocks.loadPull.mockResolvedValue({
      ...plan,
      changes: { ...plan.changes, tabs: [], bookmarks: [] },
    });
    render(<PreviewApp />);
    expect(await screen.findByText(/Brak zmian/)).toBeTruthy();
  });
});
