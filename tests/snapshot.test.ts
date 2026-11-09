import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capture,
  InvalidSnapshotError,
  isSyncableUrl,
  parseSnapshot,
  toSnapshot,
} from "../src/shared/snapshot";

afterEach(() => vi.unstubAllGlobals());

function stubChrome() {
  vi.stubGlobal("chrome", {
    windows: {
      getAll: async () => [
        {
          id: 1,
          incognito: false,
          tabs: [
            {
              id: 10,
              url: "https://a.test/",
              title: "A",
              pinned: true,
              active: false,
              groupId: -1,
            },
            { id: 11, url: "https://b.test/", title: "B", pinned: false, active: true, groupId: 5 },
            {
              id: 12,
              url: "chrome-extension://x/preview/index.html",
              title: "P",
              pinned: false,
              active: false,
              groupId: -1,
            },
            {
              id: 13,
              url: "",
              pendingUrl: "https://c.test/",
              title: "",
              pinned: false,
              active: false,
              groupId: -1,
            },
          ],
        },
        { id: 2, incognito: true, tabs: [{ id: 20, url: "https://private.test/", groupId: -1 }] },
      ],
    },
    tabGroups: {
      query: async () => [{ id: 5, windowId: 1, title: "G", color: "blue", collapsed: true }],
    },
    bookmarks: {
      getTree: async () => [
        {
          id: "0",
          children: [
            {
              id: "1",
              folderType: "bookmarks-bar",
              children: [
                {
                  id: "2",
                  title: "F",
                  children: [{ id: "3", title: "X", url: "https://x.test/" }],
                },
              ],
            },
            {
              id: "9",
              folderType: "managed",
              children: [{ id: "8", title: "M", url: "https://m.test/" }],
            },
          ],
        },
      ],
    },
  });
}

describe("isSyncableUrl", () => {
  it.each([
    ["https://a.test/", true],
    ["chrome://settings/", true],
    ["", false],
    ["about:blank", false],
    ["chrome://newtab/", false],
    ["chrome-extension://abc/page.html", false],
  ])("%s -> %s", (url, expected) => expect(isSyncableUrl(url)).toBe(expected));
});

describe("capture", () => {
  it("reads tabs, groups and bookmarks but skips incognito, extension and managed entries", async () => {
    stubChrome();
    const state = await capture();
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]!.tabs.map((t) => t.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
      "https://c.test/",
    ]);
    expect(state.windows[0]!.tabs[1]).toMatchObject({ groupRef: "g5", localId: 11 });
    expect(state.windows[0]!.groups).toEqual([
      { ref: "g5", title: "G", color: "blue", collapsed: true, localId: 5 },
    ]);
    expect(state.bookmarks.map((b) => b.folderType)).toEqual(["bookmarks-bar"]);
    expect(state.bookmarks[0]!.children[0]).toMatchObject({ kind: "folder", title: "F" });
  });

  it("removes local ids from what gets uploaded", async () => {
    stubChrome();
    expect(JSON.stringify(toSnapshot(await capture(), "A", "t"))).not.toContain("localId");
  });
});

describe("parseSnapshot", () => {
  const valid = {
    formatVersion: 1,
    sentAt: "t",
    deviceName: "A",
    windows: [
      {
        groups: [{ ref: "g", title: "G", color: "blue", collapsed: false }],
        tabs: [{ url: "https://a.test/", title: "A", pinned: false, active: true, groupRef: "g" }],
      },
    ],
    bookmarks: [
      {
        folderType: "other",
        children: [
          {
            kind: "folder",
            title: "F",
            children: [{ kind: "bookmark", title: "X", url: "https://x.test/" }],
          },
        ],
      },
    ],
  };

  it("accepts a valid snapshot", () => expect(parseSnapshot(valid)).toEqual(valid));

  it.each([
    ["wrong version", { ...valid, formatVersion: 2 }],
    ["missing windows", { ...valid, windows: undefined }],
    ["bad tab", { ...valid, windows: [{ groups: [], tabs: [{ url: 1 }] }] }],
    ["bad folder type", { ...valid, bookmarks: [{ folderType: "managed", children: [] }] }],
    [
      "unknown group",
      {
        ...valid,
        windows: [
          {
            groups: [],
            tabs: [{ url: "u", title: "", pinned: false, active: false, groupRef: "x" }],
          },
        ],
      },
    ],
  ])("rejects %s", (_, value) => expect(() => parseSnapshot(value)).toThrow(InvalidSnapshotError));
});
