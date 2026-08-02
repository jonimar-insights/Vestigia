import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { savedShareEmails } from "@/lib/schema";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const rows = await db
    .select({ email: savedShareEmails.email })
    .from(savedShareEmails)
    .where(eq(savedShareEmails.userId, session.user.id as string))
    .orderBy(asc(savedShareEmails.createdAt));
  return NextResponse.json(rows.map((r) => r.email));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { email } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  await db
    .insert(savedShareEmails)
    .values({ userId: session.user.id as string, email: normalized })
    .onConflictDoNothing({
      target: [savedShareEmails.userId, savedShareEmails.email],
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const db = getDb();
  await db
    .delete(savedShareEmails)
    .where(
      and(
        eq(savedShareEmails.userId, session.user.id as string),
        eq(savedShareEmails.email, email.toLowerCase())
      )
    );
  return NextResponse.json({ ok: true });
}
