import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import type { FakeGitHub } from "./fake-github";

const extensionPath = resolve(import.meta.dirname, "../dist/extension");
const manifest = JSON.parse(readFileSync(join(extensionPath, "manifest.json"), "utf8")) as {
  key: string;
};

export const extensionId = Array.from(
  createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32),
)
  .map((char) => String.fromCharCode(97 + Number.parseInt(char, 16)))
  .join("");

export const newProfileDir = () => mkdtempSync(join(tmpdir(), "bts-e2e-"));

export async function launch(userDataDir: string, github: FakeGitHub): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await github.attach(context);
  await context.route("https://*.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<title>${new URL(route.request().url()).host}</title>`,
    }),
  );
  return context;
}

export async function openExtensionPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

export async function configure(
  context: BrowserContext,
  keyText: string | null,
  device: string,
): Promise<{ page: Page; keyText: string }> {
  const page = await openExtensionPage(context, "options/index.html");
  await page.getByLabel("Repozytorium (owner/nazwa)").fill("o/r");
  await page.getByLabel("Token GitHub").fill("token");
  if (keyText) await page.getByLabel("Klucz szyfrowania").fill(keyText);
  else await page.getByRole("button", { name: "Wygeneruj klucz" }).click();
  await page.getByLabel("Nazwa urządzenia").fill(device);
  const usedKey = await page.getByLabel("Klucz szyfrowania").inputValue();
  await page.getByRole("button", { name: "Połącz" }).click();
  await page.getByRole("heading", { name: "Profil synchronizacji" }).waitFor();
  return { page, keyText: usedKey };
}

export type TabInfo = { url: string; pinned: boolean; group: string | null };

type TabState = {
  tabs: { url: string; pinned: boolean; groupId: number }[];
  groups: { id: number; title: string }[];
};

async function readSettledTabs(page: Page): Promise<TabState> {
  let state: TabState = { tabs: [], groups: [] };
  await expect
    .poll(async () => {
      state = await page.evaluate(async () => {
        const [tabs, groups] = await Promise.all([
          chrome.tabs.query({}),
          chrome.tabGroups.query({}),
        ]);
        return {
          tabs: tabs.map((tab) => ({
            url: tab.url ?? "",
            pinned: tab.pinned,
            groupId: tab.groupId,
          })),
          groups: groups.map((group) => ({ id: group.id, title: group.title ?? "" })),
        };
      });
      return state.tabs.every((tab) => tab.url);
    })
    .toBe(true);
  return state;
}

export async function readTabs(page: Page): Promise<TabInfo[]> {
  const { tabs, groups } = await readSettledTabs(page);
  return tabs
    .filter((tab) => tab.url.startsWith("https://"))
    .map((tab) => ({
      url: tab.url,
      pinned: tab.pinned,
      group: groups.find((group) => group.id === tab.groupId)?.title ?? null,
    }));
}

export async function arrangeTabs(page: Page, layout: string[]): Promise<void> {
  await page.evaluate(async (items) => {
    const stale = (await chrome.tabs.query({})).filter((tab) =>
      (tab.url || tab.pendingUrl || "").startsWith("https://"),
    );
    if (stale.length > 0) await chrome.tabs.remove(stale.map((tab) => tab.id!));
    const groups = new Map<string, { title: string; tabIds: number[] }>();
    for (const [index, item] of items.entries()) {
      const [, pin, name, key, title] = /^(\*?)([\w-]+)(?:\[(\d+):(.*)\])?$/.exec(item)!;
      const tab = await chrome.tabs.create({
        url: `https://${name}.test/`,
        pinned: pin === "*",
        active: false,
        index,
      });
      if (key) {
        const group = groups.get(key) ?? { title: title!, tabIds: [] };
        group.tabIds.push(tab.id!);
        groups.set(key, group);
      }
    }
    for (const { title, tabIds } of groups.values()) {
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
      await chrome.tabGroups.update(groupId, { title });
    }
  }, layout);
  await readSettledTabs(page);
}

export async function readLayout(page: Page): Promise<string[]> {
  const { tabs, groups } = await readSettledTabs(page);
  const ordinals = new Map<number, number>();
  return tabs
    .filter((tab) => tab.url.startsWith("https://"))
    .map((tab) => {
      const name = new URL(tab.url).host.replace(".test", "");
      if (tab.groupId === -1) return `${tab.pinned ? "*" : ""}${name}`;
      if (!ordinals.has(tab.groupId)) ordinals.set(tab.groupId, ordinals.size + 1);
      const title = groups.find((group) => group.id === tab.groupId)?.title ?? "";
      return `${name}[${ordinals.get(tab.groupId)}:${title}]`;
    });
}
