import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY or AUTH_SECRET is required for key encryption");
  }
  // Derive a 32-byte key from the secret using scrypt
  return crypto.scryptSync(secret, "vestigia-salt", 32);
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptApiKey(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(":")) return ciphertext;
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext;

  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // If decryption fails, assume it's an unencrypted key (migration)
    return ciphertext;
  }
}

export function isEncrypted(value: string): boolean {
  // Encrypted values have format: hex:hex:hex
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/.test(p));
}
