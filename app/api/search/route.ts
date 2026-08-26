import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  videos,
  annotations,
  scenes,
  keyMoments,
  folders,
  folderVideos,
} from "@/lib/schema";
import { ilike, or, eq, and, inArray } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ query: q ?? "", results: [], total: 0 });
  }

  const pattern = `%${q}%`;
  const tagSearch = q.startsWith("#") ? q.slice(1) : q;
  const tagPattern = `%"${tagSearch.replace(/[\\%_"]/g, "\\$&")}"%`;

  const typeParam = request.nextUrl.searchParams.get("type");
  const typeFilter =
    typeParam === "annotation" ||
    typeParam === "scene" ||
    typeParam === "key_moment"
      ? typeParam
      : null;

  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );
  const folderIdParam = request.nextUrl.searchParams.get("folderId");
  const folderId = folderIdParam ? parseInt(folderIdParam, 10) : null;

  // Get user's video IDs
  const userVideoIds = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.userId, session.user.id as string));
  let userVideoIdArr = userVideoIds.map((v) => v.id);

  if (userVideoIdArr.length === 0) {
    return NextResponse.json({ query: q, results: [], total: 0 });
  }

  // If folderId provided, intersect with videos in that folder
  if (folderId) {
    const folderRows = await db
      .select({ videoId: folderVideos.videoId })
      .from(folderVideos)
      .where(eq(folderVideos.folderId, folderId));
    const folderVideoIds = new Set(folderRows.map((r) => r.videoId));
    userVideoIdArr = userVideoIdArr.filter((id) => folderVideoIds.has(id));
    if (userVideoIdArr.length === 0) {
      return NextResponse.json({ query: q, results: [], total: 0 });
    }
  }

  const matchedAnnotations =
    typeFilter && typeFilter !== "annotation"
      ? []
      : await db
          .select({
            id: annotations.id,
            videoId: annotations.videoId,
            timestamp: annotations.timestampStart,
            endTimestamp: annotations.timestampEnd,
            title: annotations.label,
            detail: annotations.note,
            tags: annotations.tags,
          })
          .from(annotations)
          .where(
            and(
              or(
                ilike(annotations.label, pattern),
                ilike(annotations.note, pattern),
                ilike(annotations.tags, tagPattern),
              ),
              inArray(annotations.videoId, userVideoIdArr),
            ),
          );

  const matchedScenes =
    typeFilter && typeFilter !== "scene"
      ? []
      : await db
          .select({
            videoId: scenes.videoId,
            timestamp: scenes.timestamp,
            title: scenes.aiDescription,
            detail: scenes.aiTags,
          })
          .from(scenes)
          .where(
            and(
              or(
                ilike(scenes.aiDescription, pattern),
                ilike(scenes.aiTags, pattern),
              ),
              inArray(scenes.videoId, userVideoIdArr),
            ),
          );

  const matchedMoments =
    typeFilter && typeFilter !== "key_moment"
      ? []
      : await db
          .select({
            videoId: keyMoments.videoId,
            timestamp: keyMoments.timestamp,
            title: keyMoments.title,
            detail: keyMoments.description,
          })
          .from(keyMoments)
          .where(
            and(
              or(
                ilike(keyMoments.title, pattern),
                ilike(keyMoments.description, pattern),
              ),
              inArray(keyMoments.videoId, userVideoIdArr),
            ),
          );

  const results: {
    type: string;
    videoId: number;
    videoTitle: string | null;
    videoThumbnail: string | null;
    folderName: string | null;
    timestamp: number;
    endTimestamp: number | null;
    title: string;
    detail: string | null;
    tags?: string[];
  }[] = [];

  for (const a of matchedAnnotations) {
      results.push({
      type: "annotation",
      videoId: a.videoId,
      videoTitle: null,
      videoThumbnail: null,
      folderName: null,
      timestamp: a.timestamp,
      endTimestamp: a.endTimestamp ?? null,
      title: a.title,
      detail: a.detail,
      tags: a.tags ? JSON.parse(a.tags) : [],
    });
  }

  for (const s of matchedScenes) {
    results.push({
      type: "scene",
      videoId: s.videoId,
      videoTitle: null,
      videoThumbnail: null,
      folderName: null,
      timestamp: s.timestamp,
      endTimestamp: null,
      title: s.title ?? "Scene",
      detail: s.detail,
    });
  }

  for (const m of matchedMoments) {
    results.push({
      type: "key_moment",
      videoId: m.videoId,
      videoTitle: null,
      videoThumbnail: null,
      folderName: null,
      timestamp: m.timestamp,
      endTimestamp: null,
      title: m.title,
      detail: m.detail,
    });
  }

  results.sort((a, b) => a.videoId - b.videoId || a.timestamp - b.timestamp);

  // Batch-fetch video metadata (fixes N+1)
  const allVideoIds = [...new Set(results.map((r) => r.videoId))];
  const videoMap = new Map<
    number,
    { id: number; title: string | null; thumbnailUrl: string | null }
  >();
  if (allVideoIds.length > 0) {
    const vRows = await db
      .select({ id: videos.id, title: videos.title, thumbnailUrl: videos.thumbnailUrl })
      .from(videos)
      .where(inArray(videos.id, allVideoIds));
    for (const v of vRows) {
      videoMap.set(v.id, { id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl });
    }
  }

  const folderMap = new Map<number, string>();
  if (allVideoIds.length > 0) {
    const folderRows = await db
      .select({ videoId: folderVideos.videoId, folderName: folders.name })
      .from(folderVideos)
      .innerJoin(folders, eq(folderVideos.folderId, folders.id))
      .where(inArray(folderVideos.videoId, allVideoIds));
    for (const fr of folderRows) {
      if (!folderMap.has(fr.videoId)) folderMap.set(fr.videoId, fr.folderName);
    }
  }

  for (const r of results) {
    const v = videoMap.get(r.videoId);
    if (v) {
      r.videoTitle = v.title;
      r.videoThumbnail = v.thumbnailUrl;
    }
    r.folderName = folderMap.get(r.videoId) ?? null;
  }

  const total = results.length;
  const paged = results.slice(offset, offset + limit);

  return NextResponse.json({ query: q, results: paged, total });
}
