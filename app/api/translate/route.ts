import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { callAIWithUserKeys } from "@/lib/ai";
import { getDecryptedSettings } from "@/lib/user-settings";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { texts, targetLanguage } = body as { texts: string[]; targetLanguage: string };

  if (!texts?.length || !targetLanguage) {
    return NextResponse.json({ error: "texts and targetLanguage required" }, { status: 400 });
  }

  let userKeys: Record<string, string> | undefined;
  let preferred: string | null = null;
  if (session.user.id) {
    const settings = await getDecryptedSettings(session.user.id);
    userKeys = Object.keys(settings.aiKeys).length > 0 ? settings.aiKeys : undefined;
    preferred = settings.preferredProvider ?? null;
  }

  const numberedList = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const result = await callAIWithUserKeys(
    {
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following numbered items to ${targetLanguage}. Keep the numbering. Return ONLY the translated items, one per line, with the same numbering. Do not add explanations.`,
        },
        {
          role: "user",
          content: numberedList,
        },
      ],
      temperature: 0.2,
      maxTokens: 4096,
    },
    userKeys,
    preferred,
  );

  const lines = result.text.split("\n").filter((l: string) => l.trim());
  const translated = texts.map((_, i) => {
    const match = lines.find((l: string) => l.startsWith(`${i + 1}.`));
    return match ? match.replace(/^\d+\.\s*/, "").trim() : texts[i];
  });

  return NextResponse.json({ translated, provider: result.provider });
}
