// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadContext: vi.fn() }));
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

  it("shows the sync profile and opens the send review", async () => {
    render(<PopupApp />);
    expect(await screen.findByText(/Praca/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /wyślij karty/ }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "send/index.html" });
  });

  it("opens the pull preview", async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: /pobierz zmiany/ }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "preview/index.html" });
  });
});
