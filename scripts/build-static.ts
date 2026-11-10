import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../server/analyze/index";

/**
 * GitHub Pages cannot run the Hono server, so the Pages build ships one
 * analysis of this repository plus the symbol bodies needed for ranking.
 * The client-side adapter in src/staticApi.ts runs the same deterministic
 * answer, flow and impact functions against this payload.
 */
const root = process.cwd();
const output = path.join(root, "public", "repo-cloud-static.json");

// A previous snapshot would otherwise be walked as source on the next build.
await rm(output, { force: true });

const { analysis, contents, parsed } = await analyzeRepository({
  source: "local",
  path: root,
});

const publicAnalysis = {
  ...analysis,
  // Do not publish the absolute path of the machine that produced the build.
  source: { ...analysis.source, path: undefined },
};

const snapshot = {
  version: 1,
  generatedAt: new Date().toISOString(),
  analysis: publicAnalysis,
  contents: Object.fromEntries(contents),
  parsed: Object.fromEntries(
    [...parsed].map(([file, value]) => [
      file,
      { symbols: value.symbols.map((symbol) => ({ id: symbol.id, body: symbol.body })) },
    ]),
  ),
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(snapshot));

const bytes = Buffer.byteLength(JSON.stringify(snapshot));
console.log(
  `[repo_cloud] wrote ${path.relative(root, output)} (${(bytes / 1024).toFixed(0)} KB, ` +
    `${snapshot.analysis.stats.files} files, ${snapshot.analysis.stats.symbols} symbols)`,
);
