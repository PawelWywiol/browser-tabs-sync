import { useEffect, useState } from "preact/hooks";
import { loadContext, send, type SendResult, type SyncContext } from "../../shared/sync";
import { errorMessage } from "../shared/errors";

const openPreview = () => chrome.tabs.create({ url: chrome.runtime.getURL("preview/index.html") });

export function PopupApp() {
  const [context, setContext] = useState<SyncContext | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [warning, setWarning] = useState<Extract<SendResult, { status: "newer" }> | null>(null);

  useEffect(() => {
    loadContext().then(setContext, (error) => {
      setContext(null);
      setIsError(true);
      setMessage(errorMessage(error));
    });
  }, []);

  async function runSend(force: boolean) {
    if (!context) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    setWarning(null);
    try {
      const result = await send(context, force);
      if (result.status === "sent") setMessage("Wysłano.");
      else setWarning(result);
    } catch (error) {
      setIsError(true);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (context === undefined) return <p>Ładowanie…</p>;
  if (context === null) {
    return (
      <main>
        {message && <p class="error">{message}</p>}
        <p>Rozszerzenie nie jest skonfigurowane.</p>
        <button onClick={() => chrome.runtime.openOptionsPage()}>Skonfiguruj</button>
      </main>
    );
  }

  return (
    <main>
      <p>
        Profil synchronizacji: <strong>{context.settings.profileName}</strong>
      </p>
      <button disabled={busy} onClick={() => runSend(false)}>
        Wyślij
      </button>{" "}
      <button disabled={busy} onClick={openPreview}>
        Pobierz
      </button>
      {warning && (
        <section>
          <p>
            {warning.deviceName} wysłał zmiany {new Date(warning.sentAt).toLocaleString("pl-PL")},
            których tu nie masz.
          </p>
          <button onClick={openPreview}>Najpierw pobierz</button>{" "}
          <button onClick={() => runSend(true)}>Nadpisz mimo to</button>{" "}
          <button onClick={() => setWarning(null)}>Anuluj</button>
        </section>
      )}
      {message && <p class={isError ? "error" : ""}>{message}</p>}
    </main>
  );
}
