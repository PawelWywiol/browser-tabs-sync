// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecryptError, generateKeyText } from "../src/shared/crypto";

const mocks = vi.hoisted(() => ({
  checkRepo: vi.fn(),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  saveKey: vi.fn(),
  listBackups: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearLastSeenSha: vi.fn(),
  restoreBackup: vi.fn(),
}));
vi.mock("../src/shared/github", async (original) => ({
  ...(await original<object>()),
  checkRepo: mocks.checkRepo,
}));
vi.mock("../src/shared/remote", () => ({
  listProfiles: mocks.listProfiles,
  createProfile: mocks.createProfile,
}));
vi.mock("../src/shared/idb", () => ({ saveKey: mocks.saveKey, listBackups: mocks.listBackups }));
vi.mock("../src/shared/settings", () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
  clearLastSeenSha: mocks.clearLastSeenSha,
}));
vi.mock("../src/shared/sync", () => ({ restoreBackup: mocks.restoreBackup }));

import { OptionsApp } from "../src/ui/options/App";

const fill = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function fillForm(key = generateKeyText()) {
  await screen.findByLabelText("Repozytorium (owner/nazwa)");
  fill("Repozytorium (owner/nazwa)", "o/r");
  fill("Token GitHub", "t");
  fill("Klucz szyfrowania", key);
  fill("Nazwa urządzenia", "Laptop");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadSettings.mockResolvedValue({});
  mocks.listBackups.mockResolvedValue([]);
  mocks.listProfiles.mockResolvedValue([{ id: "p1", name: "Praca" }]);
});
afterEach(cleanup);

describe("OptionsApp", () => {
  it("generates a key into the field", async () => {
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Wygeneruj klucz" }));
    expect((screen.getByLabelText("Klucz szyfrowania") as HTMLInputElement).value).toHaveLength(43);
  });

  it("connects, lists profiles and stores the selection", async () => {
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    fireEvent.click(await screen.findByRole("button", { name: "Praca" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p1", profileName: "Praca" }),
    );
    expect(mocks.saveKey).toHaveBeenCalled();
    expect(mocks.clearLastSeenSha).toHaveBeenCalled();
  });

  it("creates a new profile", async () => {
    mocks.createProfile.mockResolvedValue({ id: "p2", name: "Dom" });
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    await screen.findByLabelText("Nowy profil synchronizacji");
    fill("Nowy profil synchronizacji", "Dom");
    fireEvent.click(screen.getByRole("button", { name: "Utwórz" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p2", profileName: "Dom" }),
    );
  });

  it("shows a wrong key error and does not save the key", async () => {
    mocks.listProfiles.mockRejectedValue(new DecryptError("nope"));
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Połącz" }));
    expect(await screen.findByText(/klucz/i, { selector: ".error" })).toBeTruthy();
    expect(mocks.saveKey).not.toHaveBeenCalled();
  });

  it("restores a backup", async () => {
    const backup = { id: 1, savedAt: "2026-11-08T10:00:00Z", snapshot: {} };
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.restoreBackup.mockResolvedValue([]);
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Przywróć/ }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
  });
});
