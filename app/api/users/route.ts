import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { asc, eq, not } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();

  // List all Google-authenticated users
  const allUsers = await db
    .select({
      email: users.username,
      name: users.name,
    })
    .from(users)
    .where(not(eq(users.passwordHash, "anonymous")))
    .orderBy(asc(users.name));

  return NextResponse.json(allUsers);
}