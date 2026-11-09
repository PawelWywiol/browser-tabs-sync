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

import { buildWindows, PreviewApp } from "../src/ui/preview/App";

const plan = {
  sha: "s",
  local: { windows: [{ groups: [], tabs: [] }], bookmarks: [] },
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
    expect(await screen.findByRole("heading", { name: "Okno 1" })).toBeTruthy();
    expect(
      screen.getByText("Otworzy 2 karty, zamknie 1 kartę, zmieni 1 ulubioną.", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zastosuj 4 zmiany" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ulubione/ })).toBeTruthy();
    expect(checkbox(/a\.test/).checked).toBe(true);
    expect(screen.getByText(/Laptop/)).toBeTruthy();
  });

  it("applies only checked items", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /c\.test/ }));
    fireEvent.click(screen.getByRole("button", { name: /Zastosuj/ }));
    await waitFor(() => expect(mocks.runPull).toHaveBeenCalled());
    expect([...mocks.runPull.mock.calls[0]![2]].sort()).toEqual(["add:0", "open:0:0", "open:0:1"]);
    expect(await screen.findByText("Gotowe.")).toBeTruthy();
  });

  it("toggles a whole group with one checkbox", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Cała grupa: Praca" }));
    expect(checkbox(/a\.test/).checked).toBe(false);
    expect(checkbox(/b\.test/).checked).toBe(false);
    expect(checkbox(/c\.test/).checked).toBe(true);
  });

  it("updates the counts as items are unchecked", async () => {
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /c\.test/ }));
    expect(screen.getByRole("button", { name: "Zastosuj 3 zmiany" })).toBeTruthy();
  });

  it("keeps an unpaired remote window apart from local windows", () => {
    const views = buildWindows(
      {
        windowPairs: [-1],
        matches: [],
        bookmarks: [],
        tabs: [
          { id: "open:0:0", kind: "open", url: "u", title: "O", windowIndex: 0, targetTab: 0 },
          { id: "close:1", kind: "close", url: "v", title: "C", windowIndex: 0, localId: 1 },
        ],
      },
      1,
    );
    expect(views.map((view) => view.label)).toEqual(["Okno 1", "Nowe okno"]);
  });

  it("offers restore after a failure", async () => {
    const backup = { id: 1 };
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.restoreBackup.mockResolvedValue([]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Zastosuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
    expect(await screen.findByText("Przywrócono kopię.")).toBeTruthy();
  });

  it("reports failed URLs when restore is partial", async () => {
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([{ id: 1 }]);
    mocks.restoreBackup.mockResolvedValue([{ url: "https://z.test/", message: "x" }]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Zastosuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    expect(await screen.findByText("Nie przywrócono: https://z.test/")).toBeTruthy();
    expect(screen.queryByText("Przywrócono kopię.")).toBeNull();
  });

  it("clears the success text when a repeated restore fails", async () => {
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([{ id: 1 }]);
    mocks.restoreBackup.mockResolvedValueOnce([]);
    mocks.restoreBackup.mockResolvedValueOnce([{ url: "https://z.test/", message: "x" }]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Zastosuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    expect(await screen.findByText("Przywrócono kopię.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Przywróć kopię" }));
    expect(await screen.findByText(/Nie przywrócono/)).toBeTruthy();
    expect(screen.queryByText("Przywrócono kopię.")).toBeNull();
  });

  it("reports when there is no backup to restore", async () => {
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockResolvedValue([]);
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Zastosuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    expect(await screen.findByText("Brak kopii do przywrócenia.")).toBeTruthy();
  });

  it("shows an error when reading backups fails", async () => {
    mocks.runPull.mockResolvedValue([{ url: "https://a.test/", message: "refused" }]);
    mocks.listBackups.mockRejectedValue(new Error("idb down"));
    render(<PreviewApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Zastosuj/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Przywróć kopię" }));
    await waitFor(() =>
      expect(document.querySelector(".error")?.textContent).toContain("idb down"),
    );
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
