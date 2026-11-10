import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ChangeSet } from "../../shared/diff";
import { pickSelected, sendableItems } from "../../shared/selection";
import { capture } from "../../shared/snapshot";
import { loadContext, send, type SendResult, type SyncContext } from "../../shared/sync";
import type { BrowserState } from "../../shared/types";
import { errorMessage } from "../shared/errors";
import { formatWhen, plural } from "../shared/format";
import { ChangeList, toggled } from "../shared/review";

type Loaded = { context: SyncContext; state: BrowserState; items: ChangeSet };

const TABS = { one: "kartę", few: "karty", many: "kart" };
const FAVORITES = { one: "ulubioną", few: "ulubione", many: "ulubionych" };

function State({ children }: { children: ComponentChildren }) {
  return (
    <main class="page">
      <div class="state">{children}</div>
    </main>
  );
}

export function SendApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<Exclude<SendResult, { status: "sent" }> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const context = await loadContext();
        if (!context) {
          setError("Rozszerzenie nie jest skonfigurowane.");
          return;
        }
        const state = await capture();
        const items = sendableItems(state);
        setLoaded({ context, state, items });
        setSelected(new Set([...items.tabs, ...items.bookmarks].map((item) => item.id)));
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runSend(force: boolean) {
    if (!loaded) return;
    setBusy(true);
    setError("");
    setWarning(null);
    try {
      const result = await send(loaded.context, pickSelected(loaded.state, selected), force);
      if (result.status === "sent") setSent(true);
      else setWarning(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p class="error" role="alert">
      {error}
    </p>
  );

  if (loading) {
    return (
      <State>
        <p class="muted">Ładowanie…</p>
      </State>
    );
  }
  if (!loaded) {
    return (
      <State>
        <h1>Nie można przygotować wysyłki</h1>
        {errorLine}
        <button class="button" onClick={() => chrome.runtime.openOptionsPage()}>
          Otwórz ustawienia
        </button>
      </State>
    );
  }
  if (sent) {
    return (
      <State>
        <h1>Wysłano.</h1>
      </State>
    );
  }

  const { context, items } = loaded;
  if (items.tabs.length === 0 && items.bookmarks.length === 0) {
    return (
      <State>
        <h1>Nie ma nic do wysłania</h1>
        <p class="muted">Otwórz karty albo dodaj ulubione, a pojawią się tutaj.</p>
      </State>
    );
  }

  const isChecked = (id: string) => selected.has(id);
  const tabs = items.tabs.filter((tab) => isChecked(tab.id)).length;
  const favorites = items.bookmarks.filter((bookmark) => isChecked(bookmark.id)).length;

  return (
    <>
      <ChangeList
        header={
          <>
            <div class="bar-text">
              <h1>Wysyłka do profilu {context.settings.profileName}</h1>
              <p class="muted">
                Wyślesz {plural(tabs, TABS)} i {plural(favorites, FAVORITES)}. Odznaczone nie trafią
                do profilu.
              </p>
            </div>
            <button
              class="button primary"
              disabled={busy || tabs + favorites === 0}
              onClick={() => runSend(false)}
            >
              {busy ? "Wysyłam…" : "Wyślij zaznaczone"}
            </button>
          </>
        }
        changes={items}
        localWindowCount={loaded.state.windows.length}
        verb="Wyślij"
        isChecked={isChecked}
        setChecked={(ids, checked) => setSelected(toggled(selected, ids, checked))}
      >
        {errorLine}
        {warning && (
          <section class="notice">
            {warning.status === "newer" ? (
              <>
                <p>
                  {warning.deviceName} wysłał zmiany {formatWhen(warning.sentAt)}, których tu nie
                  masz.
                </p>
                <button
                  class="button primary"
                  onClick={() =>
                    chrome.tabs.create({ url: chrome.runtime.getURL("preview/index.html") })
                  }
                >
                  Najpierw pobierz
                </button>
              </>
            ) : (
              <p>Dane w repozytorium są nieprawidłowe.</p>
            )}
            <button class="button danger" disabled={busy} onClick={() => runSend(true)}>
              Nadpisz mimo to
            </button>
            <button class="button quiet" onClick={() => setWarning(null)}>
              Anuluj
            </button>
          </section>
        )}
      </ChangeList>
    </>
  );
}
