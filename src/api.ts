import type {
  Analysis,
  AskHistoryMessage,
  AskResponse,
  FileResponse,
  FlowResponse,
  ImpactResponse,
} from "../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function analyzeRepo(input: {
  source: "local" | "github";
  path?: string;
  url?: string;
  ref?: string;
}): Promise<{ analysis: Analysis }> {
  return request("/api/analyze", { method: "POST", body: JSON.stringify(input) });
}

export function fetchFile(repo: string, filePath: string): Promise<FileResponse> {
  return request(
    `/api/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(filePath)}`,
  );
}

export function askQuestion(
  repo: string,
  question: string,
  history: AskHistoryMessage[] = [],
): Promise<AskResponse> {
  return request("/api/ask", {
    method: "POST",
    body: JSON.stringify({ repo, question, history }),
  });
}

export function traceFlow(
  repo: string,
  payload: { query?: string; symbolId?: string },
): Promise<FlowResponse> {
  return request("/api/flow", { method: "POST", body: JSON.stringify({ repo, ...payload }) });
}

export function analyzeImpact(repo: string, symbolId: string): Promise<ImpactResponse> {
  return request("/api/impact", { method: "POST", body: JSON.stringify({ repo, symbolId }) });
}

export function getConfig(): Promise<{ llm: boolean; model: string }> {
  return request("/api/config");
}
