import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/manifest.json"), "utf8"),
);

describe("manifest", () => {
  it("grants only the required permissions", () => {
    expect([...manifest.permissions].sort()).toEqual([
      "bookmarks",
      "favicon",
      "storage",
      "tabGroups",
      "tabs",
    ]);
    expect(manifest.host_permissions).toEqual(["https://api.github.com/*"]);
  });

  it("has no content scripts and no background worker", () => {
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.background).toBeUndefined();
  });

  it("locks the content security policy", () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'",
    );
  });
});
