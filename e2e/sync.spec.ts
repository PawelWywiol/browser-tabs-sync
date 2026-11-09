import { expect, test } from "@playwright/test";
import { FakeGitHub } from "./fake-github";
import { configure, launch, newProfileDir, openExtensionPage, readTabs } from "./helpers";

test("sends from one profile, previews and pulls into another", async () => {
  const github = new FakeGitHub();

  const sender = await launch(newProfileDir(), github);
  const { page: senderOptions, keyText } = await configure(sender, null, "Laptop");
  await senderOptions.getByLabel("Nowy profil synchronizacji").fill("Praca");
  await senderOptions.getByRole("button", { name: "Utwórz" }).click();
  await expect(senderOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  for (const url of ["https://pinned.test/", "https://grouped.test/", "https://loose.test/"]) {
    await (await sender.newPage()).goto(url);
  }
  await senderOptions.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const byUrl = (part: string) => tabs.find((tab) => tab.url?.includes(part))!.id!;
    await chrome.tabs.update(byUrl("pinned.test"), { pinned: true });
    const groupId = await chrome.tabs.group({ tabIds: [byUrl("grouped.test")] });
    await chrome.tabGroups.update(groupId, { title: "Projekt", color: "blue" });
    const bar = (await chrome.bookmarks.getTree())[0]!.children!.find(
      (node) => node.folderType === "bookmarks-bar",
    )!;
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: "Folder" });
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: "Mark",
      url: "https://mark.test/",
    });
  });

  const senderPopup = await openExtensionPage(sender, "popup/index.html");
  await senderPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(senderPopup.getByText("Wysłano.")).toBeVisible();
  await sender.close();

  for (const { content } of github.files.values()) {
    const stored = Buffer.from(content, "base64").toString("latin1");
    expect(stored).not.toContain("pinned.test");
    expect(stored).not.toContain("Praca");
    expect(stored).not.toContain("Projekt");
  }

  const receiverDir = newProfileDir();
  const receiver = await launch(receiverDir, github);
  const { page: receiverOptions } = await configure(receiver, keyText, "Desktop");
  await receiverOptions.getByRole("button", { name: "Praca" }).click();
  await expect(receiverOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  await (await receiver.newPage()).goto("https://local-keep.test/");
  await (await receiver.newPage()).goto("https://local-close.test/");

  const preview = await openExtensionPage(receiver, "preview/index.html");
  await expect(preview.getByText("Laptop")).toBeVisible();
  await preview.getByRole("checkbox", { name: /local-keep\.test/ }).uncheck();
  await preview.getByRole("button", { name: "Zastosuj" }).click();
  await expect(preview.getByText("Gotowe.")).toBeVisible();

  const tabs = await readTabs(preview);
  expect(tabs.find((tab) => tab.url === "https://pinned.test/")?.pinned).toBe(true);
  expect(tabs.find((tab) => tab.url === "https://grouped.test/")?.group).toBe("Projekt");
  expect(tabs.some((tab) => tab.url === "https://loose.test/")).toBe(true);
  expect(tabs.some((tab) => tab.url === "https://local-keep.test/")).toBe(true);
  expect(tabs.some((tab) => tab.url === "https://local-close.test/")).toBe(false);

  const bookmarks = await preview.evaluate(() =>
    chrome.bookmarks.search({ url: "https://mark.test/" }),
  );
  expect(bookmarks).toHaveLength(1);

  await receiver.close();

  const restarted = await launch(receiverDir, github);
  const popup = await openExtensionPage(restarted, "popup/index.html");
  await popup.getByRole("button", { name: "Wyślij" }).click();
  await expect(popup.getByText("Wysłano.")).toBeVisible();
  await restarted.close();
});

test("warns before overwriting newer data", async () => {
  const github = new FakeGitHub();
  const first = await launch(newProfileDir(), github);
  const { page: firstOptions, keyText } = await configure(first, null, "Laptop");
  await firstOptions.getByLabel("Nowy profil synchronizacji").fill("Praca");
  await firstOptions.getByRole("button", { name: "Utwórz" }).click();
  await expect(firstOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  const second = await launch(newProfileDir(), github);
  const { page: secondOptions } = await configure(second, keyText, "Desktop");
  await secondOptions.getByRole("button", { name: "Praca" }).click();
  await expect(secondOptions.getByText("Wybrano profil: Praca.")).toBeVisible();

  const firstPopup = await openExtensionPage(first, "popup/index.html");
  await firstPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(firstPopup.getByText("Wysłano.")).toBeVisible();

  const secondPopup = await openExtensionPage(second, "popup/index.html");
  await secondPopup.getByRole("button", { name: "Wyślij" }).click();
  await expect(secondPopup.getByText(/Laptop/)).toBeVisible();
  await expect(secondPopup.getByRole("button", { name: "Nadpisz mimo to" })).toBeVisible();

  await first.close();
  await second.close();
});
