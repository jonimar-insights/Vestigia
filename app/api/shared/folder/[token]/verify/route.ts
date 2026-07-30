import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { folders, folderShares } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const { email } = body as { email: string };

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const db = getDb();

  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.shareToken, token))
    .limit(1);

  if (!folderRows[0]) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const folder = folderRows[0];

  const shareRows = await db
    .select()
    .from(folderShares)
    .where(eq(folderShares.folderId, folder.id));

  const share = shareRows.find(
    (s) => s.email.toLowerCase() === email.trim().toLowerCase()
  );

  if (!share) {
    return NextResponse.json(
      { authorized: false, error: "Email not authorized" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    authorized: true,
    permission: share.permission,
    email: email.trim().toLowerCase(),
  });
}