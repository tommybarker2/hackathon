const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
// Flash-lite answers in about a second; 3.8-flash spends its token budget on
// hidden reasoning (and long waits), so it is an opt-in via OPENAI_MODEL.
const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export type LlmProvider = "openai" | "gemini";

export function llmProvider(): LlmProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export function llmConfigured(): boolean {
  return llmProvider() !== null;
}

/** Model id used by the optional answer layer, for /api/config and logging. */
export function llmModel(): string {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  return llmProvider() === "gemini" ? GEMINI_DEFAULT_MODEL : "gpt-4o-mini";
}

const SYSTEM_PROMPT = `You are Code Archaeologist, a senior engineer explaining an unfamiliar codebase.

Rules:
- Answer ONLY from the repository context provided. If the context does not contain the answer, say so plainly.
- Cite every code claim with an exact source location in square brackets, for example [src/auth.ts:42]. Use only paths and line numbers that appear in the context.
- Start with the answer itself. Never open with "Short answer", never restate the question, and never use the same section headings for every reply.
- Match the depth to the question: a greeting, thanks or "what can you do" gets one or two conversational sentences and no citations; a code question gets a direct answer followed only by the details that matter.
- Use a heading only when the answer genuinely has distinct sections, and name it for the question (for example "Where it lives", "How it runs", "What depends on it").
- Prefer one or two short paragraphs. Use a list or numbered steps only when order or enumeration matters.
- Be concrete: name the functions and modules involved and the order they run in.
- Never invent files, functions, endpoints or behaviour.`;

/**
 * Optional layer: if an OpenAI or Gemini key is present the answer is written
 * by an LLM from retrieved source; otherwise the deterministic engine answers.
 */
export async function llmAnswer(
  question: string,
  context: string,
  repoLabel: string,
): Promise<string | null> {
  const provider = llmProvider();
  if (!provider) return null;

  const key = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) return null;

  const defaultBase = provider === "gemini" ? GEMINI_BASE_URL : "https://api.openai.com/v1";
  const baseUrl = (process.env.OPENAI_BASE_URL ?? defaultBase).replace(/\/+$/, "");
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
        max_tokens: 1100,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Repository: ${repoLabel}\n\nQuestion: ${question}\n\nRetrieved source context:\n${context}`,
          },
        ],
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
