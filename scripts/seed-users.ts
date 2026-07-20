import { drizzle } from "drizzle-orm/better-sqlite3";
import { users } from "../lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const sqlite = new Database("data/app.db");
const db = drizzle(sqlite);

const args = process.argv.slice(2);
const username = args[0];
const password = args[1];
const name = args[2] ?? username;
const role = args[3] ?? "member";

if (!username || !password) {
  console.log("Usage: npx tsx scripts/seed-users.ts <username> <password> [name] [role]");
  console.log("  role: admin (default) or member");
  process.exit(1);
}

const existing = db.select().from(users).where(eq(users.username, username)).get();
if (existing) {
  console.log(`User '${username}' already exists`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
db.insert(users).values({ username, passwordHash: hash, name, role }).run();
console.log(`Created user '${username}' (role: ${role})`);
