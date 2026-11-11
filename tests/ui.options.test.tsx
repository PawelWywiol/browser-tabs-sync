// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecryptError, generateKeyText } from "../src/shared/crypto";

const mocks = vi.hoisted(() => ({
  checkRepo: vi.fn(),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  saveKey: vi.fn(),
  loadKey: vi.fn(),
  listBackups: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  clearProfileSyncState: vi.fn(),
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
vi.mock("../src/shared/idb", () => ({
  saveKey: mocks.saveKey,
  loadKey: mocks.loadKey,
  listBackups: mocks.listBackups,
}));
vi.mock("../src/shared/settings", () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings,
  clearProfileSyncState: mocks.clearProfileSyncState,
}));
vi.mock("../src/shared/sync", () => ({ restoreBackup: mocks.restoreBackup }));

import { OptionsApp } from "../src/ui/options/App";

const fill = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function fillForm(key = generateKeyText()) {
  await screen.findByLabelText("Repozytorium (owner/nazwa)");
  fill("Repozytorium (owner/nazwa)", "o/r");
  fill("Token GitHub", "t");
  fill("Nazwa urządzenia", "Laptop");
  fireEvent.click(screen.getByRole("button", { name: "Dalej: klucz" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Mam już klucz" }));
  fill("Klucz szyfrowania", key);
}

const connected = {
  owner: "o",
  repo: "r",
  token: "t",
  deviceName: "Laptop",
  profileId: "p1",
  profileName: "Praca",
};

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
    await screen.findByLabelText("Repozytorium (owner/nazwa)");
    fill("Repozytorium (owner/nazwa)", "o/r");
    fill("Token GitHub", "t");
    fill("Nazwa urządzenia", "Laptop");
    fireEvent.click(screen.getByRole("button", { name: "Dalej: klucz" }));
    const field = (await screen.findByLabelText("Klucz szyfrowania")) as HTMLInputElement;
    expect(field.value).toHaveLength(43);
    const next = screen.getByRole("button", { name: "Dalej: wybierz profil" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Klucz jest już w menedżerze haseł"));
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("connects, lists profiles and stores the selection", async () => {
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Dalej: wybierz profil" }));
    fireEvent.click(await screen.findByRole("button", { name: "Praca" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p1", profileName: "Praca" }),
    );
    expect(mocks.saveKey).toHaveBeenCalled();
    expect(mocks.clearProfileSyncState).toHaveBeenCalled();
  });

  it("creates a new profile", async () => {
    mocks.createProfile.mockResolvedValue({ id: "p2", name: "Dom" });
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Dalej: wybierz profil" }));
    await screen.findByLabelText("Nowy profil synchronizacji");
    fill("Nowy profil synchronizacji", "Dom");
    fireEvent.click(screen.getByRole("button", { name: "Utwórz" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p2", profileName: "Dom" }),
    );
  });

  it("goes back to the repository step from profile selection", async () => {
    mocks.loadSettings.mockResolvedValue({ ...connected, profileId: "", profileName: "" });
    mocks.loadKey.mockResolvedValue({});
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Zmień połączenie" }));
    expect(await screen.findByLabelText("Repozytorium (owner/nazwa)")).toBeTruthy();
  });

  it("shows a wrong key error and does not save the key", async () => {
    mocks.listProfiles.mockRejectedValue(new DecryptError("nope"));
    render(<OptionsApp />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Dalej: wybierz profil" }));
    expect(await screen.findByText(/klucz/i, { selector: ".error" })).toBeTruthy();
    expect(mocks.saveKey).not.toHaveBeenCalled();
  });

  it("switches profiles on reopen without asking for the key", async () => {
    mocks.loadSettings.mockResolvedValue(connected);
    mocks.loadKey.mockResolvedValue({});
    mocks.listProfiles.mockResolvedValue([
      { id: "p1", name: "Praca" },
      { id: "p2", name: "Dom" },
    ]);
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Dom" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({ profileId: "p2", profileName: "Dom" }),
    );
    expect(screen.queryByLabelText("Klucz szyfrowania")).toBeNull();
  });

  it("restores a backup", async () => {
    const backup = { id: 1, savedAt: "2026-11-08T10:00:00Z", snapshot: { windows: [] } };
    mocks.listBackups.mockResolvedValue([backup]);
    mocks.loadSettings.mockResolvedValue(connected);
    mocks.loadKey.mockResolvedValue({});
    mocks.restoreBackup.mockResolvedValue([]);
    render(<OptionsApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Przywróć/ }));
    await waitFor(() => expect(mocks.restoreBackup).toHaveBeenCalledWith(backup));
  });
});
