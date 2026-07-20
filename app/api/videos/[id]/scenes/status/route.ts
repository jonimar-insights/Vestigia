import { NextRequest, NextResponse } from "next/server";
import { getSceneJob } from "@/lib/scene-jobs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const videoId = parseInt(id);

  if (isNaN(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const job = getSceneJob(videoId);

  if (!job) {
    return NextResponse.json({ status: "idle" });
  }

  return NextResponse.json(job);
}
