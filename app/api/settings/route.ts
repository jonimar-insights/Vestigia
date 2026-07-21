import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";

interface UserSettingsData {
  aiKeys: Record<string, string>;
  preferredProvider?: string | null;
}

function maskApiKey(key: string): string {
  const decrypted = decryptApiKey(key);
  if (!decrypted || decrypted.length < 8) return "****";
  return decrypted.slice(0, 4) + "****" + decrypted.slice(-4);
}

function maskSettings(settings: UserSettingsData): UserSettingsData {
  const masked: Record<string, string> = {};
  for (const [provider, key] of Object.entries(settings.aiKeys)) {
    masked[provider] = maskApiKey(key);
  }
  return { ...settings, aiKeys: masked };
}

function encryptSettings(settings: UserSettingsData): UserSettingsData {
  const encrypted: Record<string, string> = {};
  for (const [provider, key] of Object.entries(settings.aiKeys)) {
    encrypted[provider] = encryptApiKey(key);
  }
  return { ...settings, aiKeys: encrypted };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, session.user.id))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ aiKeys: {}, preferredProvider: null });
  }

  const parsed = JSON.parse(rows[0].settings) as UserSettingsData;
  return NextResponse.json(maskSettings(parsed));
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { aiKeys, preferredProvider } = body as UserSettingsData;

  const settings: UserSettingsData = {
    aiKeys: aiKeys ?? {},
    preferredProvider: preferredProvider ?? undefined,
  };

  // Encrypt keys before storing
  const encrypted = encryptSettings(settings);

  const db = getDb();
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, session.user.id))
    .limit(1);

  if (existing[0]) {
    await db
      .update(userSettings)
      .set({ settings: JSON.stringify(encrypted), updatedAt: now })
      .where(eq(userSettings.userId, session.user.id));
  } else {
    await db.insert(userSettings).values({
      userId: session.user.id,
      settings: JSON.stringify(encrypted),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Return masked keys to client
  return NextResponse.json(maskSettings(settings));
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  await db.delete(userSettings).where(eq(userSettings.userId, session.user.id));

  return NextResponse.json({ aiKeys: {}, preferredProvider: null });
}
