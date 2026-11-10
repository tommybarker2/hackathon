# repo_cloud

**Understand any codebase. Instantly.**

An AI-assisted code intelligence tool for unfamiliar repositories: it maps the code, answers questions with real source citations, traces execution paths, and measures the blast radius of a change.

Built for the Fall 2026 hackathon theme, **In the Clouds**. The centrepiece is an interactive purpose-bubble map of a codebase and explainable execution tracing.

![status](https://img.shields.io/badge/status-working%20MVP-e3b341)

## What it does

| Capability | How it works |
| --- | --- |
| Repository import | Analyzes a local path or public GitHub repo, at the latest revision or any recent commit (capped at 350 remote source files) |
| Example expeditions | Six baked-in repositories, including this app, load in one click |
| Dark mode | Hand-drawn night theme, remembered across visits, with no white flash |
| Codebase map | Parses TS/JS/Python/Go/Rust/Ruby/Java/Haskell files into files, symbols, imports, routes and SQL operations |
| Cloud map | Files grouped into PARSER, FORMAT, UI and other purpose bubbles, with import edges, language filtering, drag, zoom and click-to-inspect |
| Cited Q&A | Retrieval over symbols, routes and source text; every answer links to `file:line` |
| Execution flows | Walks the inferred call graph from a route or function and shows each hop with confidence |
| Impact analysis | Reverse call-graph traversal: what breaks, which endpoints and tests sit in the blast radius |
| Technical debt | Long functions, god files, import cycles, unused symbols, high fan-out — each with evidence |
| Git archaeology | Commit history, churn hotspots, last-touched metadata; load any recent commit as its own full analysis |

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

The app analyzes itself on first load — a good demo of a real, non-trivial repository. **Examples** loads one of six baked-in repositories (this app, Hono, Express, Flask, Requests, Chalk) in a click, and the source box accepts a public GitHub URL directly — pasting a `github.com` link switches it to GitHub mode. The moon/sun button toggles the hand-drawn dark theme, and the choice is remembered.

Analyze another local project by typing its path into the path box, or switch to **GitHub** and paste a public repository URL. In **Recent archaeology**, choose a commit to re-analyze that revision — the Cloud map, cited Q&A, flows and debt all run against the selected snapshot, and **Back to latest** returns to the working tree or default branch.

### Optional LLM answers

Out of the box the app uses a deterministic retrieval + synthesis engine, so it works with no API key and no network. For more fluent answers, set one key:

```bash
# Gemini (OpenAI-compatible endpoint)
GEMINI_API_KEY=... npm run dev

# Any OpenAI-compatible endpoint
OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_MODEL=gpt-4o-mini npm run dev
```

Gemini defaults to the fast `gemini-3.5-flash-lite`; set `OPENAI_MODEL=gemini-3.8-flash` for the stronger reasoning model, which is noticeably slower. Override the endpoint with `OPENAI_BASE_URL` if needed. Greetings, thanks and meta questions are answered conversationally with no citations, and code answers cite retrieved `file:line` locations. The badge in the header shows which engine answered. Any LLM failure silently falls back to the deterministic engine. Never commit a key.

### Optional GitHub token

Unauthenticated GitHub API calls are limited to 60 requests/hour. Set `GITHUB_TOKEN` to raise the limit.

### Production

```bash
npm run build
npm start
```

## GitHub Pages

GitHub Pages is static hosting, so it cannot run the Hono/Node backend. The Pages build therefore ships a baked analysis of this repository and all five GitHub examples, and runs the same deterministic retrieval, flow and impact code in the browser:

```bash
npm run build:pages   # writes site/ with a relative base path
```

The live site is <https://tommybarker2.github.io/repo_cloud/>. It redirects into `/site/`, where the Examples picker, Cloud map, source viewer, cited Q&A, flows and blast-radius analysis work with no server. Live local-path and arbitrary GitHub imports still require `npm run dev`; the Pages demo is limited to the six baked repositories.

## Demo script (2–3 minutes)

1. **Act 1 — the problem.** Open on the Overview tab: "This is a 6,000-line codebase I have never read. Here is what I know about it in one screen."
2. **Act 2 — the Cloud.** Cloud tab: point at the purpose bubbles, drag a node, click it. The inspector opens the real source with symbols and routes.
3. **Act 3 — the question.** Ask AI: *"How does the analysis pipeline work?"* Click a citation in the answer — the source opens at that line.
4. **Act 4 — the flow.** Flows tab: trace `POST /api/analyze`. The timeline walks endpoint → `analyzeRepository` → parser → graph → git, with each hop linked to code.
5. **Act 5 — impact.** Open `server/analyze/graph.ts`, put the focus on `buildCallEdges`, press **Blast radius**. The graph dims everything outside the affected subgraph and lists the reachable endpoints.
6. **Close.** Switch to a GitHub repo to show the same pipeline on someone else's project.

## Architecture

```
GitHub API / local disk
        │
   walk.ts        file discovery, ignore rules, language detection
        │
   parse.ts       comment masking, symbols, imports, routes, SQL ops, inline route handlers
        │
   graph.ts       import resolution, call-edge inference, Tarjan cycle detection
        │
  analyze/index.ts  analysis payload: stats, summaries, entry points, debt
        │
  retrieval.ts → ask.ts / flow.ts   cited answers, static flows, impact
        │
  Hono API (server/index.ts) → React dashboard (src/)
```

- **Frontend:** React 18 + Vite, custom SVG force layout (no graph library), hand-rolled markdown renderer that turns citations into clickable chips.
- **Backend:** Hono on Node, in-memory repo store (last 6 analyses), Vite middleware in dev.
- **Parsing:** regex + brace/indent matching — no tree-sitter dependency, so it runs anywhere with zero native builds. This is a deliberate hackathon trade-off.

### Why the graph is not just a chatbot

Answers are built from a retrieval step over parsed symbols, routes and call edges, then rendered with `file:line` citations. The model (when enabled) only sees retrieved source, and citations are validated against the analyzed file set before they reach the UI.

## Honest limitations

- **Static inference, not a runtime trace.** Call edges come from identifier call sites. Dynamic dispatch, reflection, dependency injection, event buses and closures passed as callbacks will be missed. The flow view says so in the UI.
- **No compiler or type checker.** Imports are resolved by path conventions; monorepo path aliases and unusual build setups may not resolve.
- **GitHub import is shallow.** Remote analysis has no per-file churn (no local git history) and is capped in file count.
- **Parsing coverage.** TS/JS and Python get the deepest treatment (route handlers, methods, SQL). Go/Rust/Ruby/Java/Haskell get symbols and import edges but limited call/route extraction.
- **In-memory state.** Analyses disappear when the server restarts. That is fine for a demo; a real product would persist a knowledge graph.
- **Unverified edge cases.** The UI was smoke-tested against this repository only; very large graphs (>130 files are truncated from the map) and unusual repos may need tuning.

## Project layout

```
server/
  analyze/       walk, parse, graph, debt, git, github, summaries, orchestrator
  ask.ts         retrieval + cited answer synthesis (+ optional LLM)
  flow.ts        execution-flow tracing and blast-radius analysis
  retrieval.ts   tokenisation, synonyms, ranking
  store.ts       in-memory analysis registry
  index.ts       HTTP API + dev server
src/
  App.tsx        shell, tabs, inspector, impact state
  components/    Graph, CodePanel, Markdown, Overview/Ask/Flows/Debt/Map views
shared/types.ts  the API contract
```

## Checks used while building

```bash
npx tsc --noEmit   # typecheck
npm run build      # production bundle
```

API smoke tests exercised: local analysis, self-analysis, cited Q&A, flow tracing, blast radius, file retrieval, and GitHub import.
