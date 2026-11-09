const pluralRules = new Intl.PluralRules("pl-PL");
const timeFormat = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

export type Forms = { one: string; few: string; many: string };

export function plural(count: number, forms: Forms): string {
  const rule = pluralRules.select(count);
  return `${count} ${rule === "one" || rule === "few" ? forms[rule] : forms.many}`;
}

export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = timeFormat.format(date);
  if (date.toDateString() === now.toDateString()) return `dziś o ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `wczoraj o ${time}`;
  return `${dateFormat.format(date)} o ${time}`;
}

export function hostOf(url: string): string {
  const host = URL.canParse(url) ? new URL(url).host.replace(/^www\./, "") : "";
  return host || url;
}
