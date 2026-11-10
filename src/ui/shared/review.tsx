import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { BookmarkChange, ChangeSet, TabChange } from "../../shared/diff";
import type { FolderType } from "../../shared/types";
import { hostOf } from "./format";

type GroupView = { title: string | undefined; color: string | undefined; tabs: TabChange[] };
type WindowView = { slot: number; label: string; groups: GroupView[] };
type FolderView = { name: string; children: BookmarkView[] };
type BookmarkView = FolderView | BookmarkChange;

const ROOT_FOLDER_NAMES: Record<FolderType, string> = {
  "bookmarks-bar": "Pasek zakładek",
  other: "Inne zakładki",
  mobile: "Zakładki mobilne",
};
const isFolder = (view: BookmarkView): view is FolderView => "children" in view;

export type CheckProps = {
  isChecked: (id: string) => boolean;
  setChecked: (ids: string[], checked: boolean) => void;
};
type RowProps = CheckProps & { open: (url: string, incognito: boolean) => void };

async function openLink(url: string, incognito: boolean): Promise<void> {
  if (incognito) await chrome.windows.create({ url, incognito: true });
  else await chrome.tabs.create({ url, active: false });
}

const matches = (fields: (string | undefined)[], terms: string[]) => {
  const text = fields.join(" ").toLowerCase();
  return terms.every((term) => text.includes(term));
};

const faviconUrl = (url: string) =>
  chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

export function toggled(
  current: ReadonlySet<string>,
  ids: string[],
  checked: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

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

function buildBookmarkTree(items: BookmarkChange[]): FolderView[] {
  const top: FolderView = { name: "", children: [] };
  for (const item of items) {
    let folder = top;
    for (const name of [ROOT_FOLDER_NAMES[item.folderType], ...item.path]) {
      let next = folder.children.find((c): c is FolderView => isFolder(c) && c.name === name);
      if (!next) {
        next = { name, children: [] };
        folder.children.push(next);
      }
      folder = next;
    }
    folder.children.push(item);
  }
  return top.children.filter(isFolder);
}

const bookmarkIds = (views: BookmarkView[]): string[] =>
  views.flatMap((view) => (isFolder(view) ? bookmarkIds(view.children) : [view.id]));

export function ChangeList({
  header,
  children,
  changes,
  localWindowCount,
  verb,
  ...check
}: CheckProps & {
  header: ComponentChildren;
  children: ComponentChildren;
  changes: ChangeSet;
  localWindowCount: number;
  verb?: string;
}) {
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState("");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tabs = changes.tabs.filter((t) => matches([t.title, t.url, t.groupTitle], terms));
  const bookmarks = changes.bookmarks.filter((b) => matches([b.title, b.url, ...b.path], terms));

  function open(url: string, incognito: boolean) {
    setOpenError("");
    openLink(url, incognito).catch(() => setOpenError(`Nie udało się otworzyć: ${url}`));
  }

  return (
    <>
      <header class="bar">
        <div class="bar-inner">{header}</div>
        <div class="search">
          <input
            class="input"
            type="search"
            aria-label="Szukaj kart i ulubionych"
            placeholder="Szukaj po nazwie, adresie, grupie lub folderze"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {terms.length > 0 && (
            <p class="muted" role="status">
              Pokazano {tabs.length + bookmarks.length} z{" "}
              {changes.tabs.length + changes.bookmarks.length}. Ukryte pozycje zachowują
              zaznaczenie.
            </p>
          )}
        </div>
      </header>
      <main class="page">
        {children}
        {openError && (
          <p class="error" role="alert">
            {openError}
          </p>
        )}
        {buildWindows({ ...changes, tabs }, localWindowCount).map((view) => (
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
              <Group key={group.title ?? ""} group={group} verb={verb} open={open} {...check} />
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
            {buildBookmarkTree(bookmarks).map((folder) => (
              <BookmarkFolder
                key={folder.name}
                folder={folder}
                trail={[]}
                verb={verb}
                open={open}
                {...check}
              />
            ))}
          </section>
        )}
      </main>
    </>
  );
}

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

function Group({
  group,
  verb,
  ...check
}: RowProps & { group: GroupView; verb: string | undefined }) {
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
              verb={verb ?? (tab.kind === "open" ? "Otwórz" : "Zamknij")}
              title={tab.title || hostOf(tab.url)}
              url={tab.url}
              pinned={tab.pinned}
              {...check}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BookmarkFolder({
  folder,
  trail,
  verb,
  ...row
}: RowProps & { folder: FolderView; trail: string[]; verb: string | undefined }) {
  const path = [...trail, folder.name];
  return (
    <div class="folder">
      <div class="heading-row">
        <span class="folder-name">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          >
            <path d="M3 6a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
          </svg>
          <span>{folder.name}</span>
        </span>
        <Toggle
          text="Cały folder"
          label={`Cały folder: ${path.join(" / ")}`}
          ids={bookmarkIds(folder.children)}
          {...row}
        />
      </div>
      <div class="folder-body">
        {folder.children.map((child) =>
          isFolder(child) ? (
            <BookmarkFolder
              key={`folder:${child.name}`}
              folder={child}
              trail={path}
              verb={verb}
              {...row}
            />
          ) : (
            <BookmarkRow key={child.id} item={child} verb={verb} {...row} />
          ),
        )}
      </div>
    </div>
  );
}

function BookmarkRow({
  item,
  verb,
  ...check
}: RowProps & { item: BookmarkChange; verb: string | undefined }) {
  return (
    <Row
      id={item.id}
      adds={item.kind === "add"}
      verb={verb ?? (item.kind === "add" ? "Dodaj" : "Usuń")}
      title={item.title || hostOf(item.url ?? "")}
      url={item.url ?? ""}
      {...check}
    />
  );
}

function OpenButton({
  action,
  title,
  onClick,
  children,
}: {
  action: string;
  title: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      class="icon-button"
      type="button"
      aria-label={`${action}: ${title}`}
      title={action}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

function Row({
  id,
  adds,
  verb,
  title,
  url,
  pinned = false,
  isChecked,
  setChecked,
  open,
}: RowProps & {
  id: string;
  adds: boolean;
  verb: string;
  title: string;
  url: string;
  pinned?: boolean | undefined;
}) {
  const host = url ? hostOf(url) : "";
  const on = isChecked(id);
  return (
    <div class={on ? "row" : "row off"}>
      <label class="row-main" title={url}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setChecked([id], e.currentTarget.checked)}
        />
        <span class={adds ? "sign" : "sign close"} aria-hidden="true">
          {adds ? "+" : "−"}
        </span>
        <span class="vh">{verb} </span>
        {url && (
          <img class="favicon" src={faviconUrl(url)} alt="" width="20" height="20" loading="lazy" />
        )}
        <span class="row-title">{title} </span>
        {pinned && <span class="pin">Przypięta </span>}
        <span class="row-host">{host}</span>
      </label>
      {url && (
        <div class="row-actions">
          <OpenButton action="Otwórz w nowej karcie" title={title} onClick={() => open(url, false)}>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </OpenButton>
          <OpenButton
            action="Otwórz w trybie incognito"
            title={title}
            onClick={() => open(url, true)}
          >
            <path d="M3 11h18M6 11l2-6h8l2 6M11 17h2" />
            <circle cx="8" cy="17" r="3" />
            <circle cx="16" cy="17" r="3" />
          </OpenButton>
        </div>
      )}
    </div>
  );
}
