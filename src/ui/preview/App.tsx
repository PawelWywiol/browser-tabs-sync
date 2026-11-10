import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ApplyFailure } from "../../shared/apply";
import { listBackups } from "../../shared/idb";
import {
  loadContext,
  loadPull,
  restoreBackup,
  runPull,
  type PullPlan,
  type SyncContext,
} from "../../shared/sync";
import { errorMessage } from "../shared/errors";
import { formatWhen, plural } from "../shared/format";
import { ChangeList, toggled } from "../shared/review";

type Phase = "loading" | "empty" | "ready" | "applying" | "done";

const TABS = { one: "kartę", few: "karty", many: "kart" };
const FAVORITES = { one: "ulubioną", few: "ulubione", many: "ulubionych" };
const CHANGES = { one: "zmianę", few: "zmiany", many: "zmian" };

function State({ children }: { children: ComponentChildren }) {
  return (
    <main class="page">
      <div class="state">{children}</div>
    </main>
  );
}

export function PreviewApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [context, setContext] = useState<SyncContext | null>(null);
  const [plan, setPlan] = useState<PullPlan | null>(null);
  const [failures, setFailures] = useState<ApplyFailure[]>([]);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const selected = useSignal<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await loadContext();
        if (!loaded) throw new Error("Rozszerzenie nie jest skonfigurowane.");
        setContext(loaded);
        const pulled = await loadPull(loaded);
        if (!pulled) {
          setPhase("empty");
          return;
        }
        setPlan(pulled);
        selected.value = new Set(
          [...pulled.changes.tabs, ...pulled.changes.bookmarks].map((c) => c.id),
        );
        setPhase("ready");
      } catch (caught) {
        setError(errorMessage(caught));
        setPhase("empty");
      }
    })();
  }, []);

  function setChecked(ids: string[], checked: boolean) {
    selected.value = toggled(selected.value, ids, checked);
  }

  async function confirm() {
    if (!context || !plan) return;
    setPhase("applying");
    setError("");
    try {
      setFailures(await runPull(context, plan, selected.value));
      setPhase("done");
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase("ready");
    }
  }

  async function restore() {
    setRestored(false);
    try {
      const [latest] = await listBackups();
      if (!latest) {
        setError("Brak kopii do przywrócenia.");
        return;
      }
      const failed = await restoreBackup(latest);
      if (failed.length > 0) {
        setError(`Nie przywrócono: ${failed.map((failure) => failure.url).join(", ")}`);
        return;
      }
      setError("");
      setRestored(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const errorLine = error && (
    <p class="error" role="alert">
      {error}
    </p>
  );

  if (phase === "loading") {
    return (
      <State>
        <p class="muted">Ładowanie…</p>
      </State>
    );
  }
  if (phase === "empty") {
    return (
      <State>
        {error ? (
          <>
            <h1>Nie można pobrać zmian</h1>
            {errorLine}
            <button class="button" onClick={() => chrome.runtime.openOptionsPage()}>
              Otwórz ustawienia
            </button>
          </>
        ) : (
          <>
            <h1>Brak danych do pobrania</h1>
            <p class="muted">Wyślij karty z innego komputera, a pojawią się tutaj.</p>
          </>
        )}
      </State>
    );
  }
  if (!plan) return null;

  if (phase === "done") {
    return (
      <State>
        {failures.length === 0 ? (
          <>
            <h1>Gotowe.</h1>
            <p class="muted">Poprzedni układ jest w kopiach lokalnych w ustawieniach.</p>
          </>
        ) : (
          <>
            <h1>Część zmian pominięto</h1>
            <ul>
              {failures.map((failure, index) => (
                <li key={index}>
                  {failure.url}: {failure.message}
                </li>
              ))}
            </ul>
            <button class="button" onClick={restore}>
              Przywróć kopię
            </button>
            {restored && (
              <p class="muted" role="status">
                Przywrócono kopię.
              </p>
            )}
          </>
        )}
        {errorLine}
      </State>
    );
  }

  const { tabs, bookmarks } = plan.changes;
  const applying = phase === "applying";

  if (tabs.length === 0 && bookmarks.length === 0) {
    return (
      <State>
        <h1>Karty i ulubione są aktualne</h1>
        <p class="muted">Brak zmian. Układ kart i grup zostanie dopasowany po zatwierdzeniu.</p>
        <button class="button primary" disabled={applying} onClick={confirm}>
          Zastosuj
        </button>
        {errorLine}
      </State>
    );
  }

  const isChecked = (id: string) => selected.value.has(id);
  const chosen = (items: { id: string }[]) => items.filter((item) => isChecked(item.id)).length;
  const opens = chosen(tabs.filter((t) => t.kind === "open"));
  const closes = chosen(tabs.filter((t) => t.kind === "close"));
  const favorites = chosen(bookmarks);
  const summary =
    [
      opens > 0 && `otworzy ${plural(opens, TABS)}`,
      closes > 0 && `zamknie ${plural(closes, TABS)}`,
      favorites > 0 && `zmieni ${plural(favorites, FAVORITES)}`,
    ]
      .filter(Boolean)
      .join(", ") || "dopasuje tylko układ kart";

  return (
    <>
      <ChangeList
        header={
          <>
            <div class="bar-text">
              <h1>Zmiany z komputera {plan.snapshot.deviceName}</h1>
              <p class="muted">
                {summary[0]!.toUpperCase() + summary.slice(1)}. Wysłano{" "}
                {formatWhen(plan.snapshot.sentAt)}.
              </p>
            </div>
            <button class="button primary" disabled={applying} onClick={confirm}>
              {applying ? "Stosuję…" : `Zastosuj ${plural(opens + closes + favorites, CHANGES)}`}
            </button>
          </>
        }
        changes={plan.changes}
        localWindowCount={plan.local.windows.length}
        isChecked={isChecked}
        setChecked={setChecked}
      >
        {errorLine}
      </ChangeList>
    </>
  );
}
