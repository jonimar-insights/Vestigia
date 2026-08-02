import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderShares, users } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { sendShareInviteEmail, type GmailOAuth } from "@/lib/email";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const shares = await db
    .select()
    .from(folderShares)
    .where(eq(folderShares.folderId, folderId))
    .orderBy(folderShares.createdAt);

  return NextResponse.json(shares);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await request.json();
  const { email, permission } = body as { email: string; permission: string };

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (permission !== "view" && permission !== "edit") {
    return NextResponse.json({ error: "Permission must be 'view' or 'edit'" }, { status: 400 });
  }

  // Check if already shared with this email
  const existing = await db
    .select()
    .from(folderShares)
    .where(
      and(
        eq(folderShares.folderId, folderId),
        eq(folderShares.email, email.trim().toLowerCase())
      )
    )
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({ error: "Already shared with this email" }, { status: 409 });
  }

  const [result] = await db
    .insert(folderShares)
    .values({
      folderId,
      email: email.trim().toLowerCase(),
      permission,
    })
    .returning();

  // Send email invitation from the signed-in user's own Gmail when available.
  const origin = request.headers.get("origin") ?? "https://vestigia-vercel.vercel.app";
  const shareLink = `${origin}/shared/folder/${rows[0].shareToken}`;
  const sharedBy = (session.user as { name?: string }).name || session.user.email || "Someone";

  let gmail: GmailOAuth | undefined;
  if (session.user.email) {
    const sender = await db
      .select()
      .from(users)
      .where(eq(users.username, session.user.email))
      .limit(1);
    if (sender[0] && (sender[0].gmailRefreshToken || sender[0].gmailAccessToken)) {
      gmail = {
        user: session.user.email,
        accessToken: sender[0].gmailAccessToken,
        refreshToken: sender[0].gmailRefreshToken,
        expiresAt: sender[0].gmailTokenExpiresAt,
      };
    }
  }

  // Fire and forget — don't block the response
  sendShareInviteEmail(
    {
      to: email.trim().toLowerCase(),
      folderName: rows[0].name,
      shareLink,
      permission,
      sharedBy,
    },
    undefined,
    gmail
  ).then((emailResult) => {
    if (!emailResult.success) {
      console.warn(`[share] Email invite to ${email} failed:`, emailResult.error);
    }
  });

  return NextResponse.json(result, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const { id } = await params;
  const folderId = parseInt(id, 10);
  if (isNaN(folderId)) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Email query param is required" }, { status: 400 });
  }

  await db
    .delete(folderShares)
    .where(
      and(
        eq(folderShares.folderId, folderId),
        eq(folderShares.email, email.toLowerCase())
      )
    );

  return NextResponse.json({ success: true });
}