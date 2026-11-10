import type {
  Analysis,
  AskResponse,
  FileResponse,
  FlowResponse,
  ImpactResponse,
} from "../shared/types";
import { answerQuestion } from "../server/ask";
import { buildFlow, buildImpact } from "../server/flow";
import type { RepoRecord } from "../server/store";
import { EXAMPLES } from "./examples";

interface StaticSnapshot {
  version: number;
  generatedAt: string;
  analysis: Analysis;
  contents: Record<string, string>;
  parsed: Record<string, { symbols: { id: string; body: string }[] }>;
}

const snapshotPromises = new Map<string, Promise<RepoRecord>>();
const recordsById = new Map<string, RepoRecord>();

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

function exampleIdFor(input: {
  source: "local" | "github";
  path?: string;
  url?: string;
}): string {
  if (input.source === "github") {
    const wanted = normalizeUrl(input.url ?? "");
    const example = EXAMPLES.find(
      (candidate) =>
        candidate.kind === "github" && candidate.url && normalizeUrl(candidate.url) === wanted,
    );
    if (!example) {
      throw new Error(
        "This GitHub Pages build includes the six example repositories, but not arbitrary GitHub imports. Run npm run dev for any public repository.",
      );
    }
    return example.id;
  }

  const requested = (input.path ?? ".").trim();
  const example = EXAMPLES.find(
    (candidate) =>
      candidate.kind === "local" &&
      (candidate.localPath === requested ||
        (candidate.localPath === "." && (requested === "" || requested === "."))),
  );
  if (!example) {
    throw new Error(
      "This GitHub Pages build includes the six example repositories, but not arbitrary local paths. Run npm run dev to analyze another directory.",
    );
  }
  return example.id;
}

function snapshotUrl(exampleId: string): string {
  const file =
    exampleId === "this-app" ? "repo-cloud-static.json" : `examples/${exampleId}.json`;
  return `${import.meta.env.BASE_URL}${file}`;
}

async function loadRecord(exampleId: string): Promise<RepoRecord> {
  let pending = snapshotPromises.get(exampleId);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(snapshotUrl(exampleId), { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(
          `This Pages build is missing the ${exampleId} snapshot (${response.status}). Run npm run build:pages.`,
        );
      }
      const payload = (await response.json()) as StaticSnapshot;
      const record: RepoRecord = {
        analysis: payload.analysis,
        contents: new Map(Object.entries(payload.contents)),
        parsed: new Map(Object.entries(payload.parsed)) as unknown as RepoRecord["parsed"],
      };
      recordsById.set(record.analysis.id, record);
      return record;
    })();
    snapshotPromises.set(exampleId, pending);
  }
  return pending;
}

function requireRecord(repo: string): RepoRecord {
  const record = recordsById.get(repo);
  if (!record) {
    throw new Error("Repository snapshot not loaded. Reload the page and pick an example again.");
  }
  return record;
}

export async function analyzeStaticRepo(input: {
  source: "local" | "github";
  path?: string;
  url?: string;
}): Promise<{ analysis: Analysis }> {
  const exampleId = exampleIdFor(input);
  const record = await loadRecord(exampleId);
  return { analysis: record.analysis };
}

export async function staticFetchFile(repo: string, filePath: string): Promise<FileResponse> {
  const record = requireRecord(repo);
  const content = record.contents.get(filePath);
  const meta = record.analysis.files.find((file) => file.path === filePath);
  if (content === undefined || !meta) throw new Error(`File not in analysis: ${filePath}`);
  return { path: filePath, lang: meta.lang, content };
}

export async function staticAskQuestion(
  repo: string,
  question: string,
  history: Parameters<typeof answerQuestion>[2] = [],
): Promise<AskResponse> {
  return answerQuestion(requireRecord(repo), question, history);
}

export async function staticTraceFlow(
  repo: string,
  payload: { query?: string; symbolId?: string },
): Promise<FlowResponse> {
  return buildFlow(requireRecord(repo), payload);
}

export async function staticAnalyzeImpact(repo: string, symbolId: string): Promise<ImpactResponse> {
  return buildImpact(requireRecord(repo), symbolId);
}

export function staticConfig(): { llm: boolean; model: string } {
  return { llm: false, model: "baked examples" };
}
