import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const cwd = process.cwd();
const distDir = path.join(cwd, "dist");
const distFile = path.join(distDir, "monobrick-wallet-adapter.js");
const rootOutput = path.join(cwd, "..", "wallet-adapter.js");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

await build({
  entryPoints: [path.join(cwd, "src", "adapter-runtime.mjs")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  outfile: distFile,
  legalComments: "none",
  sourcemap: false,
  minify: false
});

fs.copyFileSync(distFile, rootOutput);
console.log(`[wallet-adapter] built ${distFile}`);
console.log(`[wallet-adapter] copied ${rootOutput}`);

