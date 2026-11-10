import { useEffect, useState } from "preact/hooks";
import { loadContext, type SyncContext } from "../../shared/sync";
import { errorMessage } from "../shared/errors";
import { formatWhen } from "../shared/format";

const openPage = (page: string) =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`${page}/index.html`) });
const openOptions = () => chrome.runtime.openOptionsPage();

export function PopupApp() {
  const [context, setContext] = useState<SyncContext | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    loadContext().then(setContext, (caught) => {
      setContext(null);
      setError(errorMessage(caught));
    });
  }, []);

  if (context === undefined) {
    return (
      <main class="popup">
        <p class="muted">Ładowanie…</p>
      </main>
    );
  }
  if (context === null) {
    return (
      <main class="popup">
        <h1>Browser Tabs Sync</h1>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <p class="muted">Połącz rozszerzenie z repozytorium, aby wysyłać i pobierać karty.</p>
        <div class="popup-actions">
          <button class="button primary" onClick={openOptions}>
            Skonfiguruj
          </button>
        </div>
      </main>
    );
  }

  const { deviceName, profileName, lastSentAt } = context.settings;

  return (
    <main class="popup">
      <header class="popup-head">
        <div>
          <h1>{profileName}</h1>
          <p class="muted">
            {deviceName}
            {lastSentAt && `, wysłano ${formatWhen(lastSentAt)}`}
          </p>
        </div>
        <button class="icon-button" aria-label="Ustawienia" onClick={openOptions}>
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          >
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </button>
      </header>

      <div class="popup-actions">
        <button class="button primary" onClick={() => openPage("send")}>
          Wybierz i wyślij karty
        </button>
        <button class="button" onClick={() => openPage("preview")}>
          Sprawdź i pobierz zmiany
        </button>
      </div>
    </main>
  );
}
