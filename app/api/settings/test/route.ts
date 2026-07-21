import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDecryptedKey } from "@/lib/user-settings";

const PROVIDER_CONFIG: Record<string, { baseUrl: string; model: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", model: "gemma-4-31b" },
  github: { baseUrl: "https://models.inference.ai.azure.com", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { provider } = body as { provider: string };

  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  // Fetch the actual decrypted key from the database
  const apiKey = await getDecryptedKey(session.user.id, provider);
  if (!apiKey) {
    return NextResponse.json({ success: false, provider, error: "No API key configured for this provider" }, { status: 400 });
  }

  try {
    const isClaude = provider === "anthropic";
    let url = `${config.baseUrl}/chat/completions`;
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    let reqBody: Record<string, unknown>;

    if (isClaude) {
      url = `${config.baseUrl}/messages`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      reqBody = {
        model: config.model,
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 5,
      };
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
      reqBody = {
        model: config.model,
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 5,
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
    });

    const errText = await res.text();

    if (!res.ok) {
      const hint =
        res.status === 401 ? "Invalid API key — check your key format and provider." :
        res.status === 403 ? "Access denied — key may not have permission." :
        res.status === 402 ? "Payment required — account may need billing." :
        res.status === 429 ? "Rate limited — try again later." :
        "";
      return NextResponse.json(
        { success: false, provider, error: `HTTP ${res.status}: ${hint || errText.slice(0, 200)}` },
        { status: 400 },
      );
    }

    // Detect broken responses: HTTP 200 but body indicates failure
    try {
      const data = JSON.parse(errText);
      if (isClaude) {
        if (data.type === "error" || !data.content?.[0]?.text) {
          const errMsg = data.error?.message ?? "Invalid Anthropic response";
          return NextResponse.json(
            { success: false, provider, error: errMsg.slice(0, 200) },
            { status: 400 },
          );
        }
      } else {
        if (!data.choices?.[0]?.message?.content) {
          const errMsg = data.error?.message ?? "Invalid response format";
          return NextResponse.json(
            { success: false, provider, error: errMsg.slice(0, 200) },
            { status: 400 },
          );
        }
      }
    } catch {
      return NextResponse.json(
        { success: false, provider, error: "Could not parse provider response" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, provider });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, provider, error: msg.slice(0, 200) },
      { status: 400 },
    );
  }
}
