import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository, type AnalyzeResult } from "../server/analyze/index";
import { EXAMPLES } from "../src/examples";

/**
 * GitHub Pages cannot run the Hono server, so the Pages build ships one
 * analysis per example repository plus the symbol bodies needed for ranking.
 * The client-side adapter in src/staticApi.ts runs the same deterministic
 * answer, flow and impact functions against these payloads.
 */
const root = process.cwd();
const publicDir = path.join(root, "public");
const examplesDir = path.join(publicDir, "examples");
const localOutput = path.join(publicDir, "repo-cloud-static.json");

// A previous snapshot would otherwise be walked as source on the next build.
await rm(localOutput, { force: true });
await rm(examplesDir, { recursive: true, force: true });

function snapshot(result: AnalyzeResult) {
  const publicAnalysis = {
    ...result.analysis,
    // Do not publish the absolute path of the machine that produced the build.
    source: { ...result.analysis.source, path: undefined },
  };

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    analysis: publicAnalysis,
    contents: Object.fromEntries(result.contents),
    parsed: Object.fromEntries(
      [...result.parsed].map(([file, value]) => [
        file,
        { symbols: value.symbols.map((symbol) => ({ id: symbol.id, body: symbol.body })) },
      ]),
    ),
  };
}

async function writeSnapshot(file: string, result: AnalyzeResult, label: string): Promise<void> {
  const payload = snapshot(result);
  const json = JSON.stringify(payload);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, json);
  console.log(
    `[repo_cloud] ${label}: ${payload.analysis.stats.files} files, ` +
      `${payload.analysis.stats.symbols} symbols, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`,
  );
}

const local = await analyzeRepository({ source: "local", path: root });
await writeSnapshot(localOutput, local, "this app");
await mkdir(examplesDir, { recursive: true });

for (const example of EXAMPLES) {
  if (example.kind !== "github" || !example.url) continue;
  console.log(`[repo_cloud] fetching ${example.owner ?? example.name}…`);
  const result = await analyzeRepository({ source: "github", url: example.url });
  await writeSnapshot(path.join(examplesDir, `${example.id}.json`), result, example.name);
}

console.log("[repo_cloud] static snapshots ready in public/");
