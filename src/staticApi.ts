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

interface StaticSnapshot {
  version: number;
  generatedAt: string;
  analysis: Analysis;
  contents: Record<string, string>;
  parsed: Record<string, { symbols: { id: string; body: string }[] }>;
}

let recordPromise: Promise<RepoRecord> | null = null;

async function loadRecord(): Promise<RepoRecord> {
  if (!recordPromise) {
    recordPromise = (async () => {
      const url = `${import.meta.env.BASE_URL}repo-cloud-static.json`;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(
          `This Pages build is missing its baked analysis (${response.status}). Run npm run build:pages.`,
        );
      }
      const snapshot = (await response.json()) as StaticSnapshot;
      return {
        analysis: snapshot.analysis,
        contents: new Map(Object.entries(snapshot.contents)),
        parsed: new Map(Object.entries(snapshot.parsed)) as unknown as RepoRecord["parsed"],
      };
    })();
  }
  return recordPromise;
}

function ensureSameRepo(record: RepoRecord, id: string): void {
  if (id && id !== record.analysis.id) {
    throw new Error("The static Pages build contains only one repository snapshot. Reload the page.");
  }
}

export async function analyzeStaticRepo(input: {
  source: "local" | "github";
  path?: string;
  url?: string;
}): Promise<{ analysis: Analysis }> {
  const record = await loadRecord();
  if (input.source === "github") {
    throw new Error(
      "GitHub imports need the Node backend. This GitHub Pages build is a baked self-analysis of The Repo Cloud; run npm run dev for live local or GitHub imports.",
    );
  }
  const requested = (input.path ?? ".").trim();
  if (requested && requested !== "." && requested !== record.analysis.source.path) {
    throw new Error(
      "This GitHub Pages build is a fixed self-analysis. Run npm run dev to analyze another path or a GitHub repository.",
    );
  }
  return { analysis: record.analysis };
}

export async function staticFetchFile(repo: string, filePath: string): Promise<FileResponse> {
  const record = await loadRecord();
  ensureSameRepo(record, repo);
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
  const record = await loadRecord();
  ensureSameRepo(record, repo);
  return answerQuestion(record, question, history);
}

export async function staticTraceFlow(
  repo: string,
  payload: { query?: string; symbolId?: string },
): Promise<FlowResponse> {
  const record = await loadRecord();
  ensureSameRepo(record, repo);
  return buildFlow(record, payload);
}

export async function staticAnalyzeImpact(repo: string, symbolId: string): Promise<ImpactResponse> {
  const record = await loadRecord();
  ensureSameRepo(record, repo);
  return buildImpact(record, symbolId);
}

export function staticConfig(): { llm: boolean; model: string } {
  return { llm: false, model: "baked snapshot" };
}
