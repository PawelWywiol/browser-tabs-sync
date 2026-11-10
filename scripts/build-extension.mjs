import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const repoRoot = resolve(import.meta.dirname, "..");
const srcDir = resolve(repoRoot, "src");
const outdir = resolve(repoRoot, "dist/extension");
const pages = ["popup", "options", "preview", "send"];

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
cpSync(resolve(srcDir, "icons"), resolve(outdir, "icons"), {
  recursive: true,
  filter: (source) => !source.endsWith(".svg"),
});
const fontDir = resolve(repoRoot, "node_modules/@fontsource-variable/schibsted-grotesk");
mkdirSync(resolve(outdir, "ui/shared/fonts"), { recursive: true });
for (const font of ["latin", "latin-ext"]) {
  const file = `schibsted-grotesk-${font}-wght-normal.woff2`;
  cpSync(resolve(fontDir, "files", file), resolve(outdir, "ui/shared/fonts", file));
}
cpSync(resolve(fontDir, "LICENSE"), resolve(outdir, "ui/shared/fonts/LICENSE"));
cpSync(resolve(srcDir, "manifest.json"), resolve(outdir, "manifest.json"));
