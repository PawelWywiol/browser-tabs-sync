// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadContext: vi.fn(), send: vi.fn() }));
vi.mock("../src/shared/sync", () => mocks);

import { PopupApp } from "../src/ui/popup/App";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadContext.mockResolvedValue({ settings: { profileName: "Praca" } });
  vi.stubGlobal("chrome", {
    tabs: { create: vi.fn() },
    runtime: { getURL: (p: string) => p, openOptionsPage: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PopupApp", () => {
  it("prompts for setup when not configured", async () => {
    mocks.loadContext.mockResolvedValue(null);
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Skonfiguruj" }));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("shows the sync profile and reports a successful send", async () => {
    mocks.send.mockResolvedValue({ status: "sent" });
    render(<PopupApp />);
    expect(await screen.findByText(/Praca/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Wyślij karty/ }));
    expect(await screen.findByText("Wysłano.")).toBeTruthy();
  });

  it("warns about newer data and can overwrite", async () => {
    mocks.send.mockResolvedValueOnce({
      status: "newer",
      deviceName: "Laptop",
      sentAt: "2026-11-08T10:00:00Z",
    });
    mocks.send.mockResolvedValueOnce({ status: "sent" });
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Wyślij karty/ }));
    expect(await screen.findByText(/Laptop/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nadpisz mimo to" }));
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith(expect.anything(), true));
  });

  it("offers overwrite for invalid remote data but not pulling first", async () => {
    mocks.send.mockResolvedValueOnce({ status: "invalid" });
    mocks.send.mockResolvedValueOnce({ status: "sent" });
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Wyślij karty/ }));
    expect(await screen.findByText("Dane w repozytorium są nieprawidłowe.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Najpierw pobierz" })).toBeNull();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nadpisz mimo to" }));
    await waitFor(() => expect(mocks.send).toHaveBeenLastCalledWith(expect.anything(), true));
  });

  it("opens the preview page from the warning and from Pull", async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: /pobierz zmiany/ }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "preview/index.html" });
  });
});
