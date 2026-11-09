import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
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

export async function readTabs(page: Page): Promise<TabInfo[]> {
  return page.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const groups = await chrome.tabGroups.query({});
    return tabs
      .filter((tab) => tab.url?.startsWith("https://"))
      .map((tab) => ({
        url: tab.url!,
        pinned: tab.pinned,
        group: groups.find((group) => group.id === tab.groupId)?.title ?? null,
      }));
  });
}
