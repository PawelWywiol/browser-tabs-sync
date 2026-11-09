import { useSignal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import type { ApplyFailure } from "../../shared/apply";
import type { BookmarkChange, TabChange } from "../../shared/diff";
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

type Phase = "loading" | "empty" | "ready" | "applying" | "done";

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
    const next = new Set(selected.value);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selected.value = next;
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
    const [latest] = await listBackups();
    if (!latest) return;
    try {
      await restoreBackup(latest);
      setRestored(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (phase === "loading") return <p>Ładowanie…</p>;
  if (phase === "empty")
    return error ? <p class="error">{error}</p> : <p>Brak danych do pobrania w tym profilu.</p>;
  if (!plan) return null;

  if (phase === "done") {
    return (
      <main>
        {failures.length === 0 ? (
          <p>Gotowe.</p>
        ) : (
          <section>
            <p>Część zmian pominięto:</p>
            <ul>
              {failures.map((failure, index) => (
                <li key={index}>
                  {failure.url}: {failure.message}
                </li>
              ))}
            </ul>
            <button onClick={restore}>Przywróć kopię</button>
            {restored && <p>Przywrócono kopię.</p>}
          </section>
        )}
        {error && <p class="error">{error}</p>}
      </main>
    );
  }

  const { tabs, bookmarks } = plan.changes;
  const opens = tabs.filter((t) => t.kind === "open");
  const closes = tabs.filter((t) => t.kind === "close");
  const isChecked = (id: string) => selected.value.has(id);

  if (tabs.length === 0 && bookmarks.length === 0) {
    return (
      <main>
        <p>Brak zmian. Układ kart i grup zostanie dopasowany po zatwierdzeniu.</p>
        <button disabled={phase === "applying"} onClick={confirm}>
          Zastosuj
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Pobierz zmiany</h1>
      <p>
        Wysłane z: <strong>{plan.snapshot.deviceName}</strong>,{" "}
        {new Date(plan.snapshot.sentAt).toLocaleString("pl-PL")}
      </p>
      <TabSection
        heading="Karty do otwarcia"
        action="otwarcie"
        items={opens}
        isChecked={isChecked}
        setChecked={setChecked}
      />
      <TabSection
        heading="Karty do zamknięcia"
        action="zamknięcie"
        items={closes}
        isChecked={isChecked}
        setChecked={setChecked}
      />
      <BookmarkSection items={bookmarks} isChecked={isChecked} setChecked={setChecked} />
      <button disabled={phase === "applying"} onClick={confirm}>
        Zastosuj
      </button>
      {error && <p class="error">{error}</p>}
    </main>
  );
}

type CheckProps = {
  isChecked: (id: string) => boolean;
  setChecked: (ids: string[], checked: boolean) => void;
};

function GroupToggle({
  label,
  ids,
  isChecked,
  setChecked,
}: CheckProps & { label: string; ids: string[] }) {
  return (
    <label>
      <input
        type="checkbox"
        checked={ids.every(isChecked)}
        onChange={(e) => setChecked(ids, e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function Item({
  id,
  title,
  url,
  isChecked,
  setChecked,
}: CheckProps & { id: string; title: string; url: string }) {
  return (
    <label>
      <input
        type="checkbox"
        checked={isChecked(id)}
        onChange={(e) => setChecked([id], e.currentTarget.checked)}
      />
      {title} {url}
    </label>
  );
}

function TabSection({
  heading,
  action,
  items,
  ...check
}: CheckProps & { heading: string; action: string; items: TabChange[] }) {
  if (items.length === 0) return null;
  const windows = [...new Set(items.map((t) => t.windowIndex))];
  return (
    <section>
      <h2>
        {heading} ({items.length})
      </h2>
      {windows.map((windowIndex) => {
        const inWindow = items.filter((t) => t.windowIndex === windowIndex);
        const groups = [...new Set(inWindow.map((t) => t.groupTitle))];
        return (
          <fieldset key={windowIndex}>
            <legend>
              <GroupToggle
                label={`Okno ${windowIndex + 1} (${action})`}
                ids={inWindow.map((t) => t.id)}
                {...check}
              />
            </legend>
            {groups.map((groupTitle) => {
              const inGroup = inWindow.filter((t) => t.groupTitle === groupTitle);
              return (
                <div key={groupTitle ?? ""}>
                  {groupTitle !== undefined && (
                    <GroupToggle
                      label={`Grupa: ${groupTitle} (${action})`}
                      ids={inGroup.map((t) => t.id)}
                      {...check}
                    />
                  )}
                  {inGroup.map((tab) => (
                    <Item key={tab.id} id={tab.id} title={tab.title} url={tab.url} {...check} />
                  ))}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
}

function BookmarkSection({ items, ...check }: CheckProps & { items: BookmarkChange[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2>Ulubione do zmiany ({items.length})</h2>
      {items.map((item) => (
        <Item
          key={item.id}
          id={item.id}
          title={`${item.kind === "add" ? "Dodaj" : "Usuń"}: ${[...item.path, item.title].join(" / ")}`}
          url={item.url ?? ""}
          {...check}
        />
      ))}
    </section>
  );
}
