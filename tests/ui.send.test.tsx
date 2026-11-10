// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecryptError } from "../src/shared/crypto";

const mocks = vi.hoisted(() => ({ loadContext: vi.fn(), send: vi.fn(), capture: vi.fn() }));
vi.mock("../src/shared/sync", () => ({ loadContext: mocks.loadContext, send: mocks.send }));
vi.mock("../src/shared/snapshot", () => ({ capture: mocks.capture }));

import { SendApp } from "../src/ui/send/App";

const tab = (url: string, title: string) => ({ url, title, pinned: false, active: false });
const state = {
  windows: [{ groups: [], tabs: [tab("https://a.test/", "A"), tab("https://b.test/", "B")] }],
  bookmarks: [
    {
      folderType: "other",
      children: [{ kind: "bookmark", title: "X", url: "https://x.test/" }],
    },
  ],
};
const context = { settings: { profileName: "Praca" }, remote: {} };
const sendButton = () => screen.findByRole("button", { name: "Wyślij zaznaczone" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadContext.mockResolvedValue(context);
  mocks.capture.mockResolvedValue(state);
  mocks.send.mockResolvedValue({ status: "sent" });
  vi.stubGlobal("chrome", {
    tabs: { create: vi.fn() },
    windows: { create: vi.fn() },
    runtime: { getURL: (p: string) => p, openOptionsPage: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SendApp", () => {
  it("lists tabs and bookmarks, all checked, with the full link on hover", async () => {
    render(<SendApp />);
    await sendButton();
    expect(screen.getByText("Wyślesz 2 karty i 1 ulubioną.", { exact: false })).toBeTruthy();
    const row = screen.getByRole("checkbox", { name: /a\.test/ }) as HTMLInputElement;
    expect(row.checked).toBe(true);
    expect(row.closest("label")?.title).toBe("https://a.test/");
  });

  it("marks only pinned tabs", async () => {
    mocks.capture.mockResolvedValue({
      ...state,
      windows: [
        {
          groups: [],
          tabs: [{ ...tab("https://a.test/", "A"), pinned: true }, tab("https://b.test/", "B")],
        },
      ],
    });
    render(<SendApp />);
    await sendButton();
    expect(screen.getByRole("checkbox", { name: /Przypięta.*a\.test/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Przypięta.*b\.test/ })).toBeNull();
    expect(screen.getAllByText("Przypięta")).toHaveLength(1);
  });

  describe("search", () => {
    it("lives in the sticky header above the list", async () => {
      render(<SendApp />);
      await sendButton();
      expect(screen.getByRole("searchbox").closest("header.bar")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Wyślij zaznaczone" }).closest("header.bar"),
      ).toBeTruthy();
    });

    const search = (value: string) =>
      fireEvent.input(screen.getByRole("searchbox"), { target: { value } });
    const row = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
    const rowLookup = (name: RegExp) => screen.queryByRole("checkbox", { name });

    it("filters by title, host and full address, ignoring case", async () => {
      mocks.capture.mockResolvedValue({
        ...state,
        windows: [
          {
            groups: [],
            tabs: [tab("https://a.test/docs/page", "Dokumenty"), tab("https://b.test/", "Poczta")],
          },
        ],
      });
      render(<SendApp />);
      await sendButton();
      for (const query of ["DOKUMENTY", "a.test", "docs/page", "dokumenty a.test"]) {
        search(query);
        expect(rowLookup(/a\.test/)).toBeTruthy();
        expect(rowLookup(/b\.test/)).toBeNull();
        expect(rowLookup(/x\.test/)).toBeNull();
      }
    });

    it("finds tabs by group name and bookmarks by folder", async () => {
      mocks.capture.mockResolvedValue({
        windows: [
          {
            groups: [{ ref: "g1", title: "Projekt", color: "blue", collapsed: false }],
            tabs: [{ ...tab("https://a.test/", "A"), groupRef: "g1" }, tab("https://b.test/", "B")],
          },
        ],
        bookmarks: [
          {
            folderType: "other",
            children: [
              {
                kind: "folder",
                title: "Archiwum",
                children: [{ kind: "bookmark", title: "X", url: "https://x.test/" }],
              },
            ],
          },
        ],
      });
      render(<SendApp />);
      await sendButton();
      search("projekt");
      expect(rowLookup(/a\.test/)).toBeTruthy();
      expect(rowLookup(/b\.test/)).toBeNull();
      search("archiwum");
      expect(rowLookup(/x\.test/)).toBeTruthy();
      expect(rowLookup(/a\.test/)).toBeNull();
    });

    it("keeps selections of hidden items and still sends them", async () => {
      render(<SendApp />);
      await sendButton();
      fireEvent.click(row(/b\.test/));
      search("x.test");
      expect(screen.getByText("Wyślesz 1 kartę i 1 ulubioną.", { exact: false })).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("Pokazano 1 z 3");
      search("");
      expect(row(/a\.test/).checked).toBe(true);
      expect(row(/b\.test/).checked).toBe(false);
      search("x.test");
      fireEvent.click(await sendButton());
      await waitFor(() => expect(mocks.send).toHaveBeenCalled());
      const sent = mocks.send.mock.calls[0]![1];
      expect(sent.windows[0].tabs.map((t: { url: string }) => t.url)).toEqual(["https://a.test/"]);
    });

    it("applies a section toggle only to visible items", async () => {
      render(<SendApp />);
      await sendButton();
      search("a.test");
      fireEvent.click(screen.getByRole("checkbox", { name: "Całe okno: Okno 1" }));
      expect(row(/a\.test/).checked).toBe(false);
      search("");
      expect(row(/b\.test/).checked).toBe(true);
    });
  });

  describe("bookmark folders", () => {
    const link = (title: string, url: string) => ({ kind: "bookmark", title, url });
    const nested = {
      windows: [],
      bookmarks: [
        {
          folderType: "bookmarks-bar",
          children: [
            link("Start", "https://start.test/"),
            {
              kind: "folder",
              title: "Praca",
              children: [
                link("Raport", "https://raport.test/"),
                {
                  kind: "folder",
                  title: "Projekty",
                  children: [link("Tablica", "https://tablica.test/")],
                },
              ],
            },
          ],
        },
        { folderType: "other", children: [link("Inny", "https://inny.test/")] },
      ],
    };
    const box = (name: RegExp | string) =>
      screen.getByRole("checkbox", { name }) as HTMLInputElement;
    const parentFolderOf = (name: string) =>
      screen.getByText(name).closest(".folder")!.parentElement!.closest(".folder");

    beforeEach(() => mocks.capture.mockResolvedValue(nested));

    it("nests links inside their folders and shows only their own title", async () => {
      render(<SendApp />);
      await sendButton();
      expect(parentFolderOf("Projekty")?.textContent).toContain("Praca");
      expect(parentFolderOf("Praca")?.textContent).toContain("Pasek zakładek");
      expect(parentFolderOf("Pasek zakładek")).toBeNull();
      expect(screen.getByText("Inne zakładki")).toBeTruthy();
      expect(screen.getByText("Tablica").closest(".folder")?.textContent).toContain("Projekty");
      expect(screen.queryByText(/Praca \/ /)).toBeNull();
    });

    it("keeps the browser order of links and folders", async () => {
      render(<SendApp />);
      await sendButton();
      const start = screen.getByText("Start");
      const folder = screen.getByText("Praca");
      expect(start.compareDocumentPosition(folder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("toggles a whole folder with its subfolders only", async () => {
      render(<SendApp />);
      await sendButton();
      fireEvent.click(box("Cały folder: Pasek zakładek / Praca"));
      expect(box(/raport\.test/).checked).toBe(false);
      expect(box(/tablica\.test/).checked).toBe(false);
      expect(box(/start\.test/).checked).toBe(true);
      expect(box("Cały folder: Pasek zakładek").indeterminate).toBe(true);
    });

    it("shows the folders leading to a search result", async () => {
      render(<SendApp />);
      await sendButton();
      fireEvent.input(screen.getByRole("searchbox"), { target: { value: "tablica" } });
      expect(screen.getByText("Projekty")).toBeTruthy();
      expect(screen.getByText("Praca")).toBeTruthy();
      expect(screen.queryByText("Raport")).toBeNull();
      expect(screen.queryByText("Inne zakładki")).toBeNull();
    });
  });

  describe("links", () => {
    const button = (name: RegExp) => screen.getByRole("button", { name });

    it("opens a link in a background tab without changing the selection", async () => {
      render(<SendApp />);
      await sendButton();
      fireEvent.click(button(/nowej karcie: A$/));
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://a.test/", active: false });
      expect((screen.getByRole("checkbox", { name: /a\.test/ }) as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it("opens a link in an incognito window", async () => {
      render(<SendApp />);
      await sendButton();
      fireEvent.click(button(/incognito: X$/));
      expect(chrome.windows.create).toHaveBeenCalledWith({
        url: "https://x.test/",
        incognito: true,
      });
    });

    it("reports a link that could not be opened", async () => {
      vi.mocked(chrome.windows.create).mockRejectedValue(new Error("disabled"));
      render(<SendApp />);
      await sendButton();
      fireEvent.click(button(/incognito: A$/));
      expect((await screen.findByRole("alert")).textContent).toContain("https://a.test/");
    });

    it("shows a favicon for tabs and bookmarks", async () => {
      const { container } = render(<SendApp />);
      await sendButton();
      const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
      expect(sources).toEqual([
        "_favicon/?pageUrl=https%3A%2F%2Fa.test%2F&size=32",
        "_favicon/?pageUrl=https%3A%2F%2Fb.test%2F&size=32",
        "_favicon/?pageUrl=https%3A%2F%2Fx.test%2F&size=32",
      ]);
    });
  });

  it("sends everything by default", async () => {
    render(<SendApp />);
    fireEvent.click(await sendButton());
    expect(await screen.findByText("Wysłano.")).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith(context, state, false);
  });

  it("leaves unchecked items out of what is sent", async () => {
    render(<SendApp />);
    await sendButton();
    fireEvent.click(screen.getByRole("checkbox", { name: /b\.test/ }));
    expect(screen.getByText("Wyślesz 1 kartę i 1 ulubioną.", { exact: false })).toBeTruthy();
    fireEvent.click(await sendButton());
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    const sent = mocks.send.mock.calls[0]![1];
    expect(sent.windows[0].tabs.map((t: { url: string }) => t.url)).toEqual(["https://a.test/"]);
    expect(sent.bookmarks[0].children).toHaveLength(1);
  });

  it("blocks sending when nothing is selected", async () => {
    render(<SendApp />);
    await sendButton();
    fireEvent.click(screen.getByRole("checkbox", { name: "Całe okno: Okno 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Wszystkie ulubione" }));
    expect(((await sendButton()) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns about newer data and can overwrite with the same selection", async () => {
    mocks.send
      .mockResolvedValueOnce({
        status: "newer",
        deviceName: "Laptop",
        sentAt: "2026-11-08T10:00:00Z",
      })
      .mockResolvedValueOnce({ status: "sent" });
    render(<SendApp />);
    fireEvent.click(await sendButton());
    expect(await screen.findByText(/Laptop/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nadpisz mimo to" }));
    expect(await screen.findByText("Wysłano.")).toBeTruthy();
    expect(mocks.send).toHaveBeenLastCalledWith(context, state, true);
  });

  it("offers overwrite for invalid remote data but not pulling first", async () => {
    mocks.send.mockResolvedValueOnce({ status: "invalid" });
    render(<SendApp />);
    fireEvent.click(await sendButton());
    expect(await screen.findByText("Dane w repozytorium są nieprawidłowe.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Najpierw pobierz" })).toBeNull();
  });

  it("shows a send failure and keeps the list", async () => {
    mocks.send.mockRejectedValue(new DecryptError());
    render(<SendApp />);
    fireEvent.click(await sendButton());
    expect((await screen.findByRole("alert")).textContent).toContain("odszyfrować");
    expect(screen.getByRole("checkbox", { name: /a\.test/ })).toBeTruthy();
  });

  it("points to settings when not configured", async () => {
    mocks.loadContext.mockResolvedValue(null);
    render(<SendApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Otwórz ustawienia" }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
