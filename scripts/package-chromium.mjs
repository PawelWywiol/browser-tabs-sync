import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const extensionDir = resolve(repoRoot, "dist/extension");
const outputZip = resolve(repoRoot, "dist/browser-tabs-sync-chromium.zip");

if (!existsSync(extensionDir)) {
  console.error("Run 'pnpm build:extension' first");
  process.exit(1);
}
rmSync(outputZip, { force: true });
execFileSync("zip", ["-r", "-q", outputZip, "."], { cwd: extensionDir, stdio: "inherit" });
console.log(`Created ${outputZip}`);
