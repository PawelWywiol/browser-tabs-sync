import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const repoRoot = resolve(import.meta.dirname, "..");
const srcDir = resolve(repoRoot, "src");
const outdir = resolve(repoRoot, "dist/extension");
const pages = ["popup", "options", "preview"];

rmSync(outdir, { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: Object.fromEntries(pages.map((page) => [`${page}/index`, resolve(srcDir, `${page}/index.tsx`)])),
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  outdir,
  platform: "browser",
  target: ["chrome134"],
});

for (const page of pages) {
  cpSync(resolve(srcDir, `${page}/index.html`), resolve(outdir, `${page}/index.html`));
}
mkdirSync(resolve(outdir, "ui/shared"), { recursive: true });
cpSync(resolve(srcDir, "ui/shared/tokens.css"), resolve(outdir, "ui/shared/tokens.css"));
cpSync(resolve(srcDir, "manifest.json"), resolve(outdir, "manifest.json"));
