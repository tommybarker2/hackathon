import type {
  Analysis,
  AskHistoryMessage,
  AskResponse,
  FileResponse,
  FlowResponse,
  ImpactResponse,
} from "../shared/types";

/** GitHub Pages serves static files only; this build swaps /api for a baked snapshot. */
export const isStaticDemo = import.meta.env.VITE_STATIC === "1";

function staticApi() {
  return import("./staticApi");
}

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
  if (isStaticDemo) {
    return staticApi().then((api) => api.analyzeStaticRepo(input));
  }
  return request("/api/analyze", { method: "POST", body: JSON.stringify(input) });
}

export function fetchFile(repo: string, filePath: string): Promise<FileResponse> {
  if (isStaticDemo) {
    return staticApi().then((api) => api.staticFetchFile(repo, filePath));
  }
  return request(
    `/api/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(filePath)}`,
  );
}

export function askQuestion(
  repo: string,
  question: string,
  history: AskHistoryMessage[] = [],
): Promise<AskResponse> {
  if (isStaticDemo) {
    return staticApi().then((api) => api.staticAskQuestion(repo, question, history));
  }
  return request("/api/ask", {
    method: "POST",
    body: JSON.stringify({ repo, question, history }),
  });
}

export function traceFlow(
  repo: string,
  payload: { query?: string; symbolId?: string },
): Promise<FlowResponse> {
  if (isStaticDemo) {
    return staticApi().then((api) => api.staticTraceFlow(repo, payload));
  }
  return request("/api/flow", { method: "POST", body: JSON.stringify({ repo, ...payload }) });
}

export function analyzeImpact(repo: string, symbolId: string): Promise<ImpactResponse> {
  if (isStaticDemo) {
    return staticApi().then((api) => api.staticAnalyzeImpact(repo, symbolId));
  }
  return request("/api/impact", { method: "POST", body: JSON.stringify({ repo, symbolId }) });
}

export function getConfig(): Promise<{ llm: boolean; model: string }> {
  if (isStaticDemo) {
    return staticApi().then((api) => api.staticConfig());
  }
  return request("/api/config");
}
