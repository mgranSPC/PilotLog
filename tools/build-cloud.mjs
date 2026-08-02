// Bundles js/cloud-src.mjs (+ the Firebase SDK) into js/cloud.js so the app
// has no runtime CDN dependency. Requires: npm install firebase esbuild
// Run: node tools/build-cloud.mjs
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [join(root, "js/cloud-src.mjs")],
  outfile: join(root, "js/cloud.js"),
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  logLevel: "info",
});
