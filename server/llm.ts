import type { AskHistoryMessage } from "../shared/types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
// Flash-lite answers in about a second; 3.8-flash spends its token budget on
// hidden reasoning (and long waits), so it is an opt-in via OPENAI_MODEL.
const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export type LlmProvider = "openai" | "gemini";

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

export function llmProvider(): LlmProvider | null {
  if (env("OPENAI_API_KEY")) return "openai";
  if (env("GEMINI_API_KEY")) return "gemini";
  return null;
}

export function llmConfigured(): boolean {
  return llmProvider() !== null;
}

/** Model id used by the optional answer layer, for /api/config and logging. */
export function llmModel(): string {
  if (env("OPENAI_MODEL")) return env("OPENAI_MODEL")!;
  return llmProvider() === "gemini" ? GEMINI_DEFAULT_MODEL : "gpt-4o-mini";
}

const SYSTEM_PROMPT = `You are The Repo Cloud, a senior engineer explaining an unfamiliar codebase.

Rules:
- Answer ONLY from the repository context provided. If the context does not contain the answer, say so plainly.
- Cite every code claim with an exact source location in square brackets, for example [src/auth.ts:42]. Use only paths and line numbers that appear in the context.
- Start with the answer itself. Never open with "Short answer", never restate the question, and never use the same section headings for every reply.
- Match the depth to the question: a greeting, thanks or "what can you do" gets one or two conversational sentences and no citations; a code question gets a direct answer followed only by the details that matter.
- Use a heading only when the answer genuinely has distinct sections, and name it for the question (for example "Where it lives", "How it runs", "What depends on it").
- Prefer one or two short paragraphs. Use a list or numbered steps only when order or enumeration matters.
- The Cloud map groups files into purpose bubbles such as PARSER, GRAPH, ANALYSIS, LLM, UI and CORE. A question about a bubble means that entire purpose group: summarize what the group does collectively, name several files from it, and do not answer with a single closest symbol or file. Do not reject the term just because the source code does not contain the word "bubble".
- Use the exact file path shown in each FILE header (for example "server/analyze/index.ts"). Do not add a "src/" prefix or invent a path.
- Earlier conversation turns may be included for continuity. Use them to resolve follow-up references, but base every code claim on the source context supplied with the latest question.
- Be concrete: name the functions and modules involved and the order they run in.
- Never invent files, functions, endpoints or behaviour.`;

type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

async function llmComplete(messages: LlmMessage[], maxTokens: number): Promise<string | null> {
  const provider = llmProvider();
  if (!provider) return null;

  const key = provider === "gemini" ? env("GEMINI_API_KEY") : env("OPENAI_API_KEY");
  if (!key) return null;

  const defaultBase = provider === "gemini" ? GEMINI_BASE_URL : "https://api.openai.com/v1";
  const baseUrl = (env("OPENAI_BASE_URL") ?? defaultBase).replace(/\/+$/, "");
  const model = llmModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn(`[llm] ${provider} ${res.status} ${res.statusText}: ${detail}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    return content?.trim() ? content.trim() : null;
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`[llm] ${provider} request failed: ${message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Optional layer: if an OpenAI or Gemini key is present the answer is written
 * by an LLM from retrieved source; otherwise the deterministic engine answers.
 */
export async function llmAnswer(
  question: string,
  context: string,
  repoLabel: string,
  history: AskHistoryMessage[] = [],
): Promise<string | null> {
  return llmComplete(
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-6).map((message) => ({
        role: message.role,
        content: message.text.slice(0, 1200),
      })),
      {
        role: "user",
        content: `Repository: ${repoLabel}\n\nQuestion: ${question}\n\nRetrieved source context:\n${context}`,
      },
    ],
    1100,
  );
}
