import { useEffect, useState } from "preact/hooks";
import { loadContext, send, type SendResult, type SyncContext } from "../../shared/sync";
import { errorMessage } from "../shared/errors";
import { formatWhen } from "../shared/format";

const openPreview = () => chrome.tabs.create({ url: chrome.runtime.getURL("preview/index.html") });
const openOptions = () => chrome.runtime.openOptionsPage();

export function PopupApp() {
  const [context, setContext] = useState<SyncContext | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<string | undefined>(undefined);
  const [warning, setWarning] = useState<Exclude<SendResult, { status: "sent" }> | null>(null);

  useEffect(() => {
    loadContext().then(
      (loaded) => {
        setContext(loaded);
        setLastSentAt(loaded?.settings.lastSentAt);
      },
      (error) => {
        setContext(null);
        setIsError(true);
        setMessage(errorMessage(error));
      },
    );
  }, []);

  async function runSend(force: boolean) {
    if (!context) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    setWarning(null);
    try {
      const result = await send(context, force);
      if (result.status === "sent") {
        setMessage("Wysłano.");
        setLastSentAt(new Date().toISOString());
      } else setWarning(result);
    } catch (error) {
      setIsError(true);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

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
        {message && (
          <p class="error" role="alert">
            {message}
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

  const { deviceName, profileName } = context.settings;

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

      {warning ? (
        <section class="notice">
          {warning.status === "newer" ? (
            <>
              <p>
                {warning.deviceName} wysłał zmiany {formatWhen(warning.sentAt)}, których tu nie
                masz.
              </p>
              <button class="button primary" onClick={openPreview}>
                Najpierw pobierz
              </button>
            </>
          ) : (
            <p>Dane w repozytorium są nieprawidłowe.</p>
          )}
          <button class="button danger" onClick={() => runSend(true)}>
            Nadpisz mimo to
          </button>
          <button class="button quiet" onClick={() => setWarning(null)}>
            Anuluj
          </button>
        </section>
      ) : (
        <div class="popup-actions">
          <button class="button primary" disabled={busy} onClick={() => runSend(false)}>
            {busy ? "Wysyłam…" : "Wyślij karty z tego komputera"}
          </button>
          <button class="button" disabled={busy} onClick={openPreview}>
            Sprawdź i pobierz zmiany
          </button>
        </div>
      )}
      {message && (
        <p class={isError ? "error" : "muted"} role={isError ? "alert" : "status"}>
          {message}
        </p>
      )}
    </main>
  );
}
