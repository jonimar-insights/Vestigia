import { getDb } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { decryptApiKey } from "@/lib/crypto";

interface UserSettingsData {
  aiKeys: Record<string, string>;
  preferredProvider?: string | null;
}

function decryptSettings(settings: UserSettingsData): UserSettingsData {
  const decrypted: Record<string, string> = {};
  for (const [provider, key] of Object.entries(settings.aiKeys)) {
    decrypted[provider] = decryptApiKey(key);
  }
  return { ...settings, aiKeys: decrypted };
}

/** Get decrypted settings for AI routes (server-side only) */
export async function getDecryptedSettings(userId: string): Promise<UserSettingsData> {
  const db = getDb();
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (!rows[0]) {
    return { aiKeys: {}, preferredProvider: null };
  }

  const parsed = JSON.parse(rows[0].settings) as UserSettingsData;
  return decryptSettings(parsed);
}

/** Get a single decrypted API key for testing */
export async function getDecryptedKey(userId: string, provider: string): Promise<string | null> {
  const settings = await getDecryptedSettings(userId);
  return settings.aiKeys[provider] ?? null;
}
