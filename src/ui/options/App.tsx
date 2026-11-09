import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { generateKeyText, importKeyText } from "../../shared/crypto";
import { checkRepo } from "../../shared/github";
import { listBackups, loadKey, saveKey, type Backup } from "../../shared/idb";
import { createProfile, listProfiles, type Remote, type SyncProfile } from "../../shared/remote";
import { clearProfileSyncState, loadSettings, saveSettings } from "../../shared/settings";
import { restoreBackup } from "../../shared/sync";
import { errorMessage } from "../shared/errors";
import { formatWhen, plural } from "../shared/format";

type Stage = "loading" | "repo" | "key" | "ready";
type KeySource = "new" | "existing";

const STEPS = ["Repozytorium", "Klucz", "Profil"];
const TABS = { one: "karta", few: "karty", many: "kart" };
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

function Steps({ current }: { current: number }) {
  return (
    <nav class="steps" aria-label="Kroki">
      <p class="brand">Browser Tabs Sync</p>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step} aria-current={index === current ? "step" : undefined}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Layout({ step, children }: { step?: number; children: ComponentChildren }) {
  return (
    <div class="settings">
      {step !== undefined && <Steps current={step} />}
      <main class="settings-main">{children}</main>
    </div>
  );
}

export function OptionsApp() {
  const [stage, setStage] = useState<Stage>("loading");
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [keyText, setKeyText] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("new");
  const [keySaved, setKeySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [profiles, setProfiles] = useState<SyncProfile[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [currentProfile, setCurrentProfile] = useState("");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  function report(error: unknown) {
    setIsError(true);
    setMessage(errorMessage(error));
  }

  function fail(text: string) {
    setIsError(true);
    setMessage(text);
  }

  function clearMessage() {
    setMessage("");
    setIsError(false);
  }

  useEffect(() => {
    void (async () => {
      const [settings, stored, key] = await Promise.all([loadSettings(), listBackups(), loadKey()]);
      if (settings.owner && settings.repo) setRepository(`${settings.owner}/${settings.repo}`);
      setToken(settings.token ?? "");
      setDeviceName(settings.deviceName ?? "");
      setCurrentProfile(settings.profileName ?? "");
      setBackups(stored);
      setHasStoredKey(Boolean(key));
      if (!key || !settings.owner || !settings.repo || !settings.token || !settings.deviceName) {
        setStage("repo");
        return;
      }
      const connected = {
        key,
        config: { owner: settings.owner, repo: settings.repo, token: settings.token },
      };
      setRemote(connected);
      setStage("ready");
      try {
        setProfiles(await listProfiles(connected));
      } catch (error) {
        report(error);
      }
    })();
  }, []);

  function chooseKeySource(source: KeySource) {
    setKeySource(source);
    setKeySaved(false);
    setCopied(false);
    setKeyText(source === "new" ? generateKeyText() : "");
  }

  function parseRepository() {
    const [owner, repo] = repository.trim().split("/");
    return owner && repo ? { owner, repo, token: token.trim() } : null;
  }

  async function submitRepo(event: Event) {
    event.preventDefault();
    clearMessage();
    const config = parseRepository();
    if (!config) return fail("Podaj repozytorium w formacie owner/nazwa.");
    if (!deviceName.trim()) return fail("Podaj nazwę urządzenia.");
    setBusy(true);
    try {
      await checkRepo(config);
      chooseKeySource(hasStoredKey ? "existing" : "new");
      setStage("key");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function submitKey(event: Event) {
    event.preventDefault();
    clearMessage();
    const config = parseRepository();
    if (!config) return;
    setBusy(true);
    try {
      const key = await importKeyText(keyText);
      const candidate = { config, key };
      const found = await listProfiles(candidate);
      await saveKey(key);
      await saveSettings({ ...config, deviceName: deviceName.trim() });
      setHasStoredKey(true);
      setKeyText("");
      setRemote(candidate);
      setProfiles(found);
      setStage("ready");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function select(profile: SyncProfile) {
    await saveSettings({ profileId: profile.id, profileName: profile.name });
    await clearProfileSyncState();
    setCurrentProfile(profile.name);
    setIsError(false);
    setMessage(`Wybrano profil: ${profile.name}.`);
  }

  async function create(event: Event) {
    event.preventDefault();
    if (!remote || !newProfile.trim()) return;
    try {
      const profile = await createProfile(remote, newProfile.trim());
      setProfiles([...profiles, profile]);
      setNewProfile("");
      await select(profile);
    } catch (error) {
      report(error);
    }
  }

  async function restore(backup: Backup) {
    try {
      const failures = await restoreBackup(backup);
      setIsError(failures.length > 0);
      setMessage(
        failures.length
          ? `Nie przywrócono: ${failures.map((f) => f.url).join(", ")}`
          : "Przywrócono kopię.",
      );
    } catch (error) {
      report(error);
    }
  }

  const feedback = message && (
    <p class={isError ? "error" : "muted"} role={isError ? "alert" : "status"}>
      {message}
    </p>
  );

  if (stage === "loading") {
    return (
      <Layout>
        <p class="muted">Ładowanie…</p>
      </Layout>
    );
  }

  if (stage === "repo") {
    return (
      <Layout step={0}>
        <h1>Repozytorium na dane</h1>
        <p class="lead">
          Karty i ulubione trafiają w formie zaszyfrowanej do Twojego prywatnego repozytorium
          GitHub.
        </p>
        <form class="settings-main" onSubmit={submitRepo}>
          <label class="field">
            Repozytorium (owner/nazwa)
            <input
              class="input"
              value={repository}
              onInput={(e) => setRepository(e.currentTarget.value)}
            />
          </label>
          <label class="field">
            Token GitHub
            <input
              class="input"
              type="password"
              value={token}
              onInput={(e) => setToken(e.currentTarget.value)}
            />
          </label>
          <p class="hint">
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">
              Utwórz token
            </a>{" "}
            z dostępem tylko do tego repozytorium i uprawnieniem Contents: Read and write.
          </p>
          <label class="field">
            Nazwa urządzenia
            <input
              class="input"
              value={deviceName}
              onInput={(e) => setDeviceName(e.currentTarget.value)}
            />
          </label>
          <p class="hint">Zobaczysz ją przy zmianach pobieranych na innych komputerach.</p>
          {feedback}
          <div class="actions">
            <button class="button primary" type="submit" disabled={busy}>
              {busy ? "Sprawdzam…" : "Dalej: klucz"}
            </button>
            {remote && (
              <button
                class="button quiet"
                type="button"
                onClick={() => {
                  clearMessage();
                  setStage("ready");
                }}
              >
                Anuluj
              </button>
            )}
          </div>
        </form>
      </Layout>
    );
  }

  if (stage === "key") {
    const creating = keySource === "new";
    return (
      <Layout step={1}>
        <h1>Klucz szyfrowania</h1>
        <p class="lead">
          Tym kluczem szyfrujesz karty i ulubione. Na każdym kolejnym profilu wklejasz ten sam
          klucz.
        </p>
        <form class="settings-main" onSubmit={submitKey}>
          <fieldset class="segments">
            <legend class="vh">Skąd klucz</legend>
            <label>
              <input
                type="radio"
                name="key-source"
                checked={creating}
                onChange={() => chooseKeySource("new")}
              />
              Utwórz nowy
            </label>
            <label>
              <input
                type="radio"
                name="key-source"
                checked={!creating}
                onChange={() => chooseKeySource("existing")}
              />
              Mam już klucz
            </label>
          </fieldset>
          <div class="field">
            <label for="key">Klucz szyfrowania</label>
            <div class="input-row">
              <input
                id="key"
                class="input"
                {...(creating
                  ? { type: "text" as const, readOnly: true }
                  : { type: "password" as const })}
                autocomplete="off"
                spellcheck={false}
                value={keyText}
                onInput={(e) => setKeyText(e.currentTarget.value)}
              />
              {creating && (
                <button
                  class="button"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(keyText).then(() => setCopied(true))}
                >
                  {copied ? "Skopiowano" : "Kopiuj"}
                </button>
              )}
            </div>
          </div>
          {creating && (
            <>
              <p class="lead">
                Zapisz klucz w menedżerze haseł. Bez niego nikt, także Ty, nie odczyta tych danych.
              </p>
              <label class="check">
                <input
                  type="checkbox"
                  checked={keySaved}
                  onChange={(e) => setKeySaved(e.currentTarget.checked)}
                />
                Klucz jest już w menedżerze haseł
              </label>
            </>
          )}
          {feedback}
          <div class="actions">
            <button
              class="button primary"
              type="submit"
              disabled={busy || !keyText || (creating && !keySaved)}
            >
              {busy ? "Łączę…" : "Dalej: wybierz profil"}
            </button>
            <button
              class="button quiet"
              type="button"
              onClick={() => {
                clearMessage();
                setStage("repo");
              }}
            >
              Wstecz
            </button>
          </div>
        </form>
      </Layout>
    );
  }

  const profilePicker = (
    <>
      <div class="choices">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            class="choice"
            aria-pressed={profile.name === currentProfile}
            onClick={() => select(profile)}
          >
            {profile.name}
          </button>
        ))}
      </div>
      <form class="field" onSubmit={create}>
        <label for="new-profile">Nowy profil synchronizacji</label>
        <div class="input-row">
          <input
            id="new-profile"
            class="input"
            value={newProfile}
            onInput={(e) => setNewProfile(e.currentTarget.value)}
          />
          <button class="button" type="submit">
            Utwórz
          </button>
        </div>
      </form>
    </>
  );

  const { owner, repo } = remote?.config ?? {};

  return (
    <Layout {...(currentProfile ? {} : { step: 2 })}>
      {currentProfile ? (
        <>
          <h1>Ustawienia</h1>
          <p class="lead">
            Połączono z {owner}/{repo} jako {deviceName}.
          </p>
          <div class="actions">
            <button
              class="button"
              onClick={() => {
                clearMessage();
                setStage("repo");
              }}
            >
              Zmień połączenie
            </button>
          </div>
          <section class="section">
            <h2>Profil synchronizacji</h2>
            {profilePicker}
          </section>
        </>
      ) : (
        <>
          <h1>Profil synchronizacji</h1>
          <p class="lead">
            Profil to zestaw kart i ulubionych wspólny dla Twoich komputerów. Nazwa nie musi pasować
            do profilu w Chrome.
          </p>
          {profilePicker}
        </>
      )}
      {feedback}
      {backups.length > 0 && (
        <section class="section">
          <h2>Kopie lokalne</h2>
          {backups.map((backup) => (
            <div class="backup" key={backup.id}>
              <span>
                {formatWhen(backup.savedAt)}
                <span class="muted">
                  , {plural(backup.snapshot.windows.flatMap((w) => w.tabs).length, TABS)}
                </span>
              </span>
              <button class="button" onClick={() => restore(backup)}>
                Przywróć
              </button>
            </div>
          ))}
        </section>
      )}
    </Layout>
  );
}
