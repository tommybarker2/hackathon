import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = {
  ...process.env,
  VITE_STATIC: "1",
  // Relative URLs let the built app live under /<repo>/site/ on Pages.
  VITE_BASE: "./",
  VITE_OUT_DIR: "site",
};

const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

console.log("[repo_cloud] building static Pages demo");
execFileSync(process.execPath, [tsx, "scripts/build-static.ts"], {
  cwd: root,
  env,
  stdio: "inherit",
});
execFileSync(process.execPath, [vite, "build"], {
  cwd: root,
  env,
  stdio: "inherit",
});
console.log("[repo_cloud] static demo ready in site/");
