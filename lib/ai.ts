/**
 * Shared AI client with omniroute provider fallback.
 *
 * Smart routing tracks provider health (cooldowns, failure counts, success rates)
 * and skips providers known to be exhausted/down. Providers self-heal when
 * cooldowns expire. No external state needed — everything is in-memory on the
 * serverless instance and resets on cold start (which is fine — quotas reset too).
 *
 * Free tier chain (always available, no BYOK needed):
 *   1. Groq — 14,400 req/day, fastest inference
 *   2. Mistral — ~1B tokens/month, all models
 *   3. OpenRouter — 20+ free models
 *   4. Google AI Studio — 500-1,500 req/day (when key available)
 *   5. Cerebras — 1M tokens/day (when key available)
 *   6. GitHub Models — 50-150 req/day (when token available)
 *
 * User BYOK providers are tried first via callAIWithUserKeys().
 */

// ── Provider registry ──────────────────────────────────────────────────────────

const PROVIDER_MAP: Record<string, { baseUrl: string; model: string; name: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", name: "Groq" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", name: "Mistral" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "OpenRouter" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", name: "Gemini" },
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", model: "gemma-4-31b", name: "Cerebras" },
  github: { baseUrl: "https://models.inference.ai.azure.com", model: "gpt-4o", name: "GitHub Models" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514", name: "Claude" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1", name: "GPT" },
};

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  free?: boolean;
}

interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// ── Free tier providers ────────────────────────────────────────────────────────

const freeProviders: ProviderConfig[] = [
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || "",
    model: "llama-3.3-70b-versatile",
    free: true,
  },
  {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: process.env.MISTRAL_API_KEY || "",
    model: "mistral-small-latest",
    free: true,
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    free: true,
  },
  {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.GEMINI_API_KEY || "",
    model: "gemini-2.5-flash",
    free: true,
  },
  {
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKey: process.env.CEREBRAS_API_KEY || "",
    model: "gemma-4-31b",
    free: true,
  },
  {
    name: "GitHub Models",
    baseUrl: "https://models.inference.ai.azure.com",
    apiKey: process.env.GITHUB_MODELS_KEY || "",
    model: "gpt-4o",
    free: true,
  },
];

// Paid / user-configured providers (fallback after free tiers)
const paidProviders: ProviderConfig[] = [
  {
    name: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: process.env.CLAUDE_API_KEY || "",
    model: "claude-sonnet-4-20250514",
  },
  {
    name: "GPT",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: "gpt-4.1",
  },
];

// ── Omniroute health tracker ───────────────────────────────────────────────────

interface ProviderHealth {
  /** Timestamp (ms) when cooldown expires — 0 means healthy */
  cooldownUntil: number;
  /** Consecutive failures without a success */
  consecutiveFailures: number;
  /** Total successes / total attempts */
  successes: number;
  attempts: number;
  /** Timestamp of last failure — used for diagnostics */
  lastFailureAt: number;
  /** Last error message (truncated) */
  lastError: string;
}

const health = new Map<string, ProviderHealth>();

function getHealth(name: string): ProviderHealth {
  let h = health.get(name);
  if (!h) {
    h = { cooldownUntil: 0, consecutiveFailures: 0, successes: 0, attempts: 0, lastFailureAt: 0, lastError: "" };
    health.set(name, h);
  }
  return h;
}

/** Base cooldowns in ms — escalates with consecutive failures */
const BASE_COOLDOWN: Record<string, number> = {
  "Groq": 60_000,         // 1 min base (14,400/day = ~10/min, generous)
  "Mistral": 30_000,      // 30s base (~1B tokens/month)
  "OpenRouter": 30_000,   // 30s base
  "Gemini": 60_000,       // 1 min base
  "Cerebras": 60_000,     // 1 min base
  "GitHub Models": 60_000, // 1 min base
  "Claude": 10_000,       // 10s base (paid, should rarely fail)
  "GPT": 10_000,          // 10s base
};

function getCooldownMs(name: string, consecutiveFailures: number): number {
  const base = BASE_COOLDOWN[name] ?? 30_000;
  // Exponential backoff: base * 2^(failures-1), capped at 1 hour
  const backoff = base * Math.pow(2, Math.min(consecutiveFailures - 1, 5));
  return Math.min(backoff, 3_600_000);
}

function isAvailable(name: string): boolean {
  const h = getHealth(name);
  if (h.cooldownUntil === 0) return true;
  if (Date.now() >= h.cooldownUntil) {
    // Cooldown expired — reset and allow retry
    h.cooldownUntil = 0;
    h.consecutiveFailures = 0;
    return true;
  }
  return false;
}

function recordSuccess(name: string): void {
  const h = getHealth(name);
  h.consecutiveFailures = 0;
  h.cooldownUntil = 0;
  h.successes++;
  h.attempts++;
}

function recordFailure(name: string, errorMsg: string): void {
  const h = getHealth(name);
  h.consecutiveFailures++;
  h.attempts++;
  h.lastFailureAt = Date.now();
  h.lastError = errorMsg.slice(0, 200);

  // Determine if this is a quota/permanent error vs transient
  const isQuota = /quota|limit exceeded|RESOURCE_EXHAUSTED|tokens per day|insufficient.quota/i.test(errorMsg);
  const isAuth = /401|403|invalid.*key|unauthorized/i.test(errorMsg);

  if (isQuota || isAuth) {
    // Long cooldown — won't recover until tomorrow (for daily quotas) or key is fixed
    h.cooldownUntil = Date.now() + 3_600_000; // 1 hour
  } else {
    // Transient error — exponential backoff
    h.cooldownUntil = Date.now() + getCooldownMs(name, h.consecutiveFailures);
  }
}

function getProviderStatus(): Array<{ name: string; healthy: boolean; failures: number; successRate: string; cooldownRemaining: string; lastError: string }> {
  const all = [...freeProviders.filter((p) => p.apiKey), ...paidProviders.filter((p) => p.apiKey)];
  return all.map((p) => {
    const h = getHealth(p.name);
    const available = isAvailable(p.name);
    const cooldownRemaining = h.cooldownUntil > Date.now()
      ? `${Math.round((h.cooldownUntil - Date.now()) / 1000)}s`
      : "none";
    const successRate = h.attempts > 0 ? `${Math.round((h.successes / h.attempts) * 100)}%` : "no data";
    return {
      name: p.name,
      healthy: available,
      failures: h.consecutiveFailures,
      successRate,
      cooldownRemaining,
      lastError: h.lastError,
    };
  });
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitOrUnavailable(status: number, body: string): boolean {
  if (status === 429 || status === 503 || status === 529) return true;
  if (body.includes("rate_limit") || body.includes("tokens per day")) return true;
  if (body.includes("RESOURCE_EXHAUSTED")) return true;
  if (body.includes("quota") || body.includes("limit exceeded")) return true;
  return false;
}

// ── Provider call ──────────────────────────────────────────────────────────────

async function callProvider(
  provider: ProviderConfig,
  options: ChatOptions,
): Promise<{ text: string; provider: string }> {
  let url = `${provider.baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: Record<string, unknown>;

  if (provider.name === "Claude") {
    url = `${provider.baseUrl}/messages`;
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";

    let systemMsg = "";
    const messages = [];
    for (const m of options.messages) {
      if (m.role === "system") {
        systemMsg = typeof m.content === "string" ? m.content : "";
      } else {
        messages.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
        });
      }
    }

    body = {
      model: provider.model,
      system: systemMsg || undefined,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? provider.maxTokens ?? 4096,
    };
  } else {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    body = {
      model: provider.model,
      stream: false,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? provider.maxTokens ?? 4096,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`${provider.name} HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }

  let text = "";
  try {
    const obj = JSON.parse(raw);
    if (provider.name === "Claude") {
      if (obj.type === "error") {
        throw new Error(`${provider.name}: ${obj.error?.message ?? "API error"}`);
      }
      text = obj.content?.[0]?.text ?? "";
      if (!text) throw new Error(`${provider.name}: empty response content`);
    } else {
      if (obj.error) {
        throw new Error(`${provider.name}: ${obj.error.message ?? "API error"}`);
      }
      text = obj.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error(`${provider.name}: empty response content`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("API error")) throw e;
    if (e instanceof Error && e.message.includes("empty response")) throw e;
    const lines = raw.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) text += delta;
      } catch { /* skip */ }
    }
  }

  return { text, provider: provider.name };
}

// ── Omniroute callAI ───────────────────────────────────────────────────────────

/**
 * Call AI with smart provider routing.
 * Skips providers in cooldown, prefers healthy ones, tracks success rates.
 * Returns the first successful response.
 */
export async function callAI(options: ChatOptions): Promise<{ text: string; provider: string }> {
  const available = [...freeProviders.filter((p) => p.apiKey), ...paidProviders.filter((p) => p.apiKey)];
  if (available.length === 0) {
    throw new Error("No AI provider configured. Set GROQ_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, or another provider key.");
  }

  // Sort by health: healthy first, then by success rate (best first)
  const sorted = [...available].sort((a, b) => {
    const aHealthy = isAvailable(a.name);
    const bHealthy = isAvailable(b.name);
    if (aHealthy !== bHealthy) return aHealthy ? -1 : 1;
    const aH = getHealth(a.name);
    const bH = getHealth(b.name);
    const aRate = aH.attempts > 0 ? aH.successes / aH.attempts : 0.5;
    const bRate = bH.attempts > 0 ? bH.successes / bH.attempts : 0.5;
    return bRate - aRate;
  });

  let lastError = "";

  for (let i = 0; i < sorted.length; i++) {
    const provider = sorted[i];

    // Skip providers in cooldown
    if (!isAvailable(provider.name)) {
      const h = getHealth(provider.name);
      const remaining = Math.round((h.cooldownUntil - Date.now()) / 1000);
      console.log(`Omniroute: skipping ${provider.name} (cooldown ${remaining}s remaining)`);
      continue;
    }

    try {
      const result = await callProvider(provider, options);
      if (result.text.trim()) {
        recordSuccess(provider.name);
        return result;
      }
      lastError = `${provider.name}: empty response`;
      recordFailure(provider.name, "empty response");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = `${provider.name}: ${msg.slice(0, 150)}`;
      recordFailure(provider.name, msg);
      console.warn(`Omniroute: ${provider.name} failed: ${msg.slice(0, 200)}`);
    }

    // Brief pause before trying next provider (only if more providers remain)
    if (i < sorted.length - 1) {
      const nextAvailable = sorted.slice(i + 1).some((p) => isAvailable(p.name));
      if (nextAvailable) await sleep(300);
    }
  }

  // If all providers are in cooldown but some will recover soon, wait for the shortest cooldown
  const recovering = sorted.filter((p) => !isAvailable(p.name)).sort((a, b) => {
    return getHealth(a.name).cooldownUntil - getHealth(b.name).cooldownUntil;
  });

  if (recovering.length > 0) {
    const shortest = recovering[0];
    const waitMs = Math.max(0, getHealth(shortest.name).cooldownUntil - Date.now());
    if (waitMs < 30_000) {
      console.log(`Omniroute: waiting ${waitMs}ms for ${shortest.name} to recover`);
      await sleep(waitMs + 500);
      try {
        const result = await callProvider(shortest, options);
        if (result.text.trim()) {
          recordSuccess(shortest.name);
          return result;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        recordFailure(shortest.name, msg);
        lastError = `${shortest.name}: ${msg.slice(0, 150)}`;
      }
    }
  }

  throw new Error(`All AI providers failed. Last error: ${lastError}`);
}

/**
 * Call AI with user-provided keys taking priority.
 * User keys are tried first (preferred provider first), then server defaults.
 * Broken user keys (401/403) are skipped — falls back to server defaults immediately.
 */
export async function callAIWithUserKeys(
  options: ChatOptions,
  userKeys?: Record<string, string>,
  preferred?: string | null,
): Promise<{ text: string; provider: string }> {
  if (!userKeys || Object.keys(userKeys).length === 0) {
    return callAI(options);
  }

  const userProviders: ProviderConfig[] = [];
  const seen = new Set<string>();

  if (preferred && userKeys[preferred]) {
    const cfg = PROVIDER_MAP[preferred];
    if (cfg) {
      userProviders.push({ name: cfg.name, baseUrl: cfg.baseUrl, apiKey: userKeys[preferred], model: cfg.model });
      seen.add(preferred);
    }
  }

  for (const [key, apiKey] of Object.entries(userKeys)) {
    if (seen.has(key) || !apiKey) continue;
    const cfg = PROVIDER_MAP[key];
    if (cfg) {
      userProviders.push({ name: cfg.name, baseUrl: cfg.baseUrl, apiKey, model: cfg.model });
      seen.add(key);
    }
  }

  let lastError = "";
  for (let i = 0; i < userProviders.length; i++) {
    const provider = userProviders[i];
    try {
      const result = await callProvider(provider, options);
      if (result.text.trim()) {
        return result;
      }
      lastError = `${provider.name}: empty response`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError = msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("unauthorized");
      lastError = `${provider.name}: ${msg.slice(0, 150)}`;
      console.warn(`User AI provider ${provider.name} failed: ${msg.slice(0, 200)}`);

      if (isAuthError) {
        console.warn(`User key for ${provider.name} is invalid — skipping and falling back to server defaults`);
        break;
      }

      if (i < userProviders.length - 1) {
        await sleep(300);
      }
    }
  }

  console.warn(`User AI keys failed or unavailable (${lastError || "no keys configured"}), using server defaults`);
  return callAI(options);
}

/**
 * Quick health check — returns the name of the first available provider.
 */
export async function checkAIProvider(): Promise<{ available: boolean; provider: string; error?: string }> {
  const available = [...freeProviders.filter((p) => p.apiKey), ...paidProviders.filter((p) => p.apiKey)];
  if (available.length === 0) {
    return { available: false, provider: "none", error: "No API keys configured" };
  }

  for (const provider of available) {
    if (!isAvailable(provider.name)) continue;
    try {
      let url = `${provider.baseUrl}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: Record<string, unknown>;

      if (provider.name === "Claude") {
        url = `${provider.baseUrl}/messages`;
        headers["x-api-key"] = provider.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body = { model: provider.model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 5 };
      } else {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
        body = { model: provider.model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 5 };
      }

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (res.ok) {
        recordSuccess(provider.name);
        return { available: true, provider: provider.name };
      }
      const errText = await res.text();
      if (isRateLimitOrUnavailable(res.status, errText)) {
        recordFailure(provider.name, errText);
        continue;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordFailure(provider.name, msg);
      continue;
    }
  }

  return { available: false, provider: "none", error: "All providers failed health check" };
}

export { freeProviders, paidProviders, PROVIDER_MAP, getProviderStatus };
