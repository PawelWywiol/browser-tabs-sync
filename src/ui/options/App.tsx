import { useEffect, useState } from "preact/hooks";
import { generateKeyText, importKeyText } from "../../shared/crypto";
import { checkRepo } from "../../shared/github";
import { listBackups, saveKey, type Backup } from "../../shared/idb";
import { createProfile, listProfiles, type Remote, type SyncProfile } from "../../shared/remote";
import { clearLastSeenSha, loadSettings, saveSettings } from "../../shared/settings";
import { restoreBackup } from "../../shared/sync";
import { errorMessage } from "../shared/errors";

export function OptionsApp() {
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [keyText, setKeyText] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [profiles, setProfiles] = useState<SyncProfile[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [currentProfile, setCurrentProfile] = useState("");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([loadSettings(), listBackups()]).then(([settings, stored]) => {
      if (settings.owner && settings.repo) setRepository(`${settings.owner}/${settings.repo}`);
      setToken(settings.token ?? "");
      setDeviceName(settings.deviceName ?? "");
      setCurrentProfile(settings.profileName ?? "");
      setBackups(stored);
      setReady(true);
    });
  }, []);

  function report(error: unknown) {
    setIsError(true);
    setMessage(errorMessage(error));
  }

  async function connect(event: Event) {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    const [owner, repo] = repository.trim().split("/");
    if (!owner || !repo) {
      setIsError(true);
      setMessage("Podaj repozytorium w formacie owner/nazwa.");
      return;
    }
    try {
      const key = await importKeyText(keyText);
      const config = { owner, repo, token: token.trim() };
      await checkRepo(config);
      const candidate = { config, key };
      const found = await listProfiles(candidate);
      await saveKey(key);
      await saveSettings({ owner, repo, token: config.token, deviceName: deviceName.trim() });
      setRemote(candidate);
      setProfiles(found);
    } catch (error) {
      report(error);
    }
  }

  async function select(profile: SyncProfile) {
    await saveSettings({ profileId: profile.id, profileName: profile.name });
    await clearLastSeenSha();
    setCurrentProfile(profile.name);
    setIsError(false);
    setMessage(`Wybrano profil: ${profile.name}.`);
  }

  async function create() {
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

  if (!ready) return <p>Ładowanie…</p>;

  return (
    <main>
      <h1>Konfiguracja</h1>
      <form onSubmit={connect}>
        <label>
          Repozytorium (owner/nazwa)
          <input value={repository} onInput={(e) => setRepository(e.currentTarget.value)} />
        </label>
        <label>
          Token GitHub
          <input type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
        </label>
        <label>
          Klucz szyfrowania
          <input value={keyText} onInput={(e) => setKeyText(e.currentTarget.value)} />
        </label>
        <button type="button" onClick={() => setKeyText(generateKeyText())}>
          Wygeneruj klucz
        </button>
        <p>Klucz zapisz w menedżerze haseł. Utrata klucza oznacza utratę danych.</p>
        <label>
          Nazwa urządzenia
          <input value={deviceName} onInput={(e) => setDeviceName(e.currentTarget.value)} />
        </label>
        <button type="submit">Połącz</button>
      </form>

      {remote && (
        <section>
          <h2>Profil synchronizacji</h2>
          {currentProfile && <p>Obecny: {currentProfile}</p>}
          {profiles.map((profile) => (
            <button key={profile.id} onClick={() => select(profile)}>
              {profile.name}
            </button>
          ))}
          <label>
            Nowy profil synchronizacji
            <input value={newProfile} onInput={(e) => setNewProfile(e.currentTarget.value)} />
          </label>
          <button onClick={create}>Utwórz</button>
        </section>
      )}

      {backups.length > 0 && (
        <section>
          <h2>Kopie lokalne</h2>
          {backups.map((backup) => (
            <button key={backup.id} onClick={() => restore(backup)}>
              Przywróć {new Date(backup.savedAt).toLocaleString("pl-PL")}
            </button>
          ))}
        </section>
      )}

      {message && <p class={isError ? "error" : ""}>{message}</p>}
    </main>
  );
}
