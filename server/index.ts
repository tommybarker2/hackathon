import { createServer } from "node:http";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { analyzeRepository } from "./analyze/index";
import { answerQuestion } from "./ask";
import { buildFlow, buildImpact } from "./flow";
import { llmConfigured, llmModel, llmProvider } from "./llm";
import { putRepo, requireRepo } from "./store";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, llm: llmConfigured() }));

app.get("/api/config", (c) =>
  c.json({
    llm: llmConfigured(),
    provider: llmProvider(),
    model: llmModel(),
    githubToken: Boolean(process.env.GITHUB_TOKEN),
  }),
);

app.post("/api/analyze", async (c) => {
  try {
    const body = (await c.req.json()) as {
      source?: "local" | "github";
      path?: string;
      url?: string;
    };
    const source = body.source === "github" ? "github" : "local";
    const result = await analyzeRepository({
      source,
      path: body.path,
      url: body.url,
    });
    putRepo(result);
    return c.json({ analysis: result.analysis });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.get("/api/repos/:id/file", (c) => {
  try {
    const repo = requireRepo(c.req.param("id"));
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "A ?path= query parameter is required." }, 400);
    const content = repo.contents.get(filePath);
    const meta = repo.analysis.files.find((f) => f.path === filePath);
    if (content === undefined || !meta) return c.json({ error: `File not in analysis: ${filePath}` }, 404);
    return c.json({ path: filePath, lang: meta.lang, content });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 404);
  }
});

app.post("/api/ask", async (c) => {
  try {
    const body = (await c.req.json()) as { repo?: string; question?: string };
    const repo = requireRepo(body.repo);
    const question = (body.question ?? "").trim();
    if (!question) return c.json({ error: "Ask a question about the repository." }, 400);
    const result = await answerQuestion(repo, question);
    return c.json(result);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.post("/api/flow", async (c) => {
  try {
    const body = (await c.req.json()) as {
      repo?: string;
      query?: string;
      symbolId?: string;
      endpoint?: { file: string; method: string; path: string; line: number };
    };
    const repo = requireRepo(body.repo);
    return c.json(
      buildFlow(repo, { query: body.query, symbolId: body.symbolId, endpoint: body.endpoint }),
    );
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

app.post("/api/impact", async (c) => {
  try {
    const body = (await c.req.json()) as { repo?: string; symbolId?: string };
    const repo = requireRepo(body.repo);
    if (!body.symbolId) return c.json({ error: "symbolId is required" }, 400);
    return c.json(buildImpact(repo, body.symbolId));
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
});

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: path.join("dist", "index.html") }));
}

const port = Number(process.env.PORT ?? 3000);
const listener = getRequestListener(app.fetch);

let viteMiddlewares:
  | ((req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: (err?: unknown) => void) => void)
  | undefined;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    listener(req, res);
    return;
  }
  if (viteMiddlewares) {
    viteMiddlewares(req, res, () => listener(req, res));
    return;
  }
  listener(req, res);
});

if (!isProduction) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: (process.env.PREVIEW_HOST ?? "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    },
    appType: "spa",
  });
  viteMiddlewares = vite.middlewares as unknown as typeof viteMiddlewares;
}

server.listen(port, "0.0.0.0", () => {
  console.log(`[code-archaeologist] http://0.0.0.0:${port} (${isProduction ? "production" : "dev"})`);
  console.log(`[code-archaeologist] LLM answers: ${llmConfigured() ? "enabled" : "deterministic engine"}`);
});

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
