import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ApplyFailure } from "../../shared/apply";
import type { BookmarkChange, ChangeSet, TabChange } from "../../shared/diff";
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
import { formatWhen, hostOf, plural } from "../shared/format";

type Phase = "loading" | "empty" | "ready" | "applying" | "done";
type GroupView = { title: string | undefined; color: string | undefined; tabs: TabChange[] };
type WindowView = { slot: number; label: string; groups: GroupView[] };

const TABS = { one: "kartę", few: "karty", many: "kart" };
const FAVORITES = { one: "ulubioną", few: "ulubione", many: "ulubionych" };
const CHANGES = { one: "zmianę", few: "zmiany", many: "zmian" };

export function buildWindows(changes: ChangeSet, localWindowCount: number): WindowView[] {
  const slots = new Map<number, Map<string | undefined, GroupView>>();
  for (const tab of changes.tabs) {
    const pair = changes.windowPairs[tab.windowIndex] ?? -1;
    const slot =
      tab.kind === "close"
        ? tab.windowIndex
        : pair >= 0
          ? pair
          : localWindowCount + tab.windowIndex;
    const groups = slots.get(slot) ?? new Map<string | undefined, GroupView>();
    slots.set(slot, groups);
    const group = groups.get(tab.groupTitle) ?? {
      title: tab.groupTitle,
      color: tab.groupColor,
      tabs: [],
    };
    groups.set(tab.groupTitle, group);
    group.tabs.push(tab);
  }
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, groups]) => ({
      slot,
      label: slot < localWindowCount ? `Okno ${slot + 1}` : "Nowe okno",
      groups: [...groups.values()].sort(
        (a, b) => Number(a.title === undefined) - Number(b.title === undefined),
      ),
    }));
}

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
  const check = { isChecked, setChecked };

  return (
    <>
      <header class="bar">
        <div class="bar-inner">
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
        </div>
      </header>
      <main class="page">
        {errorLine}
        {buildWindows(plan.changes, plan.local.windows.length).map((view) => (
          <section class="window" key={view.slot}>
            <div class="heading-row">
              <h2>{view.label}</h2>
              <Toggle
                text="Całe okno"
                label={`Całe okno: ${view.label}`}
                ids={view.groups.flatMap((g) => g.tabs.map((t) => t.id))}
                {...check}
              />
            </div>
            {view.groups.map((group) => (
              <Group key={group.title ?? ""} group={group} {...check} />
            ))}
          </section>
        ))}
        {bookmarks.length > 0 && (
          <section class="bookmarks">
            <div class="heading-row">
              <h2>Ulubione</h2>
              <Toggle
                text="Wszystkie"
                label="Wszystkie ulubione"
                ids={bookmarks.map((b) => b.id)}
                {...check}
              />
            </div>
            {bookmarks.map((item) => (
              <BookmarkRow key={item.id} item={item} {...check} />
            ))}
          </section>
        )}
      </main>
    </>
  );
}

type CheckProps = {
  isChecked: (id: string) => boolean;
  setChecked: (ids: string[], checked: boolean) => void;
};

function Toggle({
  text,
  label,
  ids,
  isChecked,
  setChecked,
}: CheckProps & { text: string; label: string; ids: string[] }) {
  const all = ids.every(isChecked);
  return (
    <label class="toggle">
      <span aria-hidden="true">{text}</span>
      <input
        type="checkbox"
        aria-label={label}
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = !all && ids.some(isChecked);
        }}
        onChange={(e) => setChecked(ids, e.currentTarget.checked)}
      />
    </label>
  );
}

function Group({ group, ...check }: CheckProps & { group: GroupView }) {
  const grouped = group.title !== undefined;
  const name = grouped ? group.title || "Grupa bez nazwy" : "Bez grupy";
  const color = grouped ? (group.color ?? "grey") : undefined;
  return (
    <div class="group">
      <div class="heading-row">
        <span class="chip" data-color={color}>
          {name}
        </span>
        <Toggle
          text="Cała grupa"
          label={`Cała grupa: ${name}`}
          ids={group.tabs.map((t) => t.id)}
          {...check}
        />
      </div>
      <div class="group-body">
        <div class="rail" data-color={color} aria-hidden="true" />
        <div class="rows">
          {group.tabs.map((tab) => (
            <Row
              key={tab.id}
              id={tab.id}
              adds={tab.kind === "open"}
              verb={tab.kind === "open" ? "Otwórz" : "Zamknij"}
              title={tab.title || hostOf(tab.url)}
              url={tab.url}
              letter
              {...check}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BookmarkRow({ item, ...check }: CheckProps & { item: BookmarkChange }) {
  return (
    <Row
      id={item.id}
      adds={item.kind === "add"}
      verb={item.kind === "add" ? "Dodaj" : "Usuń"}
      title={[...item.path, item.title].join(" / ")}
      url={item.url ?? ""}
      {...check}
    />
  );
}

function Row({
  id,
  adds,
  verb,
  title,
  url,
  letter = false,
  isChecked,
  setChecked,
}: CheckProps & {
  id: string;
  adds: boolean;
  verb: string;
  title: string;
  url: string;
  letter?: boolean;
}) {
  const host = url ? hostOf(url) : "";
  const on = isChecked(id);
  return (
    <label class={on ? "row" : "row off"}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setChecked([id], e.currentTarget.checked)}
      />
      <span class={adds ? "sign" : "sign close"} aria-hidden="true">
        {adds ? "+" : "−"}
      </span>
      <span class="vh">{verb} </span>
      {letter && (
        <span class="letter" aria-hidden="true">
          {host[0]?.toUpperCase()}
        </span>
      )}
      <span class="row-title">{title} </span>
      <span class="row-host">{host}</span>
    </label>
  );
}
