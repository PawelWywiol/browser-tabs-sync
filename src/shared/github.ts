import { fromBase64, toBase64 } from "./base64";

export type RepoConfig = { owner: string; repo: string; token: string };
export type GitHubErrorKind =
  | "auth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "rate-limit"
  | "network"
  | "unknown";

export class GitHubError extends Error {
  constructor(readonly kind: GitHubErrorKind) {
    super(`GitHub error: ${kind}`);
  }
}

const baseUrl = (config: RepoConfig) =>
  `https://api.github.com/repos/${config.owner}/${config.repo}`;

const headers = (config: RepoConfig, accept = "application/vnd.github+json") => ({
  Accept: accept,
  Authorization: `Bearer ${config.token}`,
  "X-GitHub-Api-Version": "2026-03-10",
});

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new GitHubError("network");
  }
}

function errorFor(response: Response): GitHubError {
  if (response.status === 401) return new GitHubError("auth");
  if (response.status === 404) return new GitHubError("not-found");
  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
    return new GitHubError("rate-limit");
  }
  if (response.status === 403) return new GitHubError("forbidden");
  return new GitHubError("unknown");
}

export async function checkRepo(config: RepoConfig): Promise<void> {
  const response = await request(baseUrl(config), { headers: headers(config) });
  if (!response.ok) throw errorFor(response);
}

export async function readFile(
  config: RepoConfig,
  path: string,
): Promise<{ sha: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const url = `${baseUrl(config)}/contents/${path}`;
  const response = await request(url, { headers: headers(config) });
  if (response.status === 404) return null;
  if (!response.ok) throw errorFor(response);
  const body = (await response.json()) as { sha: string; encoding: string; content: string };
  if (body.encoding === "base64" && body.content)
    return { sha: body.sha, bytes: fromBase64(body.content) };
  const raw = await request(url, { headers: headers(config, "application/vnd.github.raw+json") });
  if (!raw.ok) throw errorFor(raw);
  return { sha: body.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
}

export async function writeFile(
  config: RepoConfig,
  path: string,
  bytes: Uint8Array,
  sha?: string,
): Promise<string> {
  const response = await request(`${baseUrl(config)}/contents/${path}`, {
    method: "PUT",
    headers: headers(config),
    body: JSON.stringify({ message: "update", content: toBase64(bytes), ...(sha ? { sha } : {}) }),
  });
  if (response.status === 409 || response.status === 422) throw new GitHubError("conflict");
  if (!response.ok) throw errorFor(response);
  const body = (await response.json()) as { content: { sha: string } };
  return body.content.sha;
}
