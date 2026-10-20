import { GoogleGenAI } from "@google/genai";

const NUMBERED_KEY_SLOTS = 7;
const NO_KEY_MESSAGE =
  "No Gemini API key is configured. Set GEMINI_API_KEY_1 through GEMINI_API_KEY_7, or the legacy GEMINI_API_KEY.";

export function getGeminiApiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];

  for (let slot = 1; slot <= NUMBERED_KEY_SLOTS; slot += 1) {
    const value = env[`GEMINI_API_KEY_${slot}`]?.trim();
    if (value) keys.push(value);
  }

  // Keep older deployments working. The numbered seven slots always have priority.
  const legacyKey = env.GEMINI_API_KEY?.trim();
  if (legacyKey) keys.push(legacyKey);

  // Avoid retrying the same credential twice if it was copied into multiple slots.
  return [...new Set(keys)];
}

export function hasGeminiApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGeminiApiKeys(env).length > 0;
}

export async function runWithGeminiKeyFailover<T>(
  apiKeys: readonly string[],
  operation: (apiKey: string, attempt: number) => Promise<T>,
): Promise<T> {
  const keys = [...new Set(apiKeys.map((key) => key.trim()).filter(Boolean))];
  if (!keys.length) throw new Error(NO_KEY_MESSAGE);

  for (let index = 0; index < keys.length; index += 1) {
    try {
      return await operation(keys[index]!, index + 1);
    } catch {
      // Any failed Gemini request advances to the next configured key. Never log a key.
    }
  }

  throw new Error(
    `All ${keys.length} configured Gemini API key(s) failed. Check the keys, their quota/access, and that GEMINI_MODEL is available for them.`,
  );
}

export function withGeminiApiKeyFailover<T>(
  operation: (client: GoogleGenAI) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  return runWithGeminiKeyFailover(getGeminiApiKeys(env), (apiKey) =>
    operation(new GoogleGenAI({ apiKey })),
  );
}
