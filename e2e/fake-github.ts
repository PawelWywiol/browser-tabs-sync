import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";

export class FakeGitHub {
  readonly files = new Map<string, { sha: string; content: string }>();

  async attach(context: BrowserContext): Promise<void> {
    await context.route("https://api.github.com/**", (route) => this.handle(route));
  }

  private handle(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/repos/o/r/contents/", "");
    if (path === "/repos/o/r") return route.fulfill({ json: { full_name: "o/r" } });
    const existing = this.files.get(path);
    if (request.method() === "GET") {
      if (!existing) return route.fulfill({ status: 404, json: {} });
      return route.fulfill({
        json: { sha: existing.sha, encoding: "base64", content: existing.content },
      });
    }
    const body = request.postDataJSON() as { content: string; sha?: string };
    if (existing && !body.sha) return route.fulfill({ status: 422, json: {} });
    if (existing && body.sha !== existing.sha) return route.fulfill({ status: 409, json: {} });
    const sha = createHash("sha1").update(body.content).digest("hex");
    this.files.set(path, { sha, content: body.content });
    return route.fulfill({ json: { content: { sha } } });
  }
}
