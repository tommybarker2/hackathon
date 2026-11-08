import type { Analysis, Endpoint, FlowResponse, FlowStep, ImpactResponse, RepoSymbol } from "../shared/types";
import { isTestFile } from "./analyze/walk";
import { expandTokens, rankEndpoints, tokenize } from "./retrieval";
import type { RepoRecord } from "./store";

interface FlowOptions {
  query?: string;
  symbolId?: string;
  endpoint?: { file: string; method: string; path: string; line: number };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const bucket = map.get(key) ?? [];
  if (!bucket.includes(value)) bucket.push(value);
  map.set(key, bucket);
}

function allEndpoints(analysis: Analysis): Endpoint[] {
  return analysis.files.flatMap((f) => f.endpoints);
}

export function buildFlow(rec: RepoRecord, options: FlowOptions): FlowResponse {
  const { analysis } = rec;
  const symbolById = new Map(analysis.symbols.map((s) => [s.id, s]));
  const callees = new Map<string, string[]>();
  for (const edge of analysis.callEdges) push(callees, edge.from, edge.to);

  let endpoint: Endpoint | undefined;
  let seed: RepoSymbol | undefined;
  let confidence = 0.5;
  const question = options.query?.trim() || "the execution flow";

  if (options.symbolId) {
    seed = symbolById.get(options.symbolId);
    confidence = 0.78;
  }

  if (!seed && options.endpoint) {
    endpoint = allEndpoints(analysis).find(
      (e) =>
        e.file === options.endpoint!.file &&
        e.method === options.endpoint!.method &&
        e.path === options.endpoint!.path,
    );
  }

  if (!seed && !endpoint && options.query) {
    const tokens = expandTokens(tokenize(options.query));
    const ranked = rankEndpoints(rec, tokens);
    if (ranked.length && ranked[0].score >= 8) {
      endpoint = ranked[0].endpoint;
      confidence = 0.8;
    } else {
      // No route matched: pick the best symbol by call context as well.
      const candidates = analysis.symbols
        .map((symbol) => {
          const nameTokens = tokenize(symbol.name);
          let score = 0;
          for (const token of tokens) {
            if (nameTokens.includes(token)) score += 8;
            else if (symbol.name.toLowerCase().includes(token) && token.length > 3) score += 2;
          }
          if (analysis.callEdges.some((e) => e.from === symbol.id)) score += 1;
          return { symbol, score };
        })
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
      if (candidates.length) {
        seed = candidates[0].symbol;
        confidence = 0.62;
      }
    }
  }

  if (!seed && endpoint) {
    const handler = endpoint.handler ? symbolById.get(endpoint.handler) : undefined;
    if (handler) {
      seed = handler;
    } else {
      const inFile = analysis.symbols
        .filter((s) => s.file === endpoint!.file && s.kind !== "class")
        .sort((a, b) => Math.abs(a.line - endpoint!.line) - Math.abs(b.line - endpoint!.line));
      seed = inFile[0];
    }
  }

  const steps: FlowStep[] = [];
  if (endpoint) {
    steps.push({
      name: `${endpoint.method} ${endpoint.path}`,
      file: endpoint.file,
      line: endpoint.line,
      kind: "endpoint",
      depth: 0,
      note: `HTTP ${endpoint.method} route (${endpoint.framework})`,
    });
  }

  const visited = new Set<string>();
  const isInlineHandler = Boolean(
    endpoint && seed && seed.name === `${endpoint.method} ${endpoint.path}`,
  );
  const queue: { id: string; depth: number; via?: string }[] = [];
  if (seed) {
    if (isInlineHandler) {
      // The synthetic route handler is the endpoint step; start at what it calls.
      visited.add(seed.id);
      for (const next of callees.get(seed.id) ?? []) {
        queue.push({ id: next, depth: 1, via: "the route handler" });
      }
    } else {
      queue.push({ id: seed.id, depth: endpoint ? 1 : 0 });
    }
  }

  while (queue.length && steps.length < 15) {
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    const symbol = symbolById.get(item.id);
    if (!symbol) continue;
    steps.push({
      symbolId: symbol.id,
      name: symbol.name,
      file: symbol.file,
      line: symbol.line,
      kind: symbol.kind,
      depth: item.depth,
      note: item.via
        ? `called by ${item.via}`
        : endpoint
          ? `handles ${endpoint.method} ${endpoint.path}`
          : `${symbol.kind} entry point`,
    });
    if (item.depth >= 4) continue;
    for (const next of callees.get(item.id) ?? []) {
      if (!visited.has(next)) queue.push({ id: next, depth: item.depth + 1, via: symbol.name });
    }
  }

  const fileCount = new Set(steps.map((s) => s.file)).size;
  const explanation = steps.length
    ? `${steps.length} statically inferred steps across ${fileCount} file${fileCount === 1 ? "" : "s"}. ` +
      "Edges come from parsed call sites, so dynamic dispatch, reflection and event handlers may not appear."
    : "No call path could be inferred for that question. Try naming a route or a function, or open a file in the Code Explorer and use “Blast radius”.";

  return {
    title: endpoint ? `${endpoint.method} ${endpoint.path}` : seed ? seed.name : question,
    question,
    steps,
    mode: "static",
    confidence: steps.length ? Math.max(0.3, Math.min(0.9, confidence)) : 0.1,
    explanation,
  };
}

export function buildImpact(rec: RepoRecord, symbolId: string): ImpactResponse {
  const { analysis } = rec;
  const symbol = analysis.symbols.find((s) => s.id === symbolId) ?? null;
  if (!symbol) {
    return {
      symbol: null,
      affectedSymbols: [],
      affectedFiles: [],
      endpoints: [],
      tests: [],
      summary: "No symbol selected. Open a file and place the cursor on a function to run a blast-radius analysis.",
    };
  }

  const callers = new Map<string, string[]>();
  for (const edge of analysis.callEdges) push(callers, edge.to, edge.from);

  const symbolById = new Map(analysis.symbols.map((s) => [s.id, s]));
  const affected = new Map<string, RepoSymbol>();
  const queue: { id: string; depth: number }[] = [{ id: symbol.id, depth: 0 }];
  const seen = new Set<string>([symbol.id]);

  while (queue.length) {
    const item = queue.shift()!;
    if (item.depth >= 6) continue;
    for (const callerId of callers.get(item.id) ?? []) {
      if (seen.has(callerId)) continue;
      seen.add(callerId);
      const caller = symbolById.get(callerId);
      if (!caller) continue;
      affected.set(caller.id, caller);
      queue.push({ id: caller.id, depth: item.depth + 1 });
    }
  }

  const affectedSymbols = [...affected.values()];
  const affectedFiles = [...new Set([symbol.file, ...affectedSymbols.map((s) => s.file)])];

  const endpointSet = new Map<string, Endpoint>();
  for (const file of analysis.files) {
    if (!affectedFiles.includes(file.path)) continue;
    for (const endpoint of file.endpoints) {
      endpointSet.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }
  }

  const tests = affectedFiles.filter(isTestFile);
  const endpoints = [...endpointSet.values()];

  const summary =
    `Changing \`${symbol.name}\` can reach ${affectedSymbols.length} other symbol${
      affectedSymbols.length === 1 ? "" : "s"
    } across ${affectedFiles.length} file${affectedFiles.length === 1 ? "" : "s"}` +
    (endpoints.length ? ` and ${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}` : "") +
    "." +
    (tests.length
      ? ` ${tests.length} test file${tests.length === 1 ? "" : "s"} sit in the affected area.`
      : " No test files were found anywhere in the affected area.");

  return {
    symbol,
    affectedSymbols,
    affectedFiles,
    endpoints,
    tests,
    summary,
  };
}
