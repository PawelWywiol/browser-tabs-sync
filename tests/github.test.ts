import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRepo, GitHubError, readFile, writeFile } from "../src/shared/github";

const config = { owner: "o", repo: "r", token: "t" };
const fetchMock = vi.fn();
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("readFile", () => {
  it("reads exact bytes from the blob, not the contents response GitHub may transcode", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { sha: "s1", encoding: "base64", content: "bWFuZ2xlZA==" }))
      .mockResolvedValueOnce(json(200, { encoding: "base64", content: "dHdv\n" }));
    const file = await readFile(config, "a.enc");
    expect(file?.sha).toBe("s1");
    expect(new TextDecoder().decode(file?.bytes)).toBe("two");
    const [contentsUrl, init] = fetchMock.mock.calls[0]!;
    expect(contentsUrl).toBe("https://api.github.com/repos/o/r/contents/a.enc");
    expect(init.cache).toBe("no-store");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.github.com/repos/o/r/git/blobs/s1");
  });

  it("returns null for a missing file", async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    expect(await readFile(config, "a.enc")).toBeNull();
  });

  it("reports a failed blob read", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { sha: "s1" })).mockResolvedValueOnce(json(401, {}));
    await expect(readFile(config, "a.enc")).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("writeFile", () => {
  it("sends base64, a neutral message and the sha", async () => {
    fetchMock.mockResolvedValue(json(200, { content: { sha: "s2" } }));
    expect(await writeFile(config, "a.enc", new Uint8Array([116, 119, 111]), "s1")).toBe("s2");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ message: "update", content: "dHdv", sha: "s1" });
  });

  it.each([
    [409, "s1"],
    [422, undefined],
  ])("reports status %i as a conflict", async (status, sha) => {
    fetchMock.mockResolvedValue(json(status, {}));
    await expect(writeFile(config, "a.enc", new Uint8Array(), sha)).rejects.toMatchObject({
      kind: "conflict",
    });
  });
});

describe("errors", () => {
  it("maps 401 to auth", async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps 403 without exhausted quota to forbidden", async () => {
    fetchMock.mockResolvedValue(json(403, {}));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("maps a 404 repository to not-found", async () => {
    fetchMock.mockResolvedValue(json(404, {}));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "not-found" });
  });

  it("maps an exhausted quota to rate-limit", async () => {
    fetchMock.mockResolvedValue(json(403, {}, { "x-ratelimit-remaining": "0" }));
    await expect(checkRepo(config)).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("maps a fetch failure to network", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const error = await checkRepo(config).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.kind).toBe("network");
  });
});
